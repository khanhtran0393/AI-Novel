#!/usr/bin/env python3
"""
Audio Transcription using faster-whisper (CTranslate2).
No dependency on whisperx or transformers - directly uses faster-whisper.

Usage:
    python diarize_audio.py <input_audio> [--language vi] [--model base]

Output:
    JSON to stdout: { "segments": [...], "language": "vi", "duration_s": float }
"""

import argparse
import json
import os
import sys
import time


def transcribe_audio(
    input_path: str,
    language: str = None,
    model_name: str = "base",
    device: str = "cuda",
    compute_type: str = "float16",
) -> dict:
    """Transcribe audio with faster-whisper."""
    from faster_whisper import WhisperModel
    import torch

    t0 = time.time()

    # Auto-detect device
    if device == "cuda":
        if torch.cuda.is_available():
            major, minor = torch.cuda.get_device_capability(0)
            if major < 7:
                print("[Whisper] CUDA Capability < 7.0 (older GPU). Changing compute_type to float32.", file=sys.stderr)
                compute_type = "float32"
        else:
            device = "cpu"
            compute_type = "int8"
            print("[Whisper] CUDA not available, using CPU with int8", file=sys.stderr)

    print(f"[Whisper] Loading model '{model_name}' on {device} ({compute_type})...", file=sys.stderr)
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    print(f"[Whisper] Transcribing: {os.path.basename(input_path)}", file=sys.stderr)

    # Transcribe
    transcribe_kwargs = {
        "beam_size": 5,
        "word_timestamps": True,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 500},
    }
    if language:
        transcribe_kwargs["language"] = language

    raw_segments, info = model.transcribe(input_path, **transcribe_kwargs)

    detected_language = info.language if info else (language or "unknown")
    lang_prob = info.language_probability if info else 0
    print(f"[Whisper] Detected language: {detected_language} (prob={lang_prob:.2f})", file=sys.stderr)

    # Collect segments
    segments = []
    for seg in raw_segments:
        segment = {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
        }
        if seg.words:
            segment["words"] = [
                {
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                }
                for w in seg.words
                if w.word.strip()
            ]
        segments.append(segment)

    elapsed = time.time() - t0
    print(f"[Whisper] Done: {len(segments)} segments in {elapsed:.1f}s", file=sys.stderr)

    # Free GPU memory
    del model
    if device == "cuda":
        torch.cuda.empty_cache()

    return {
        "segments": segments,
        "language": detected_language,
        "duration_s": round(elapsed, 2),
        "has_diarization": False,
        "model": model_name,
    }


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    parser.add_argument("input", help="Input audio file path")
    parser.add_argument("--language", default=None, help="Language code (e.g., vi, en, ja, zh)")
    parser.add_argument("--model", default="base", help="Whisper model (tiny/base/small/medium/large-v3)")
    parser.add_argument("--num-speakers", type=int, default=None, help="(unused, kept for compat)")
    parser.add_argument("--hf-token", default=None, help="(unused, kept for compat)")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"], help="Device")
    parser.add_argument("--compute-type", default="float16", help="Compute type")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    try:
        result = transcribe_audio(
            args.input,
            language=args.language,
            model_name=args.model,
            device=args.device,
            compute_type=args.compute_type,
        )
        # Use buffer write to avoid Windows encoding crash (cp1252 can't handle CJK chars)
        output = json.dumps(result, ensure_ascii=False)
        sys.stdout.buffer.write(output.encode('utf-8'))
        sys.stdout.buffer.write(b'\n')
        sys.stdout.buffer.flush()
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        err_out = json.dumps({"error": str(e)})
        sys.stdout.buffer.write(err_out.encode('utf-8'))
        sys.stdout.buffer.write(b'\n')
        sys.stdout.buffer.flush()
        sys.exit(1)


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
