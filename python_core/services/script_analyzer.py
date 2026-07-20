"""NAV TOOLS — Script/Idea → Prompt analyzer (headless gateway edition)."""

from __future__ import annotations

import json
import re
from typing import Callable, Optional

from google import genai
from google.genai import types as genai_types

from services.gemini_with_fallback import agenerate_with_fallback
from services.veo3_utils import (
    VEO3_CAMERA_MOVES,
    VEO3_SHOT_TYPES,
    assemble_prompt,
    normalize_to_whitelist,
)

VEO_CLIP_SECONDS = 8
MAX_SCRIPT_SCENES = 40

_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "global_context": {"type": "string"},
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "shot_type": {"type": "string"},
                    "camera_move": {"type": "string"},
                    "subject_desc": {"type": "string"},
                    "vi_caption": {"type": "string"},
                    "characters_in_scene": {"type": "array", "items": {"type": "string"}},
                },
                "required": [
                    "shot_type",
                    "camera_move",
                    "subject_desc",
                    "vi_caption",
                    "characters_in_scene",
                ],
            },
        },
    },
    "required": ["global_context", "scenes"],
}


def _build_planner_prompt(
    script_text: str,
    num_scenes: int | None,
    style_preset_desc: str,
    user_global_context: str,
    voice_gender: str,
    character_aliases: list[str],
    auto_detect_scenes: bool = False,
    narration_lang: str = "Vietnamese",
) -> str:
    aliases_clause = ""
    if character_aliases:
        aliases_list = ", ".join("@" + a.lstrip("@") for a in character_aliases)
        aliases_clause = (
            f"\n\nCHARACTER ALIASES: {aliases_list}\n"
            "Use alias tokens ONLY when that character is on screen in that shot."
        )
    voice_clause = ""
    if voice_gender in ("male", "female"):
        voice_clause = f"\n\nVoiceover gender: {voice_gender}."
    ctx_clause = ""
    if user_global_context.strip():
        ctx_clause = (
            f'\n\nReuse this global context verbatim in output:\n"{user_global_context.strip()}"'
        )
    if auto_detect_scenes:
        scene_count_rule = "1. Choose 3-20 scenes based on natural beat structure."
        opening = (
            f"You are a video director planning a Veo 3.1 video. Each shot is ~{VEO_CLIP_SECONDS}s."
        )
    else:
        scene_count_rule = f"1. Output EXACTLY {num_scenes} scenes."
        opening = (
            f"You are a video director planning a {num_scenes}-shot Veo 3.1 sequence. "
            f"Each shot is ~{VEO_CLIP_SECONDS}s."
        )
    return (
        f"{opening}\n\nUSER SCRIPT:\n\"\"\"{script_text.strip()}\"\"\"\n\n"
        f"VISUAL STYLE:\n{style_preset_desc}\n{ctx_clause}{voice_clause}{aliases_clause}\n\n"
        f"Rules:\n{scene_count_rule}\n"
        f"2. shot_type from: {', '.join(VEO3_SHOT_TYPES)}\n"
        f"3. camera_move from: {', '.join(VEO3_CAMERA_MOVES)}\n"
        "4. subject_desc in English, 30-50 words.\n"
        f"5. vi_caption in {narration_lang}, max 25 words.\n"
        "6. characters_in_scene lists aliases visible in that shot.\n"
        "7. global_context is a short reusable prefix for all scenes.\n"
        "Output ONLY JSON."
    )


def _strip_planning_rules_for_veo(text: str) -> str:
    if not text or not text.strip():
        return ""
    visual_lines: list[str] = []
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if not line or len(line) == 1:
            continue
        if line[:1] in ("-", "•", "*", "+") and line[1] in (" ", "\t"):
            continue
        if any(token in line for token in ("→", "->", "=>")):
            continue
        lowered = line.lower()
        if ("scene" in lowered or "cảnh " in lowered) and re.search(r"(scene|cảnh)\s*\d", lowered):
            continue
        visual_lines.append(line)
    result = " ".join(visual_lines).strip()
    if len(result) > 200:
        result = result[:200].rsplit(" ", 1)[0] + "..."
    return result


def _strip_json_fence(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]
    if "```" in s:
        s = s.rsplit("```", 1)[0]
    s = s.strip()
    if not s.startswith("{"):
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            s = s[start : end + 1]
    return s


def _empty_result(warnings: list[str]) -> dict:
    return {
        "scenes": [],
        "warnings": warnings,
        "raw_scenes": [],
        "transcripts": {},
        "generated_global_context": "",
        "title": "User script",
        "duration": 0,
    }


def _build_scene(
    idx: int,
    raw: dict,
    aliases: list[str],
    effective_context: str,
    style_lock: str,
    narration_lang: str,
    voice_gender: str,
) -> dict:
    shot_type = normalize_to_whitelist(raw.get("shot_type", ""), VEO3_SHOT_TYPES, "medium shot")
    camera_move = normalize_to_whitelist(
        raw.get("camera_move", ""), VEO3_CAMERA_MOVES, "static tripod shot"
    )
    subject_desc = re.sub(
        r"^SCENE[_\s]?\d+[.:\s]+",
        "",
        (raw.get("subject_desc") or "").strip(),
        flags=re.IGNORECASE,
    ).strip()
    vi_caption = (raw.get("vi_caption") or "").strip()
    allowed_aliases = {a.lstrip("@") for a in aliases}
    scene_aliases = []
    for c in raw.get("characters_in_scene") or []:
        if isinstance(c, str):
            clean = c.lstrip("@").strip()
            if clean in allowed_aliases:
                scene_aliases.append(f"@{clean}")
    final_prompt = assemble_prompt(
        scene_num=idx,
        shot_type=shot_type,
        camera_move=camera_move,
        subject_desc=subject_desc,
        style_lock=style_lock,
        global_context=effective_context,
        visible_aliases=scene_aliases,
        narration=vi_caption,
        narration_lang=narration_lang,
        voice_gender=voice_gender,
    )
    return {
        "scene_num": idx,
        "shot_type": shot_type,
        "camera_move": camera_move,
        "subject_desc": subject_desc,
        "narration": vi_caption,
        "prompt": final_prompt,
        "characters_in_scene": scene_aliases,
        "transcripts": vi_caption,
        "frame": "",
        "confidence": 1.0,
        "start": (idx - 1) * VEO_CLIP_SECONDS,
        "end": idx * VEO_CLIP_SECONDS,
        "duration": VEO_CLIP_SECONDS,
    }


