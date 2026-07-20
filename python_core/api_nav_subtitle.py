from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


WHISPER_MODEL_SIZES = {
    "tiny": 75,
    "base": 142,
    "small": 466,
    "medium": 1465,
    "large": 2950,
}


def find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if found:
        return found

    candidates = [
        Path(__file__).resolve().parent / "ffmpeg" / "ffmpeg.exe",
        Path(__file__).resolve().parent / "ffmpeg" / "bin" / "ffmpeg.exe",
        Path(__file__).resolve().parents[1] / "bin" / "ffmpeg.exe",
        Path(__file__).resolve().parents[1] / "ffmpeg" / "ffmpeg.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def segments_to_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    for index, segment in enumerate(segments or [], 1):
        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        lines.append(f"{index}\n{format_timestamp(start)} --> {format_timestamp(end)}\n{text}\n")
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: api_nav_subtitle.py <videoPath> <outPath> [model] [language]"}))
        return 2

    video_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    model_size = sys.argv[3] if len(sys.argv) > 3 else "small"
    language = sys.argv[4] if len(sys.argv) > 4 else "auto"

    if not video_path.is_file():
        print(json.dumps({"success": False, "error": f"Video not found: {video_path}"}, ensure_ascii=False))
        return 3
    if model_size not in WHISPER_MODEL_SIZES:
        print(json.dumps({"success": False, "error": f"Invalid Whisper model: {model_size}"}, ensure_ascii=False))
        return 4

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print(json.dumps({"success": False, "error": "ffmpeg not found"}, ensure_ascii=False))
        return 5

    tmp_audio = None
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
            tmp_audio = Path(temp.name)

        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(tmp_audio),
        ]
        extract = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if extract.returncode != 0:
            print(json.dumps({"success": False, "error": "ffmpeg extract failed", "stderr": extract.stderr[-4000:]}, ensure_ascii=False))
            return 6

        import whisper

        model = whisper.load_model(model_size)
        result = model.transcribe(
            str(tmp_audio),
            language=None if language == "auto" else language,
            verbose=False,
        )
        segments = result.get("segments", [])
        if not segments:
            print(json.dumps({"success": False, "error": "No speech detected"}, ensure_ascii=False))
            return 7

        srt = segments_to_srt(segments)
        out_path.write_text(srt, encoding="utf-8")
        print(json.dumps({
            "success": True,
            "outPath": str(out_path),
            "segments": len(segments),
            "language": result.get("language"),
            "model": model_size,
            "srt": srt,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
        if tmp_audio:
            tmp_audio.unlink(missing_ok=True)


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    raise SystemExit(main())
