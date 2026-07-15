#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Warm ONNX daemon for Vina Zero-Shot.

Loads model-tts_0/1/2.onnx ONCE, then serves many synth jobs over stdin/stdout
(JSON lines). Node (engine.ts) keeps this process alive between previews/chapters.

Protocol (one JSON object per line):
  Request:
    {"id":"abc","cmd":"synth","text":"...","ref_text":"...","ref_audio":"...",
     "output":"...","speed":1.0,"speaker_seed":2336,"style_seed":4125,
     "nfe_step":24,"provider":"auto","reseed_noise":false}
  Response:
    {"id":"abc","ok":true,"output":"...","providers":["CUDAExecutionProvider"]}
    {"id":"abc","ok":false,"error":"..."}

  {"id":"x","cmd":"ping"} -> {"id":"x","ok":true,"pong":true,"ready":true}
  {"id":"x","cmd":"shutdown"} -> exit 0
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any

# Reuse core infer helpers
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vina_voice_infer import (  # noqa: E402
    CORE_MODELS_DIR,
    apply_seeds,
    assert_core_brain,
    list_str_to_idx,
    load_sessions,
    normalize_text,
    provider_chains,
    remix_noise_with_style,
    run_inference,
)

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import onnxruntime  # noqa: E402
import soundfile as sf  # noqa: E402
import re  # noqa: E402