class ScriptAnalyzer:
    def __init__(self):
        self._cancel_requested = False

    def cleanup(self):
        self._cancel_requested = False

    def request_cancel(self):
        self._cancel_requested = True

    cancel = request_cancel

    async def analyze(
        self,
        script_text: str,
        num_scenes: int,
        gemini_api_key: str,
        model: str,
        style_preset_desc: str,
        style_lock: str,
        global_context: str = "",
        character_aliases: Optional[list[str]] = None,
        voice_gender: str = "",
        narration_lang: str = "Vietnamese",
        auto_detect_scenes: bool = False,
        progress_cb: Optional[Callable[[str, int, int], None]] = None,
    ) -> dict:
        if not script_text.strip():
            return _empty_result(["Kịch bản trống."])
        if not gemini_api_key:
            return _empty_result(["Chưa có Gemini API key."])

        if not model.strip():
            raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")

        n = max(1, min(num_scenes, MAX_SCRIPT_SCENES))
        aliases = [a for a in (character_aliases or []) if a and a.strip()]
        if progress_cb:
            progress_cb(
                "Đang để AI chọn số cảnh..." if auto_detect_scenes else f"Đang chia {n} cảnh...",
                0,
                1 if auto_detect_scenes else n,
            )

        client = genai.Client(api_key=gemini_api_key)
        prompt = _build_planner_prompt(
            script_text=script_text,
            num_scenes=None if auto_detect_scenes else n,
            style_preset_desc=style_preset_desc,
            user_global_context=global_context,
            voice_gender=voice_gender,
            character_aliases=aliases,
            auto_detect_scenes=auto_detect_scenes,
            narration_lang=narration_lang,
        )
        config = genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_PLAN_SCHEMA,
            temperature=0.4,
        )
        response = await agenerate_with_fallback(
            client,
            model=model,
            contents=[prompt],
            config=config,
        )
        if self._cancel_requested:
            return _empty_result(["Đã hủy."])

        raw_text = (getattr(response, "text", "") or "").strip()
        try:
            data = json.loads(_strip_json_fence(raw_text))
        except json.JSONDecodeError as e:
            return _empty_result([f"AI trả JSON không hợp lệ: {str(e)[:80]}"])

        ai_global_context = (data.get("global_context") or "").strip()
        if global_context.strip():
            effective_context = _strip_planning_rules_for_veo(global_context) or ai_global_context
        else:
            effective_context = ai_global_context

        ai_scenes = data.get("scenes") or []
        if not isinstance(ai_scenes, list) or not ai_scenes:
            return _empty_result(["AI không sinh được scene nào."])

        warnings: list[str] = []
        if not auto_detect_scenes and len(ai_scenes) != n:
            warnings.append(f"AI sinh {len(ai_scenes)} cảnh thay vì {n} — vẫn dùng được.")

        out_scenes = []
        for idx, raw in enumerate(ai_scenes, start=1):
            if not isinstance(raw, dict):
                continue
            out_scenes.append(
                _build_scene(
                    idx,
                    raw,
                    aliases,
                    effective_context,
                    style_lock,
                    narration_lang,
                    voice_gender,
                )
            )
            if progress_cb:
                progress_cb(f"Đã dựng cảnh {idx}/{len(ai_scenes)}", idx, len(ai_scenes))

        return {
            "scenes": out_scenes,
            "warnings": warnings,
            "raw_scenes": [],
            "transcripts": {},
            "generated_global_context": ai_global_context,
            "title": "User script",
            "duration": len(out_scenes) * VEO_CLIP_SECONDS,
        }

    async def regenerate_scene(
        self,
        script_text: str,
        scene_idx: int,
        existing_scenes: list[dict],
        gemini_api_key: str,
        model: str,
        style_preset_desc: str,
        style_lock: str,
        global_context: str = "",
        character_aliases: Optional[list[str]] = None,
        voice_gender: str = "",
        narration_lang: str = "Vietnamese",
    ) -> Optional[dict]:
        if not gemini_api_key or not script_text.strip():
            return None

        if not model.strip():
            raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")

        aliases = [a for a in (character_aliases or []) if a and a.strip()]
        client = genai.Client(api_key=gemini_api_key)
        prompt = (
            f"Regenerate ONLY scene #{scene_idx} for this script as JSON with keys "
            "shot_type, camera_move, subject_desc, vi_caption, characters_in_scene.\n"
            f"SCRIPT:\n{script_text}\nEXISTING SCENES:\n{json.dumps(existing_scenes, ensure_ascii=False)}"
        )
        config = genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.5,
        )
        response = await agenerate_with_fallback(
            client,
            model=model,
            contents=[prompt],
            config=config,
        )
        raw = _strip_json_fence((getattr(response, "text", "") or "").strip())
        try:
            sc = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(sc, dict):
            return None
        effective_context = _strip_planning_rules_for_veo(global_context) or global_context
        return _build_scene(
            scene_idx,
            sc,
            aliases,
            effective_context,
            style_lock,
            narration_lang,
            voice_gender,
        )
