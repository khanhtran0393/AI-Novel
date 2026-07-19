#!/usr/bin/env python3
"""
Vocal Isolation using Meta's Demucs.
Separates audio into vocals and accompaniment stems.

Usage:
    python isolate_vocals.py <input_audio> <output_dir> [--model htdemucs] [--two-stems]

Output:
    JSON to stdout: { "vocals": "<path>", "accompaniment": "<path>", "duration_s": float }
"""

import argparse
import json
import os
import sys
import time
import tempfile
import subprocess


def isolate_with_demucs(input_path: str, output_dir: str, model: str = "htdemucs", two_stems: bool = True) -> dict:
    """Run Demucs separation and return paths to output stems."""
    os.makedirs(output_dir, exist_ok=True)

    t0 = time.time()

    # Build demucs command
    cmd = [
        sys.executable, "-m", "demucs",
        "--out", output_dir,
        "--name", "separated",
        "-n", model,
    ]

    if two_stems:
        cmd.extend(["--two-stems", "vocals"])

    cmd.append(input_path)

    print(f"[Demucs] Running: {' '.join(cmd)}", file=sys.stderr)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600  # 10 minute timeout
    )

    if result.returncode != 0:
        raise RuntimeError(f"Demucs failed: {result.stderr}")

    # Find output files
    # Demucs outputs to: <output_dir>/separated/<model>/<filename_without_ext>/
    input_basename = os.path.splitext(os.path.basename(input_path))[0]
    stem_dir = os.path.join(output_dir, "separated", model, input_basename)

    if not os.path.isdir(stem_dir):
        # Try alternate path structure
        stem_dir = os.path.join(output_dir, model, input_basename)

    if not os.path.isdir(stem_dir):
        raise RuntimeError(f"Demucs output directory not found. Checked: {stem_dir}")

    vocals_path = os.path.join(stem_dir, "vocals.wav")
    accompaniment_path = os.path.join(stem_dir, "no_vocals.wav")

    if not os.path.exists(vocals_path):
        raise RuntimeError(f"Vocals file not found: {vocals_path}")
    if not os.path.exists(accompaniment_path):
        # Try 'other' stem name
        accompaniment_path = os.path.join(stem_dir, "other.wav")
        if not os.path.exists(accompaniment_path):
            raise RuntimeError(f"Accompaniment file not found in {stem_dir}")

    elapsed = time.time() - t0

    return {
        "vocals": vocals_path,
        "accompaniment": accompaniment_path,
        "duration_s": round(elapsed, 2),
        "model": model,
    }


def main():
    parser = argparse.ArgumentParser(description="Isolate vocals from audio using Demucs")
    parser.add_argument("input", help="Input audio file path")
    parser.add_argument("output_dir", help="Output directory for stems")
    parser.add_argument("--model", default="htdemucs", help="Demucs model (default: htdemucs)")
    parser.add_argument("--two-stems", action="store_true", default=True, help="Two-stem mode (vocals + accompaniment)")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    try:
        result = isolate_with_demucs(args.input, args.output_dir, args.model, args.two_stems)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