class WarmBrain:
    def __init__(self) -> None:
        self.ort_A = None
        self.ort_B = None
        self.ort_C = None
        self.providers: list[str] = []
        self.vocab_char_map: dict = {}
        self.prefer = "auto"
        self.models_dir = CORE_MODELS_DIR

    def ensure(self, prefer: str = "auto") -> None:
        prefer = (prefer or "auto").lower()
        # Reload only if empty or prefer forced to something else and we never loaded
        if self.ort_A is not None and (
            prefer == self.prefer or prefer == "auto" or prefer in str(self.providers).lower()
        ):
            return
        assert_core_brain(self.models_dir)
        vocab_file = os.path.join(self.models_dir, "vocab.txt")
        with open(vocab_file, "r", encoding="utf-8") as f:
            vocab = [line.strip() for line in f.readlines()]
        self.vocab_char_map = {c: i for i, c in enumerate(vocab)}

        session_opts = onnxruntime.SessionOptions()
        session_opts.graph_optimization_level = (
            onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        model_paths = [
            os.path.join(self.models_dir, "model-tts_0.onnx"),
            os.path.join(self.models_dir, "model-tts_1.onnx"),
            os.path.join(self.models_dir, "model-tts_2.onnx"),
        ]
        chains = provider_chains(prefer)
        last_err: Exception | None = None
        for providers in chains:
            try:
                print(
                    f"[vina_daemon] loading sessions providers={providers}",
                    file=sys.stderr,
                    flush=True,
                )
                a, b, c = load_sessions(model_paths, session_opts, providers)
                self.ort_A, self.ort_B, self.ort_C = a, b, c
                self.providers = list(a.get_providers())
                self.prefer = prefer
                # Pin prefer to what actually works so next ensure() is stable
                active0 = (self.providers[0] if self.providers else "cpu").lower()
                if "cuda" in active0:
                    self.prefer = "cuda"
                elif "dml" in active0:
                    self.prefer = "dml"
                else:
                    self.prefer = "cpu"
                print(
                    f"[vina_daemon] READY providers={self.providers}",
                    file=sys.stderr,
                    flush=True,
                )
                return
            except Exception as e:
                last_err = e
                # One short line — no stack dump (CUDA missing cuDNN is expected)
                print(
                    f"[vina_daemon] skip {providers[0] if providers else '?'}: "
                    f"{type(e).__name__}: {str(e)[:120]}",
                    file=sys.stderr,
                    flush=True,
                )
                continue
        raise RuntimeError(f"Failed to load ONNX brain: {last_err}")

    def load_ref_pcm(self, ref_audio: str) -> np.ndarray:
        MODEL_SAMPLE_RATE = 24000
        ref_cache_dir = os.path.join(
            os.path.dirname(os.path.abspath(ref_audio)), ".ref_pcm_cache"
        )
        try:
            os.makedirs(ref_cache_dir, exist_ok=True)
        except OSError:
            ref_cache_dir = ""
        st = os.stat(ref_audio)
        key = f"{os.path.basename(ref_audio)}.{int(st.st_mtime)}_{st.st_size}_24k.npy"
        cache_path = os.path.join(ref_cache_dir, key) if ref_cache_dir else ""
        if cache_path and os.path.isfile(cache_path):
            try:
                return np.load(cache_path)
            except Exception:
                pass
        waveform, _sr = librosa.load(ref_audio, sr=MODEL_SAMPLE_RATE, mono=True)
        waveform = np.asarray(waveform, dtype=np.float32)
        if cache_path:
            try:
                np.save(cache_path, waveform)
            except Exception:
                pass
        return waveform

    def synth(self, job: dict[str, Any]) -> dict[str, Any]:
        prefer = str(job.get("provider") or "auto")
        self.ensure(prefer)

        text = (job.get("text") or "").strip()
        ref_text = (job.get("ref_text") or "").strip()
        ref_audio = job.get("ref_audio") or ""
        output = job.get("output") or ""
        if not text:
            return {"ok": False, "error": "empty text"}
        if not ref_audio or not os.path.isfile(ref_audio):
            return {"ok": False, "error": f"ref_audio missing: {ref_audio}"}
        if not output:
            return {"ok": False, "error": "output path required"}

        speaker_seed = int(job.get("speaker_seed") or 2336)
        style_seed = int(job.get("style_seed") or 4125)
        nfe_step = max(1, int(job.get("nfe_step") or 24))
        speed = max(0.5, min(2.0, float(job.get("speed") or 1.0)))
        reseed_noise = bool(job.get("reseed_noise"))

        apply_seeds(speaker_seed, style_seed)

        if ref_text:
            gen_text = normalize_text(ref_text + " " + text)
        else:
            gen_text = normalize_text(text)
        text_ids = list_str_to_idx(gen_text, self.vocab_char_map)
        if text_ids.size == 0:
            return {"ok": False, "error": "empty vocab ids"}

        waveform = self.load_ref_pcm(ref_audio)
        refaudio = np.array(waveform * 32768.0, dtype=np.int16)
        audio_len = refaudio.shape[-1]
        refaudio = refaudio.reshape(1, 1, -1)

        HOP_LENGTH = 256
        zh_pause_punc = r"[a-zA-Z0-9]"
        ref_text_for_len = ref_text if ref_text else text
        ref_text_len = len(ref_text_for_len.encode("utf-8")) + 3 * len(
            re.findall(zh_pause_punc, ref_text_for_len)
        )
        gen_text_len = len(gen_text.encode("utf-8")) + 3 * len(
            re.findall(zh_pause_punc, gen_text)
        )
        ref_text_len = max(ref_text_len, 1)
        ref_audio_len = audio_len // HOP_LENGTH + 1
        max_duration = np.array(
            [
                ref_audio_len
                + int(ref_audio_len / ref_text_len * gen_text_len / speed)
            ],
            dtype=np.int64,
        )

        signal = run_inference(
            self.ort_A,
            self.ort_B,
            self.ort_C,
            refaudio,
            text_ids,
            max_duration,
            nfe_step,
            speaker_seed,
            style_seed,
            reseed_noise=reseed_noise,
        )
        out_dir = os.path.dirname(os.path.abspath(output))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        sf.write(output, signal.reshape(-1), 24000, format="WAVEX")
        return {
            "ok": True,
            "output": output,
            "providers": self.providers,
            "nfe_step": nfe_step,
        }


def main() -> int:
    brain = WarmBrain()
    # Eager load so first user job is fast
    prefer = (os.environ.get("VINA_PROVIDER") or "auto").lower()
    try:
        brain.ensure(prefer)
    except Exception as e:
        print(
            f"[vina_daemon] warm load failed (will retry on job): {e}",
            file=sys.stderr,
            flush=True,
        )

    print(
        json.dumps({"ok": True, "event": "ready", "providers": brain.providers}),
        flush=True,
    )

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = ""
        try:
            job = json.loads(line)
            req_id = str(job.get("id") or "")
            cmd = str(job.get("cmd") or "synth").lower()
            if cmd == "shutdown":
                print(json.dumps({"id": req_id, "ok": True, "shutdown": True}), flush=True)
                return 0
            if cmd == "ping":
                print(
                    json.dumps(
                        {
                            "id": req_id,
                            "ok": True,
                            "pong": True,
                            "ready": brain.ort_A is not None,
                            "providers": brain.providers,
                        }
                    ),
                    flush=True,
                )
                continue
            if cmd != "synth":
                print(
                    json.dumps(
                        {"id": req_id, "ok": False, "error": f"unknown cmd {cmd}"}
                    ),
                    flush=True,
                )
                continue
            result = brain.synth(job)
            result["id"] = req_id
            print(json.dumps(result), flush=True)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(
                json.dumps(
                    {
                        "id": req_id,
                        "ok": False,
                        "error": str(e),
                    }
                ),
                flush=True,
            )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[vina_daemon] FATAL: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
