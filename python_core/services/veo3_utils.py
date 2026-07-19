"""Shared Veo3 prompt utilities extracted from NAV youtube_analyzer."""

from __future__ import annotations

from difflib import get_close_matches

STYLE_PRESETS: dict[str, str] = {
    "3D CGI Realistic": (
        "3D CGI realistic style, hyper-detailed character models with lifelike proportions "
        "and anatomically correct features. Physically-based rendering (PBR) with accurate "
        "material response, realistic skin textures, detailed fabric simulation."
    ),
    "Cinematic Live Action": (
        "Cinematic live-action style, 35mm film grain, natural lighting, shallow depth of field, "
        "color-graded teal and orange, professional film production quality."
    ),
    "Historical Documentary": (
        "Historical documentary reenactment style, period-accurate costumes and architecture, "
        "warm golden hour lighting, steady tripod shots, educational tone."
    ),
    "Anime 2D": (
        "Anime 2D style, cel-shaded, Studio Ghibli inspired, vivid saturated colors, "
        "hand-drawn backgrounds, expressive character designs."
    ),
    "Studio Ghibli": (
        "Studio Ghibli hand-painted aesthetic, soft watercolor backgrounds, warm golden lighting, "
        "painterly brush textures, whimsical magical atmosphere."
    ),
    "Pixar 3D Cartoon": (
        "Pixar 3D animation style, expressive cartoon characters, smooth subsurface-scattering skin, "
        "soft volumetric studio lighting, vibrant saturated color palette."
    ),
    "Cyberpunk Neon": (
        "Cyberpunk neon aesthetic, vibrant magenta and cyan color palette, dramatic night-city "
        "lighting with glowing signage and rain reflections."
    ),
}

DEFAULT_STYLE_PRESET = "3D CGI Realistic"

VEO3_SHOT_TYPES: list[str] = [
    "extreme wide shot",
    "wide establishing shot",
    "wide shot",
    "medium wide shot",
    "medium shot",
    "medium close-up",
    "close-up",
    "extreme close-up",
    "over-the-shoulder shot",
    "POV shot",
    "bird's-eye view",
    "worm's-eye view",
    "dutch angle shot",
    "low angle shot",
    "high angle shot",
    "aerial shot",
    "profile shot",
    "two-shot",
    "group shot",
]

VEO3_CAMERA_MOVES: list[str] = [
    "static tripod shot",
    "slow dolly-in",
    "slow dolly-out",
    "smooth tracking shot left-to-right",
    "smooth tracking shot right-to-left",
    "crane shot rising",
    "crane shot descending",
    "handheld shaky cam",
    "FPV drone dive",
    "orbit shot circling subject",
    "pull-back reveal",
    "whip pan",
    "tilt up slowly",
    "tilt down slowly",
    "zoom in gradually",
    "zoom out gradually",
]


def normalize_to_whitelist(value: str, whitelist: list[str], default: str) -> str:
    value = (value or "").strip().lower()
    if not value:
        return default
    for item in whitelist:
        if item.lower() == value:
            return item
    candidates = [item for item in whitelist if value in item.lower()]
    if candidates:
        candidates.sort(key=len)
        return candidates[0]
    candidates = [item for item in whitelist if item.lower() in value]
    if candidates:
        candidates.sort(key=len)
        return candidates[0]
    matches = get_close_matches(value, whitelist, n=1, cutoff=0.4)
    return matches[0] if matches else default


def assemble_prompt(
    scene_num: int,
    shot_type: str,
    camera_move: str,
    subject_desc: str,
    style_lock: str,
    global_context: str = "",
    visible_aliases: list[str] | None = None,
    narration: str = "",
    narration_lang: str = "",
    voice_gender: str = "",
) -> str:
    visible_aliases = [a.strip() for a in (visible_aliases or []) if a.strip()]
    if visible_aliases:
        alias_text = ", ".join(visible_aliases)
        shot_clause = f"{shot_type} featuring {alias_text}, {camera_move}, {subject_desc}"
    else:
        shot_clause = f"{shot_type}, {camera_move}, {subject_desc}"

    parts: list[str] = []
    if global_context.strip():
        parts.append(global_context.strip().rstrip("."))
    parts.append(f"SCENE_{scene_num:03d}. Shot: {shot_clause}")
    parts.append(f"Style: {style_lock.strip()}")

    if narration and narration.strip():
        narr_text = narration.strip()
        if len(narr_text) > 280:
            narr_text = narr_text[:280].rsplit(" ", 1)[0] + "..."
        narr_text = narr_text.replace('"', "'").replace(""", "'").replace(""", "'")
        lang = narration_lang.strip() or "English"
        vg = (voice_gender or "").strip().lower()
        if vg == "male":
            voice_desc = (
                f"the same {lang} male documentary narrator throughout — a mature warm baritone "
                "in his early 40s, measured confident pace around 130 words per minute"
            )
        elif vg == "female":
            voice_desc = (
                f"the same {lang} female documentary narrator throughout — a mature warm alto "
                "in her mid-30s, measured confident pace around 130 words per minute"
            )
        else:
            voice_desc = f"a consistent {lang} documentary narrator"
        parts.append(
            f'Audio: voiceover by {voice_desc}, saying exactly: "{narr_text}". '
            "Purely cinematic visual composition — the narration is delivered only through the audio channel."
        )

    return ". ".join(parts) + "."