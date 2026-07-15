#!/usr/bin/env python3
"""Fetch YouTube captions via youtube-transcript-api. Prints JSON to stdout."""
from __future__ import annotations

import json
import sys

# Force UTF-8 stdout on Windows (Korean / Vietnamese captions)
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


def _snippets_to_text(result) -> tuple[str, str | None, bool]:
    parts: list[str] = []
    for snip in result.snippets:
        t = (snip.text or "").replace("\n", " ").strip()
        if t:
            parts.append(t)
    full = " ".join(parts)
    lang = getattr(result, "language_code", None) or getattr(result, "language", None)
    if hasattr(lang, "code"):
        lang = lang.code
    is_gen = bool(getattr(result, "is_generated", False))
    return full, str(lang) if lang else None, is_gen


def _fetch_any(ytt, video_id: str, langs: list[str]):
    """Try preferred langs, then any generated/manual track."""
    # 1) Preferred languages
    if langs:
        try:
            return ytt.fetch(video_id, languages=langs)
        except Exception:
            pass

    # 2) List all and pick first available (manual preferred over generated)
    try:
        listing = ytt.list(video_id)
    except Exception:
        listing = None

    if listing is not None:
        manual = []
        generated = []
        try:
            for tr in listing:
                is_gen = bool(getattr(tr, "is_generated", False))
                (generated if is_gen else manual).append(tr)
        except Exception:
            pass

        for tr in manual + generated:
            try:
                return tr.fetch()
            except Exception:
                continue

        # Translation fallback: translate first available to en/vi
        for target in ("vi", "en"):
            for tr in generated + manual:
                try:
                    if hasattr(tr, "translate"):
                        return tr.translate(target).fetch()
                except Exception:
                    continue

    # 3) Bare fetch (some API versions default to any)
    return ytt.fetch(video_id)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing video_id"}))
        return 2
    video_id = sys.argv[1].strip()
    langs = [x.strip() for x in sys.argv[2].split(",") if x.strip()] if len(sys.argv) > 2 else ["vi", "en"]

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "youtube-transcript-api not installed (pip install youtube-transcript-api)",
                }
            )
        )
        return 1

    try:
        ytt = YouTubeTranscriptApi()
        result = _fetch_any(ytt, video_id, langs)
        full, lang, is_gen = _snippets_to_text(result)
        if len(full.strip()) < 10:
            print(json.dumps({"ok": False, "error": "Transcript empty"}))
            return 1
        print(
            json.dumps(
                {
                    "ok": True,
                    "transcript": full,
                    "language": lang,
                    "is_auto_generated": is_gen,
                    "word_count": len(full.split()),
                    "source": "python_youtube_transcript_api",
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
