#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vina-Voice ONNX native inference (Model A/B/C).
Parity targets vs Vina-Voice.exe PoC gaps:
  - speaker_seed / style_seed → deterministic noise (ORT + NumPy)
  - NFE_STEP full Euler steps for Flow Matching
  - DML/CUDA crash → auto CPUExecutionProvider retry
  - ref_text: no hardcoded dummy transcript
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import traceback


def _bootstrap_cuda_dll_path() -> None:
    """
    ONNX Runtime CUDA EP needs cuDNN DLLs on PATH.
    They ship with torch (…/site-packages/torch/lib) but not on system PATH —
    without this, ORT logs 'Require cuDNN 9.* and CUDA 13.*' and falls back to CPU.
    """
    try:
        extras: list[str] = []
        try:
            import torch  # type: ignore

            torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
            if os.path.isdir(torch_lib):
                extras.append(torch_lib)
        except Exception:
            pass
        try:
            import onnxruntime as _ort  # type: ignore

            ort_capi = os.path.join(os.path.dirname(_ort.__file__), "capi")
            if os.path.isdir(ort_capi):
                extras.append(ort_capi)
        except Exception:
            pass
        if not extras:
            return
        # Windows 3.8+: add_dll_directory is more reliable than PATH alone
        if hasattr(os, "add_dll_directory"):
            for d in extras:
                try:
                    os.add_dll_directory(d)  # type: ignore[attr-defined]
                except Exception:
                    pass
        path_now = os.environ.get("PATH", "")
        prefix = os.pathsep.join(extras)
        if prefix and not path_now.startswith(prefix):
            os.environ["PATH"] = prefix + os.pathsep + path_now
    except Exception:
        pass


_bootstrap_cuda_dll_path()

import librosa
import numpy as np
import onnxruntime
import soundfile as sf


def normalize_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def list_str_to_idx(text: str, vocab_char_map: dict) -> np.ndarray:
    idx_list = []
    for c in text:
        if c in vocab_char_map:
            idx_list.append(vocab_char_map[c])
    return np.array([idx_list], dtype=np.int32)


def apply_seeds(speaker_seed: int, style_seed: int) -> None:
    """Lock RNG so Model A Random* ops + post-noise style are reproducible."""
    seed = int(speaker_seed) if speaker_seed is not None else 0
    # onnxruntime global seed (covers RandomNormal inside exported graphs)
    try:
        onnxruntime.set_seed(seed)
    except Exception as e:
        print(f"[vina_infer] onnxruntime.set_seed failed: {e}", file=sys.stderr)
    np.random.seed(seed)
    # style_seed reserved for noise re-mix after Model A
    _ = int(style_seed) if style_seed is not None else seed


def remix_noise_with_style(noise: np.ndarray, speaker_seed: int, style_seed: int) -> np.ndarray:
    """
    Re-sample Gaussian init with speaker_seed, lightly blend style_seed stream.
    If Model A already baked noise from a seeded graph, this re-assert
    deterministic init matching UI seed controls.
    """
    shape = noise.shape
    dtype = noise.dtype if noise.dtype in (np.float32, np.float64) else np.float32
    rng_spk = np.random.default_rng(int(speaker_seed) & 0x7FFFFFFF)
    rng_sty = np.random.default_rng(int(style_seed) & 0x7FFFFFFF)
    n_spk = rng_spk.standard_normal(shape).astype(dtype)
    n_sty = rng_sty.standard_normal(shape).astype(dtype)
    # Primary speaker identity + small style residual (stable clone, variable prosody)
    mixed = (0.92 * n_spk + 0.08 * n_sty).astype(dtype)
    # Preserve magnitude scale of Model A noise if present
    a_std = float(np.std(noise)) if noise.size else 0.0
    m_std = float(np.std(mixed)) or 1.0
    if a_std > 1e-6:
        mixed = (mixed * (a_std / m_std)).astype(dtype)
    return mixed


# Persist EP probe result so we don't re-spam CUDA errors every daemon start.
_EP_CACHE_ENV = "VINA_EP_CACHE"
_cuda_usable_mem: bool | None = None
_dml_usable_mem: bool | None = None


