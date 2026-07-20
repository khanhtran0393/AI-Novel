"""Storyboard analyzer — break one idea into N cinematic scene prompts."""

from __future__ import annotations

import json

from google import genai
from google.genai import types as genai_types

from services.gemini_with_fallback import agenerate_with_fallback

DEFAULT_SCENE_DURATION = 8
MIN_SCENES = 2
MAX_SCENES = 20

STORYBOARD_STYLES: list[tuple[str, str]] = [
    ("Cinematic realistic", "cinematic realism, natural lighting, photoreal, shallow depth of field"),
    ("Animation 2D", "2D animation style, vibrant colors, smooth motion, hand-drawn feel"),
    ("Animation 3D Pixar", "3D Pixar-style animation, soft lighting, expressive characters"),
    ("Anime", "anime style, sharp lines, dramatic camera angles, vibrant colors"),
    ("Studio Ghibli", "Studio Ghibli style, soft watercolor backgrounds, dreamy atmosphere"),
    ("Documentary", "documentary footage, handheld camera, natural ambient lighting"),
    ("Cyberpunk Neon", "cyberpunk neon aesthetic, dark moody lighting, vibrant magenta/cyan"),
]

DEFAULT_STYLE = STORYBOARD_STYLES[0][0]

_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "vi_summary": {"type": "string"},
                },
                "required": ["prompt", "vi_summary"],
            },
        }
    },
    "required": ["scenes"],
}


def _build_planner_prompt(idea: str, num_scenes: int, style_desc: str) -> str:
    return (
        f"You are a video storyboard director. Break the idea into EXACTLY {num_scenes} scenes "
        f"for Veo 3.1 (~{DEFAULT_SCENE_DURATION}s each).\n\nIDEA:\n{idea}\n\n"
        f"STYLE:\n{style_desc}\n\n"
        "Return JSON: {\"scenes\": [{\"prompt\": \"...\", \"vi_summary\": \"...\"}, ...]}"
    )


class StoryboardAnalyzer:
    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("Gemini API key required")
        self._client = genai.Client(api_key=api_key)

    async def analyze(self, idea: str, num_scenes: int, style: str, model: str) -> list[dict]:
        if not model.strip():
            raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")
        idea = (idea or "").strip()
        if not idea:
            raise ValueError("Idea text empty")
        if num_scenes < MIN_SCENES or num_scenes > MAX_SCENES:
            raise ValueError(f"num_scenes {num_scenes} out of range {MIN_SCENES}-{MAX_SCENES}")

        style_desc = next((desc for label, desc in STORYBOARD_STYLES if label == style), STORYBOARD_STYLES[0][1])
        planner = _build_planner_prompt(idea, num_scenes, style_desc)
        config = genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_PLAN_SCHEMA,
        )
        response = await agenerate_with_fallback(
            self._client,
            model=model,
            contents=[planner],
            config=config,
        )
        raw = (getattr(response, "text", "") or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data = json.loads(raw)
        scenes = data.get("scenes") if isinstance(data, dict) else None
        if not scenes or not isinstance(scenes, list):
            raise RuntimeError(f"No scenes in Gemini response. Got: {data}")

        clean: list[dict] = []
        for s in scenes[:num_scenes]:
            if not isinstance(s, dict):
                continue
            prompt = str(s.get("prompt") or "").strip()
            summary = str(s.get("vi_summary") or "").strip()
            if prompt:
                clean.append({"prompt": prompt, "vi_summary": summary or "(không có mô tả)"})
        if not clean:
            raise RuntimeError("All scenes empty after sanitize")
        return clean
