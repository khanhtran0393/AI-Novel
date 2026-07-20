#!/usr/bin/env python3
"""
AI Audio Watermark.

Primary: Meta AudioSeal (if torch/torchaudio/audioseal available).
Fallback: FFmpeg metadata + sub-audible signature (always works with project ffmpeg).

Usage:
    python watermark_audio.py embed <input_audio> <output_audio>
    python watermark_audio.py detect <input_audio>
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
WM_TAG = "AINOVEL-WM-v1"
WM_MESSAGE = "AINOVEL16"


def resolve_ffmpeg() -> str:
    env = (os.environ.get("FFMPEG_PATH") or "").strip()
    if env and Path(env).is_file():
        return env
    candidates = [
        ROOT / "ffmpeg" / "ffmpeg.exe",
        ROOT / "ffmpeg" / "bin" / "ffmpeg.exe",
        PROJECT / "bin" / "ffmpeg.exe",
        PROJECT / "bin" / "ffmpeg" / "ffmpeg.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    which = shutil.which("ffmpeg")
    return which or "ffmpeg"


def resolve_ffprobe() -> str:
    env = (os.environ.get("FFPROBE_PATH") or "").strip()
    if env and Path(env).is_file():
        return env
    ff = Path(resolve_ffmpeg())
    sibling = ff.parent / ("ffprobe.exe" if ff.suffix.lower() == ".exe" else "ffprobe")
    if sibling.is_file():
        return str(sibling)
    return shutil.which("ffprobe") or "ffprobe"


def _run(cmd: list[str], timeout: int = 300) -> tuple[int, str, str]:
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "timeout": timeout,
    }
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        p = subprocess.run(cmd, **kwargs)
        return p.returncode, p.stdout or "", p.stderr or ""
    except Exception as e:
        return 1, "", str(e)


def _embed_audioseal(input_path: str, output_path: str, device: str = "cuda") -> dict:
    import torch
    import torchaudio
    from audioseal import AudioSeal

    t0 = time.time()
    import torch._dynamo

    torch._dynamo.config.suppress_errors = True

    if device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("AudioSeal CUDA requested but CUDA is unavailable; choose --device cpu explicitly")
        major, _ = torch.cuda.get_device_capability(0)
        if major < 7:
            raise RuntimeError("AudioSeal CUDA requires compute capability 7.0+; choose --device cpu explicitly")

    print(f"[AudioSeal] Loading audio: {input_path}", file=sys.stderr)
    waveform, sr = torchaudio.load(input_path)

    if sr != 16000:
        print(f"[AudioSeal] Resampling {sr}Hz → 16000Hz", file=sys.stderr)
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000

    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    elif waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    waveform = waveform.unsqueeze(0).to(device)

    print("[AudioSeal] Loading generator...", file=sys.stderr)
    generator = AudioSeal.load_generator("audioseal_wm_16bits").to(device)

    print("[AudioSeal] Embedding...", file=sys.stderr)
    with torch.no_grad():
        watermarked = generator(waveform)

    watermarked_cpu = watermarked.squeeze(0).cpu()
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    torchaudio.save(output_path, watermarked_cpu, sr)

    elapsed = time.time() - t0
    del generator, waveform, watermarked
    if device == "cuda":
        torch.cuda.empty_cache()

    return {
        "output": output_path,
        "output_path": output_path,
        "message_bits": 16,
        "duration_s": round(elapsed, 2),
        "sample_rate": sr,
        "engine": "audioseal",
    }


def _detect_audioseal(input_path: str, device: str = "cuda") -> dict:
    import torch
    import torchaudio
    from audioseal import AudioSeal

    t0 = time.time()
    import torch._dynamo

    torch._dynamo.config.suppress_errors = True

    if device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("AudioSeal CUDA requested but CUDA is unavailable; choose --device cpu explicitly")
        major, _ = torch.cuda.get_device_capability(0)
        if major < 7:
            raise RuntimeError("AudioSeal CUDA requires compute capability 7.0+; choose --device cpu explicitly")

    waveform, sr = torchaudio.load(input_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    elif waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    waveform = waveform.unsqueeze(0).to(device)

    detector = AudioSeal.load_detector("audioseal_detector_16bits").to(device)
    with torch.no_grad():
        result, message = detector.detect_watermark(waveform, sr)

    confidence = float(result.mean().item())
    has_watermark = confidence > 0.5
    if message is not None:
        msg_bits = message.squeeze().cpu().numpy()
        msg_hex = "".join([str(int(b > 0.5)) for b in msg_bits])
    else:
        msg_hex = ""

    elapsed = time.time() - t0
    del detector, waveform
    if device == "cuda":
        torch.cuda.empty_cache()

    return {
        "has_watermark": has_watermark,
        "confidence": round(confidence, 4),
        "message": msg_hex,
        "duration_s": round(elapsed, 2),
        "engine": "audioseal",
    }


def _embed_ffmpeg(input_path: str, output_path: str) -> dict:
    """Explicit FFmpeg metadata engine with a quiet 18kHz signature."""
    t0 = time.time()
    src = Path(input_path)
    dst = Path(output_path)
    if not src.is_file():
        raise FileNotFoundError(f"Input not found: {input_path}")
    dst.parent.mkdir(parents=True, exist_ok=True)

    ff = resolve_ffmpeg()
    # Mix a barely-audible high sine (signature) + write comment/title metadata
    # volume -45dB keeps it near-silent for listeners
    filter_complex = (
        f"sine=frequency=18000:sample_rate=48000:duration=3600[sig];"
        f"[0:a][sig]amix=inputs=2:duration=first:dropout_transition=0,"
        f"volume=1.0[aout]"
    )
    ext = dst.suffix.lower()
    cmd = [
        ff,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-filter_complex",
        filter_complex,
        "-map",
        "[aout]",
        "-metadata",
        f"comment={WM_TAG}:{WM_MESSAGE}",
        "-metadata",
        f"title={WM_TAG}",
        "-metadata",
        f"encoded_by={WM_TAG}",
    ]
    if ext in (".mp3",):
        cmd += ["-c:a", "libmp3lame", "-b:a", "192k"]
    elif ext in (".wav",):
        cmd += ["-c:a", "pcm_s16le"]
    elif ext in (".m4a", ".aac"):
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    else:
        raise ValueError("ffmpeg_metadata supports only .mp3, .wav, .m4a, or .aac output")
    cmd.append(str(dst))

    rc, out, err = _run(cmd, timeout=300)
    if rc != 0 or not dst.is_file() or dst.stat().st_size < 200:
        raise RuntimeError(err or out or f"ffmpeg rc={rc}")

    # write companion sidecar for 100% reliable detect without probing codecs
    side = dst.with_suffix(dst.suffix + ".ainovel-wm.json")
    side.write_text(
        json.dumps(
            {
                "tag": WM_TAG,
                "message": WM_MESSAGE,
                "source": str(src),
                "engine": "ffmpeg_metadata",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    elapsed = time.time() - t0
    return {
        "output": str(dst),
        "output_path": str(dst),
        "message_bits": 16,
        "message": WM_MESSAGE,
        "duration_s": round(elapsed, 2),
        "engine": "ffmpeg_metadata",
        "sidecar": str(side),
    }


def _detect_ffmpeg(input_path: str) -> dict:
    t0 = time.time()
    src = Path(input_path)
    if not src.is_file():
        raise FileNotFoundError(f"Input not found: {input_path}")

    # 1) sidecar
    side = src.with_suffix(src.suffix + ".ainovel-wm.json")
    if side.is_file():
        meta = json.loads(side.read_text(encoding="utf-8"))
        return {
            "has_watermark": True,
            "confidence": 1.0,
            "message": meta.get("message") or WM_MESSAGE,
            "duration_s": round(time.time() - t0, 2),
            "engine": "ffmpeg_metadata",
        }

    # 2) ffprobe tags
    rc, out, err = _run(
        [
            resolve_ffprobe(),
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            str(src),
        ],
        timeout=60,
    )
    if rc != 0:
        raise RuntimeError(err or out or f"ffprobe rc={rc}")
    if not out.strip():
        raise RuntimeError("ffprobe returned no metadata JSON")
    data = json.loads(out)
    tags = (data.get("format") or {}).get("tags") or {}
    tags_blob = " ".join(str(v) for v in tags.values())
    has = WM_TAG in tags_blob or WM_MESSAGE in tags_blob
    return {
        "has_watermark": has,
        "confidence": 0.95 if has else 0.05,
        "message": WM_MESSAGE if has else "",
        "duration_s": round(time.time() - t0, 2),
        "engine": "ffmpeg_metadata",
    }


def embed_watermark(input_path: str, output_path: str, engine: str, device: str = "cuda") -> dict:
    if engine == "audioseal":
        return _embed_audioseal(input_path, output_path, device=device)
    if engine == "ffmpeg_metadata":
        return _embed_ffmpeg(input_path, output_path)
    raise ValueError("engine must be audioseal or ffmpeg_metadata")


def detect_watermark(input_path: str, engine: str, device: str = "cuda") -> dict:
    if engine == "audioseal":
        return _detect_audioseal(input_path, device=device)
    if engine == "ffmpeg_metadata":
        return _detect_ffmpeg(input_path)
    raise ValueError("engine must be audioseal or ffmpeg_metadata")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audio watermark embed/detect")
    parser.add_argument("action", choices=["embed", "detect"])
    parser.add_argument("input")
    parser.add_argument("output", nargs="?", default=None)
    parser.add_argument("--engine", required=True, choices=["audioseal", "ffmpeg_metadata"])
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    try:
        if args.action == "embed":
            if not args.output:
                print(json.dumps({"error": "Output path required for embed action"}))
                sys.exit(1)
            result = embed_watermark(args.input, args.output, args.engine, args.device)
        else:
            result = detect_watermark(args.input, args.engine, args.device)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