def _ep_cache_path() -> str:
    override = (os.environ.get(_EP_CACHE_ENV) or "").strip()
    if override:
        return override
    # python_core → src → project root → data/cache/
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(here))
    return os.path.join(root, "data", "cache", "vina_ort_ep.json")


def _read_ep_cache() -> dict:
    try:
        p = _ep_cache_path()
        if os.path.isfile(p):
            import json

            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}


def _write_ep_cache(updates: dict) -> None:
    try:
        p = _ep_cache_path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        cur = _read_ep_cache()
        cur.update(updates)
        import json

        with open(p, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _quiet_ort_logs() -> None:
    """Suppress ORT C++ ERROR spam when CUDA EP DLL is listed but not loadable."""
    try:
        # 0=VERBOSE … 3=ERROR 4=FATAL — only FATAL while probing GPU EPs
        onnxruntime.set_default_logger_severity(4)
    except Exception:
        pass


def _available_eps() -> set[str]:
    try:
        return set(onnxruntime.get_available_providers() or [])
    except Exception:
        return {"CPUExecutionProvider"}


def mark_ep_result(ep: str, ok: bool) -> None:
    """Record whether a pure-EP load succeeded (used by auto chain next boot)."""
    global _cuda_usable_mem, _dml_usable_mem
    key = ep.lower()
    if "cuda" in key:
        _cuda_usable_mem = bool(ok)
        _write_ep_cache({"cuda_ok": bool(ok)})
    elif "dml" in key:
        _dml_usable_mem = bool(ok)
        _write_ep_cache({"dml_ok": bool(ok)})


def should_try_cuda() -> bool:
    global _cuda_usable_mem
    if os.environ.get("VINA_FORCE_CPU", "").lower() in ("1", "true", "yes", "on"):
        return False
    if _cuda_usable_mem is not None:
        return _cuda_usable_mem
    cache = _read_ep_cache()
    if "cuda_ok" in cache:
        _cuda_usable_mem = bool(cache.get("cuda_ok"))
        return _cuda_usable_mem
    # Package may list CUDA even when cuDNN/CUDA runtime missing — still allow one try
    # unless user pinned cpu. First success/fail is cached.
    _cuda_usable_mem = "CUDAExecutionProvider" in _available_eps()
    return _cuda_usable_mem


def should_try_dml() -> bool:
    global _dml_usable_mem
    if os.environ.get("VINA_FORCE_CPU", "").lower() in ("1", "true", "yes", "on"):
        return False
    if _dml_usable_mem is not None:
        return _dml_usable_mem
    cache = _read_ep_cache()
    if "dml_ok" in cache:
        _dml_usable_mem = bool(cache.get("dml_ok"))
        return _dml_usable_mem
    _dml_usable_mem = "DmlExecutionProvider" in _available_eps()
    return _dml_usable_mem


def provider_chains(prefer: str) -> list[list[str]]:
    """
    Ordered EP attempts. prefer: auto | cuda | dml | cpu

    IMPORTANT: never mix CUDA+CPU in one list. Mixed list makes ORT log
    ERROR for every model load then silently fall back — log spam, not exception.
    Pure EP lists: CUDA fails → exception → next chain → clean CPU.
    """
    prefer = (prefer or "auto").lower()
    _quiet_ort_logs()
    cuda_only = ["CUDAExecutionProvider"]
    dml_only = ["DmlExecutionProvider"]
    cpu = ["CPUExecutionProvider"]

    if prefer == "cpu":
        return [cpu]
    if prefer == "cuda":
        return [cuda_only, cpu]
    if prefer == "dml":
        return [dml_only, cpu]

    # auto: skip EPs known-bad from cache; always end with CPU
    chains: list[list[str]] = []
    if should_try_cuda():
        chains.append(cuda_only)
    if should_try_dml():
        chains.append(dml_only)
    chains.append(cpu)
    return chains


def load_sessions(model_paths: list[str], session_opts, providers: list[str]):
    sessions = []
    primary = (providers[0] if providers else "CPUExecutionProvider") or "CPUExecutionProvider"
    try:
        for p in model_paths:
            sess = onnxruntime.InferenceSession(
                p, sess_options=session_opts, providers=providers
            )
            # If we asked for CUDA-only but got CPU-only, treat as failure so
            # outer chain advances cleanly (avoids half-GPU weirdness).
            active = list(sess.get_providers() or [])
            if primary != "CPUExecutionProvider" and primary not in active:
                raise RuntimeError(
                    f"Requested {primary} but session active={active}"
                )
            sessions.append(sess)
        mark_ep_result(primary, True)
        return sessions
    except Exception:
        mark_ep_result(primary, False)
        raise


def run_inference(
    ort_A,
    ort_B,
    ort_C,
    refaudio,
    text_ids,
    max_duration,
    nfe_step: int,
    speaker_seed: int,
    style_seed: int,
    reseed_noise: bool,
):
    print("Running Model A...")
    out_A = ort_A.run(
        None,
        {
            ort_A.get_inputs()[0].name: refaudio,
            ort_A.get_inputs()[1].name: text_ids,
            ort_A.get_inputs()[2].name: max_duration,
        },
    )
    (
        noise,
        rope_cos_q,
        rope_sin_q,
        rope_cos_k,
        rope_sin_k,
        cat_mel_text,
        cat_mel_text_drop,
        ref_signal_len,
    ) = out_A

    if reseed_noise and speaker_seed is not None:
        print(
            f"Re-seeding noise (speaker_seed={speaker_seed}, style_seed={style_seed})..."
        )
        noise = remix_noise_with_style(noise, speaker_seed, style_seed)

    # Flow-matching Euler: NFE_STEP=32 → exactly (NFE_STEP - 1) Model-B runs.
    # Empirical (model-tts_1.onnx Gather): time index must stay in [-31, 30].
    # range(32) hits idx=31 → INVALID_ARGUMENT. range(31) is correct parity.
    nfe_iters = max(1, nfe_step - 1)
    print(f"Running Model B (Transformer) NFE_STEP={nfe_step} iters={nfe_iters}...")
    time_step = np.array([0], dtype=np.int32)
    for i in range(nfe_iters):
        out_B = ort_B.run(
            None,
            {
                ort_B.get_inputs()[0].name: noise,
                ort_B.get_inputs()[1].name: rope_cos_q,
                ort_B.get_inputs()[2].name: rope_sin_q,
                ort_B.get_inputs()[3].name: rope_cos_k,
                ort_B.get_inputs()[4].name: rope_sin_k,
                ort_B.get_inputs()[5].name: cat_mel_text,
                ort_B.get_inputs()[6].name: cat_mel_text_drop,
                ort_B.get_inputs()[7].name: time_step,
            },
        )
        noise, time_step = out_B
        if (i + 1) % 8 == 0 or i == 0 or i == nfe_iters - 1:
            print(f"  NFE iter {i + 1}/{nfe_iters} time_step={time_step}")

    print("Running Model C (Vocoder)...")
    out_C = ort_C.run(
        None,
        {
            ort_C.get_inputs()[0].name: noise,
            ort_C.get_inputs()[1].name: ref_signal_len,
        },
    )
    return out_C[0]


# Permanent locked path: AI Novel core brain (~1.46GB ONNX).
# Always relative to this script — never tools/, never Vina-Voice.exe.
CORE_MODELS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "vina_voice")
)
REQUIRED_BRAIN = (
    "model-tts_0.onnx",
    "model-tts_1.onnx",
    "model-tts_2.onnx",
    "vocab.txt",
)


