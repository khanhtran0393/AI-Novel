#!/usr/bin/env python3
"""
Download YouTube audio (yt-dlp) + transcribe (openai-whisper) → JSON stdout.

Used when caption APIs are blocked (429 / IP). App chain step after timedtext/ytdlp-subs.

Usage:
  python fetch_youtube_audio_transcript.py <video_id> [lang] [model]
  lang: e.g. en, vi, auto  (default auto)
  model: tiny|base|small   (default tiny — fast enough for setup UI)

Env:
  AINOVEL_YT_WHISPER_MODEL  override model
  AINOVEL_YT_AUDIO_MAX_MIN  max minutes to download (default 20)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


def _out(obj: dict) -> int:
    print(json.dumps(obj, ensure_ascii=False))
    return 0 if obj.get("ok") else 1


def _which_ffmpeg() -> str | None:
    w = shutil.which("ffmpeg")
    if w:
        return w
    # AI Novel portable
    cwd = Path.cwd()
    for rel in (
        Path("bin") / "ffmpeg.exe",
        Path("python_core") / "ffmpeg" / "ffmpeg.exe",
        Path("bin") / "ffmpeg" / "ffmpeg.exe",
    ):
        p = cwd / rel
        if p.is_file():
            return str(p)
    return None


def main() -> int:
    if len(sys.argv) < 2:
        return _out({"ok": False, "code": "MISSING_VIDEO_ID", "error": "missing video_id"})

    video_id = sys.argv[1].strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return _out({"ok": False, "code": "INVALID_URL", "error": f"bad video_id: {video_id}"})

    lang = (sys.argv[2] if len(sys.argv) > 2 else "auto").strip() or "auto"
    model_name = (
        (sys.argv[3] if len(sys.argv) > 3 else "")
        or os.environ.get("AINOVEL_YT_WHISPER_MODEL")
        or "tiny"
    ).strip()
    if model_name not in ("tiny", "base", "small", "medium"):
        model_name = "tiny"

    max_min = 20
    try:
        max_min = max(3, min(60, int(os.environ.get("AINOVEL_YT_AUDIO_MAX_MIN") or "20")))
    except ValueError:
        max_min = 20

    url = f"https://www.youtube.com/watch?v={video_id}"
    tmp = Path(tempfile.mkdtemp(prefix=f"ainovel-yt-a-{video_id}-"))
    out_tpl = str(tmp / f"{video_id}.%(ext)s")

    try:
        # --- yt-dlp download audio ---
        try:
            import yt_dlp  # type: ignore
        except ImportError:
            return _out(
                {
                    "ok": False,
                    "code": "PACKAGE_MISSING",
                    "error": "yt-dlp not installed (pip install yt-dlp)",
                }
            )

        ff = _which_ffmpeg()
        ydl_opts: dict = {
            "format": "bestaudio/worst",
            "outtmpl": out_tpl,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "overwrites": True,
            # Prefer short extract when possible — section first N minutes
            "download_ranges": None,
            "force_keyframes_at_cuts": True,
            # Keep progress/logs off stdout — app parses last stdout line as JSON
            "logger": type(
                "L",
                (),
                {
                    "debug": staticmethod(lambda _m: None),
                    "info": staticmethod(lambda _m: None),
                    "warning": staticmethod(lambda m: print(m, file=sys.stderr)),
                    "error": staticmethod(lambda m: print(m, file=sys.stderr)),
                },
            )(),
        }
        if ff:
            ydl_opts["ffmpeg_location"] = str(Path(ff).parent)
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": "64",
                }
            ]

        # Limit duration via download_ranges (yt-dlp 2023+)
        try:
            from yt_dlp.utils import download_range_func  # type: ignore

            ydl_opts["download_ranges"] = download_range_func(None, [(0, max_min * 60)])
        except Exception:
            pass

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except Exception as e:
            msg = str(e)
            code = "FETCH_FAILED"
            low = msg.lower()
            if "429" in low or "too many" in low:
                code = "RATE_LIMITED"
            elif "blocked" in low and "ip" in low:
                code = "IP_BLOCKED"
            elif "unavailable" in low or "private" in low:
                code = "VIDEO_UNAVAILABLE"
            return _out({"ok": False, "code": code, "error": msg[:500]})

        # Find audio file
        audio_path: Path | None = None
        for p in tmp.iterdir():
            if p.suffix.lower() in (".m4a", ".webm", ".mp3", ".wav", ".opus", ".ogg", ".mp4"):
                audio_path = p
                break
        if not audio_path or not audio_path.is_file() or audio_path.stat().st_size < 500:
            return _out(
                {
                    "ok": False,
                    "code": "EMPTY_TRANSCRIPT",
                    "error": "yt-dlp did not produce audio file",
                }
            )

        title = ""
        duration = None
        if isinstance(info, dict):
            title = str(info.get("title") or "")
            duration = info.get("duration")

        # --- whisper ---
        try:
            import whisper  # type: ignore
        except ImportError:
            return _out(
                {
                    "ok": False,
                    "code": "PACKAGE_MISSING",
                    "error": "openai-whisper not installed (pip install openai-whisper)",
                }
            )

        try:
            model = whisper.load_model(model_name)
            kwargs: dict = {"fp16": False}
            if lang and lang.lower() not in ("auto", "detect", ""):
                kwargs["language"] = lang.split("-")[0].lower()
            result = model.transcribe(str(audio_path), **kwargs)
        except Exception as e:
            return _out(
                {
                    "ok": False,
                    "code": "FETCH_FAILED",
                    "error": f"whisper failed: {e}"[:500],
                }
            )

        text = (result.get("text") or "").strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) < 10:
            return _out(
                {
                    "ok": False,
                    "code": "EMPTY_TRANSCRIPT",
                    "error": f"Whisper returned empty text (len={len(text)})",
                }
            )

        det_lang = result.get("language") or (None if lang == "auto" else lang)
        return _out(
            {
                "ok": True,
                "transcript": text,
                "language": det_lang,
                "is_auto_generated": True,
                "word_count": len(text.split()),
                "source": "audio_whisper",
                "title": title,
                "duration": duration,
                "model": model_name,
                "audio_bytes": audio_path.stat().st_size,
            }
        )
    finally:
        try:
            shutil.rmtree(tmp, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
