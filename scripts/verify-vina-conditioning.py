#!/usr/bin/env python3
"""Regression checks for the Vina F5-ONNX conditioning contract."""
from __future__ import annotations

import os
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src", "python_core"))

from vina_voice_infer import (  # noqa: E402
    list_str_to_idx,
    load_vocab_char_map,
    plan_max_duration,
    weighted_text_len,
)


def main() -> int:
    vocab_path = os.path.join(
        ROOT, "src", "python_core", "models", "vina_voice", "vocab.txt"
    )
    vocab = load_vocab_char_map(vocab_path)
    if vocab.get(" ") != 0:
        raise AssertionError(f"space token must stay at index 0, got {vocab.get(' ')}")

    phrase = "xin chào bạn"
    ids = list_str_to_idx(phrase, vocab)[0].tolist()
    if ids.count(0) != phrase.count(" "):
        raise AssertionError(f"spaces were lost from text ids: {ids}")

    audio_len = 6 * 24_000
    ref_text = "đây là lời tham chiếu"
    generated_text = "đây là lời cần sinh"
    ref_frames = audio_len // 256 + 1
    expected = ref_frames + int(
        ref_frames
        / weighted_text_len(ref_text)
        * weighted_text_len(generated_text)
    )
    planned = plan_max_duration(audio_len, ref_text, generated_text, 1.0)
    if planned != expected:
        raise AssertionError(f"duration plan mismatch: got={planned} expected={expected}")

    legacy_wrong = ref_frames + int(
        ref_frames
        / weighted_text_len(ref_text)
        * weighted_text_len(ref_text + " " + generated_text)
    )
    if not planned < legacy_wrong:
        raise AssertionError(
            f"target-only duration must be below old ref+target plan: {planned} >= {legacy_wrong}"
        )

    print(
        "PASS Vina conditioning "
        f"space_token=0 spaces={ids.count(0)} "
        f"planned_frames={planned} legacy_wrong_frames={legacy_wrong}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