def assert_core_brain(models_dir: str) -> None:
    """Fail fast if locked brain assets are incomplete."""
    missing = []
    total = 0
    for name in REQUIRED_BRAIN:
        p = os.path.join(models_dir, name)
        if not os.path.isfile(p):
            missing.append(name)
        else:
            total += os.path.getsize(p)
    if missing:
        raise FileNotFoundError(
            f"ONNX brain incomplete under {models_dir}: missing {missing}"
        )
    if total < 1_000_000_000:
        raise FileNotFoundError(
            f"ONNX brain too small ({total} bytes) under {models_dir} — expected ~1.46GB"
        )
    print(
        f"[vina_infer] CORE_BRAIN locked={models_dir} "
        f"bytes={total} (~{total / 1024 / 1024 / 1024:.3f} GB)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Vina-Voice ONNX native infer")
    parser.add_argument("--text", type=str, required=True)
    parser.add_argument("--ref_text", type=str, required=False, default="")
    parser.add_argument("--ref_audio", type=str, required=True)
    parser.add_argument("--output", type=str, required=True)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--speaker_seed", type=int, default=2336)
    parser.add_argument("--style_seed", type=int, default=4125)
    parser.add_argument(
        "--nfe_step",
        type=int,
        default=32,
        help="Flow-matching NFE steps (default 32)",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default="auto",
        choices=["auto", "cuda", "dml", "cpu"],
        help="ONNX EP preference; auto falls back DML→CPU on crash",
    )
    parser.add_argument(
        "--reseed_noise",
        action="store_true",
        help="Replace Model A noise with seeded Gaussian (experimental). "
        "Default: keep Model A noise; only onnxruntime.set_seed + np.random.seed.",
    )
    parser.add_argument(
        "--models_dir",
        type=str,
        default=CORE_MODELS_DIR,
        help="Ignored unless equals CORE_MODELS_DIR (brain is permanently locked).",
    )
    parser.add_argument(
        "--require_ref_text",
        action="store_true",
        help="Hard-fail if --ref_text empty (recommended for clean timbre)",
    )
    args = parser.parse_args()

    # HARD LOCK: always load brain from src/python_core/models/vina_voice/
    requested = os.path.abspath(args.models_dir) if args.models_dir else CORE_MODELS_DIR
    if os.path.normcase(requested) != os.path.normcase(CORE_MODELS_DIR):
        print(
            f"[vina_infer] WARNING: --models_dir override rejected "
            f"({requested}). Forcing CORE_MODELS_DIR={CORE_MODELS_DIR}",
            file=sys.stderr,
        )
    args.models_dir = CORE_MODELS_DIR
    try:
        assert_core_brain(args.models_dir)
    except FileNotFoundError as e:
        print(f"[vina_infer] ERROR: {e}", file=sys.stderr)
        return 8

    MODEL_SAMPLE_RATE = 24000
    HOP_LENGTH = 256
    NFE_STEP = max(1, int(args.nfe_step))

    ref_text = (args.ref_text or "").strip()
    gen_only = (args.text or "").strip()
    if not gen_only:
        print("[vina_infer] ERROR: --text is empty", file=sys.stderr)
        return 2
    if not ref_text:
        msg = (
            "[vina_infer] WARNING: --ref_text empty. Timbre/prosody will degrade "
            "(Model A mis-aligns ref audio vs transcript). Pass the exact transcript of the sample WAV."
        )
        print(msg, file=sys.stderr)
        if args.require_ref_text:
            print("[vina_infer] ERROR: --require_ref_text set and ref_text empty", file=sys.stderr)
            return 3
    else:
        print(f"[vina_infer] ref_text_len={len(ref_text)} chars")

    apply_seeds(args.speaker_seed, args.style_seed)
    print(
        f"[vina_infer] seeds speaker={args.speaker_seed} style={args.style_seed} "
        f"nfe={NFE_STEP} provider={args.provider}"
    )

    vocab_file = os.path.join(args.models_dir, "vocab.txt")
    if not os.path.isfile(vocab_file):
        print(f"[vina_infer] ERROR: missing vocab {vocab_file}", file=sys.stderr)
        return 4
    with open(vocab_file, "r", encoding="utf-8") as f:
        vocab = [line.strip() for line in f.readlines()]
    vocab_char_map = {c: i for i, c in enumerate(vocab)}

    # Concat ref transcript + gen text (F5-style conditioning)
    if ref_text:
        gen_text = normalize_text(ref_text + " " + gen_only)
    else:
        gen_text = normalize_text(gen_only)
    text_ids = list_str_to_idx(gen_text, vocab_char_map)
    if text_ids.size == 0:
        print("[vina_infer] ERROR: text produced empty vocab ids", file=sys.stderr)
        return 5

    print("Loading and resampling audio...")
    if not os.path.isfile(args.ref_audio):
        print(f"[vina_infer] ERROR: ref_audio not found: {args.ref_audio}", file=sys.stderr)
        return 6

    # Cache preprocessed ref waveform (int16 @ 24k) — "voice vector" prep for this sample.
    # Full Model-A/B/C still runs (depends on gen text), but skip librosa every call.
    ref_cache_dir = os.path.join(
        os.path.dirname(os.path.abspath(args.ref_audio)),
        ".ref_pcm_cache",
    )
    try:
        os.makedirs(ref_cache_dir, exist_ok=True)
    except OSError:
        ref_cache_dir = ""
    ref_st = os.stat(args.ref_audio)
    ref_key = f"{os.path.basename(args.ref_audio)}.{int(ref_st.st_mtime)}_{ref_st.st_size}_24k.npy"
    ref_cache_path = os.path.join(ref_cache_dir, ref_key) if ref_cache_dir else ""
    waveform = None
    if ref_cache_path and os.path.isfile(ref_cache_path):
        try:
            waveform = np.load(ref_cache_path)
            print(f"[vina_infer] ref_pcm cache HIT: {ref_key}")
        except Exception as e:
            print(f"[vina_infer] ref_pcm cache read fail: {e}", file=sys.stderr)
            waveform = None
    if waveform is None:
        waveform, sr = librosa.load(args.ref_audio, sr=MODEL_SAMPLE_RATE, mono=True)
        if ref_cache_path:
            try:
                np.save(ref_cache_path, np.asarray(waveform, dtype=np.float32))
                print(f"[vina_infer] ref_pcm cache SAVE: {ref_key}")
            except Exception as e:
                print(f"[vina_infer] ref_pcm cache write fail: {e}", file=sys.stderr)

    refaudio = np.array(np.asarray(waveform) * 32768.0, dtype=np.int16)
    audio_len = refaudio.shape[-1]
    refaudio = refaudio.reshape(1, 1, -1)

    zh_pause_punc = r"[a-zA-Z0-9]"
    ref_text_for_len = ref_text if ref_text else gen_only
    ref_text_len = len(ref_text_for_len.encode("utf-8")) + 3 * len(
        re.findall(zh_pause_punc, ref_text_for_len)
    )
    gen_text_len = len(gen_text.encode("utf-8")) + 3 * len(
        re.findall(zh_pause_punc, gen_text)
    )
    ref_text_len = max(ref_text_len, 1)

    ref_audio_len = audio_len // HOP_LENGTH + 1
    speed = max(0.5, min(2.0, float(args.speed) or 1.0))
    max_duration = np.array(
        [
            ref_audio_len
            + int(ref_audio_len / ref_text_len * gen_text_len / speed)
        ],
        dtype=np.int64,
    )

    print("Loading models...")
    session_opts = onnxruntime.SessionOptions()
    session_opts.graph_optimization_level = (
        onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    )

    model_A_path = os.path.join(args.models_dir, "model-tts_0.onnx")
    model_B_path = os.path.join(args.models_dir, "model-tts_1.onnx")
    model_C_path = os.path.join(args.models_dir, "model-tts_2.onnx")
    for p in (model_A_path, model_B_path, model_C_path):
        if not os.path.isfile(p):
            print(f"[vina_infer] ERROR: missing model {p}", file=sys.stderr)
            return 7

    model_paths = [model_A_path, model_B_path, model_C_path]
    chains = provider_chains(args.provider)
    last_err: Exception | None = None
    generated_signal = None
    used_providers: list[str] = []

    for providers in chains:
        try:
            print(f"[vina_infer] Trying providers: {providers}")
            apply_seeds(args.speaker_seed, args.style_seed)
            ort_A, ort_B, ort_C = load_sessions(
                model_paths, session_opts, providers
            )
            active = ort_A.get_providers()
            print(f"[vina_infer] Active providers: {active}")
            generated_signal = run_inference(
                ort_A,
                ort_B,
                ort_C,
                refaudio,
                text_ids,
                max_duration,
                NFE_STEP,
                args.speaker_seed,
                args.style_seed,
                reseed_noise=bool(args.reseed_noise),
            )
            used_providers = list(active)
            break
        except Exception as e:
            last_err = e
            print(
                f"[vina_infer] Provider chain {providers} FAILED: {e}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            # continue to next chain (e.g. DML TDR → CPU)
            continue

    if generated_signal is None:
        print(
            f"[vina_infer] ERROR: all provider chains failed. Last: {last_err}",
            file=sys.stderr,
        )
        return 1

    out_dir = os.path.dirname(os.path.abspath(args.output))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    sf.write(
        args.output,
        generated_signal.reshape(-1),
        MODEL_SAMPLE_RATE,
        format="WAVEX",
    )
    print(f"Done: {args.output} providers={used_providers}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[vina_infer] FATAL: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
