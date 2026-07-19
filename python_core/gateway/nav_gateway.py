"""NAV TOOLS headless gateway — JSON stdin/stdout bridge for AI Novel.

Host-bound: refuses standalone CLI / double-click without AINOVEL_HOST_TOKEN
from the main App (see gateway/host_binding.py). No binary encryption yet.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

APP_NAME = "NAV TOOLS"
APP_VERSION = "2.6.5"
# Bundled inside AI Novel — host-bound; independent of NAVTools.exe
from gateway.host_binding import ensure_host_bound
from services.script_analyzer import ScriptAnalyzer
from services.storyboard_analyzer import StoryboardAnalyzer, STORYBOARD_STYLES
from services.veo3_utils import DEFAULT_STYLE_PRESET, STYLE_PRESETS
from services import local_media_tools as lmt


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _error(message: str, **extra: Any) -> dict:
    return {"success": False, "error": message, **extra}


def _default_out(subdir: str, name: str) -> Path:
    d = ROOT.parent / "public" / "navtools" / subdir
    d.mkdir(parents=True, exist_ok=True)
    return d / name


def _resolve_api_key(payload: dict) -> str:
    key = (payload.get("gemini_api_key") or payload.get("api_key") or "").strip()
    if key:
        return key
    env_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if env_key:
        return env_key
    key_file = ROOT.parent / "apikey.txt"
    if key_file.is_file():
        return key_file.read_text(encoding="utf-8").strip()
    return ""


def _resolve_model(payload: dict) -> str:
    model = str(payload.get("model") or "").strip()
    if not model:
        raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")
    return model


async def _handle_ping(_: dict) -> dict:
    caps = lmt.capabilities()
    return {
        "success": True,
        "app": APP_NAME,
        "version": APP_VERSION,
        "python_core": str(ROOT),
        "standalone": False,
        "host_bound": True,
        "host": "AI Novel",
        "capabilities": caps,
        "known_actions": sorted(HANDLERS.keys()) if "HANDLERS" in globals() else [],
    }


async def _handle_capabilities(_: dict) -> dict:
    return {
        "success": True,
        "standalone": False,
        "host_bound": True,
        "host_app": "AI Novel",
        "depends_on_navtools_exe": False,
        "capabilities": lmt.capabilities(),
        "known_actions": sorted(HANDLERS.keys()),
        "modules": {
            "script_analyzer": _module_ok("services.script_analyzer"),
            "storyboard_analyzer": _module_ok("services.storyboard_analyzer"),
            "local_media_tools": True,
            "youtube_analyzer": _module_ok("services.youtube_analyzer_v1"),
            # Decompiled NAV sources may be syntax-broken; local_media_tools is the runtime path.
            "flow_client_raw": _module_ok("services.flow_client"),
            "task_manager_raw": _module_ok("workers.task_manager"),
            "scheduler_raw": _module_ok("services.scheduler_service"),
            "timeline_compose_raw": _module_ok("services.timeline_compose"),
        },
        "runtime_replacements": {
            "color_grading": "services.local_media_tools.grade_video",
            "delogo": "services.local_media_tools.delogo_video",
            "frame_extractor": "services.local_media_tools.extract_frames",
            "video_concat": "services.local_media_tools.concat_videos",
            "video_resizer": "services.local_media_tools.resize_video",
            "timeline": "services.local_media_tools.compose_timeline_simple",
            "flow_gen": "AI Novel /api/generate-image + /api/generate-video (cookie store)",
        },
    }


def _module_ok(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


async def _handle_list_presets(_: dict) -> dict:
    return {
        "success": True,
        "style_presets": list(STYLE_PRESETS.keys()),
        "default_style_preset": DEFAULT_STYLE_PRESET,
        "storyboard_styles": [label for label, _ in STORYBOARD_STYLES],
        "color_presets": lmt.list_color_presets(),
        "aspect_ratios": list(lmt.ASPECT_SPECS.keys()),
        "extract_modes": ["fps", "count", "all", "first", "last"],
    }


async def _handle_script2prompt(payload: dict) -> dict:
    text = (payload.get("text") or payload.get("script") or "").strip()
    if not text:
        return _error('Missing "text" or "script"')

    api_key = _resolve_api_key(payload)
    model = _resolve_model(payload)
    if not api_key:
        return _error("Gemini API key required")
    style_name = payload.get("style_preset") or DEFAULT_STYLE_PRESET
    style_desc = STYLE_PRESETS.get(style_name, STYLE_PRESETS[DEFAULT_STYLE_PRESET])
    num_scenes = int(payload.get("num_scenes") or payload.get("scene_count") or 8)
    auto_detect = bool(payload.get("auto_detect_scenes", False))

    analyzer = ScriptAnalyzer()
    result = await analyzer.analyze(
        script_text=text,
        num_scenes=num_scenes,
        gemini_api_key=api_key,
        model=model,
        style_preset_desc=style_desc,
        style_lock=style_name,
        global_context=str(payload.get("global_context") or ""),
        character_aliases=payload.get("character_aliases") or [],
        voice_gender=str(payload.get("voice_gender") or ""),
        narration_lang=str(payload.get("narration_lang") or "Vietnamese"),
        auto_detect_scenes=auto_detect,
    )
    return {"success": True, "result": result}


async def _handle_storyboard(payload: dict) -> dict:
    idea = (payload.get("idea") or payload.get("text") or "").strip()
    if not idea:
        return _error('Missing "idea" or "text"')
    api_key = _resolve_api_key(payload)
    model = _resolve_model(payload)
    if not api_key:
        return _error("Gemini API key required")

    num_scenes = int(payload.get("num_scenes") or 6)
    style = str(payload.get("style") or "Cinematic realistic")
    analyzer = StoryboardAnalyzer(api_key)
    scenes = await analyzer.analyze(
        idea=idea,
        num_scenes=num_scenes,
        style=style,
        model=model,
    )
    return {"success": True, "scenes": scenes}


async def _handle_youtube_seo(payload: dict) -> dict:
    text = (payload.get("text") or payload.get("script") or "").strip()
    title_hint = (payload.get("novel_title") or payload.get("title_hint") or "").strip()
    if not text:
        return _error('Missing "text" or "script"')
    api_key = _resolve_api_key(payload)
    model = _resolve_model(payload)
    if not api_key:
        return _error("Gemini API key required")

    from google import genai
    from google.genai import types as genai_types
    from services.gemini_with_fallback import agenerate_with_fallback

    prompt = (
        "You are a YouTube SEO expert for Vietnamese storytelling channels.\n"
        f"Story title hint: {title_hint or '(none)'}\n\n"
        f"SCRIPT:\n{text[:12000]}\n\n"
        "Return JSON with keys: titles (array of 3 click-worthy Vietnamese titles, ≤ 80 chars each, must be fully meaningful and not cut off), "
        "description (Vietnamese video description, 2-3 paragraphs), "
        "hashtags (array of 8-12 hashtags without # prefix, no spaces inside hashtags)."
    )
    schema = {
        "type": "object",
        "properties": {
            "titles": {"type": "array", "items": {"type": "string"}},
            "description": {"type": "string"},
            "hashtags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["titles", "description", "hashtags"],
    }
    client = genai.Client(api_key=api_key)
    config = genai_types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0.7,
    )
    response = await agenerate_with_fallback(
        client,
        model=model,
        contents=[prompt],
        config=config,
    )
    raw = (getattr(response, "text", "") or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    data = json.loads(raw)
    formatted = (
        "Tiêu đề đề xuất:\n"
        + "\n".join(f"{i + 1}. {t}" for i, t in enumerate(data.get("titles") or []))
        + f"\n\nMô tả:\n{data.get('description', '')}\n\nHashtags:\n"
        + " ".join("#" + h.lstrip("#").replace(" ", "") for h in (data.get("hashtags") or []))
    )
    return {"success": True, "data": data, "formatted": formatted}


async def _handle_youtube_analyze(payload: dict) -> dict:
    url = (payload.get("url") or "").strip()
    if not url:
        return _error('Missing "url"')
    api_key = _resolve_api_key(payload)
    model = _resolve_model(payload)
    if not api_key:
        return _error("Gemini API key required")

    from services.youtube_analyzer_v1 import YouTubeAnalyzer

    analyzer = YouTubeAnalyzer()

    def progress(msg: str):
        _emit({"success": True, "progress": msg})

    try:
        scenes = await analyzer.analyze(
            url,
            gemini_api_key=api_key,
            model=model,
            progress_cb=progress,
        )
        return {"success": True, "scenes": scenes}
    finally:
        analyzer.cleanup()


def _run_cli_script(script_name: str, args: list[str], cwd: Path | None = None) -> dict:
    script = ROOT / script_name
    if not script.is_file():
        return _error(f"Script not found: {script}")
    proc = subprocess.run(
        [sys.executable, str(script), *args],
        cwd=str(cwd or ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONPATH": str(ROOT)},
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    json_lines = [line for line in stdout.splitlines() if line.strip().startswith("{")]
    parsed = None
    if json_lines:
        try:
            parsed = json.loads(json_lines[-1])
        except json.JSONDecodeError:
            parsed = None
    if proc.returncode != 0:
        return {
            "success": False,
            "error": parsed.get("error") if isinstance(parsed, dict) and parsed.get("error") else stderr or stdout or f"exit {proc.returncode}",
            "stdout": stdout,
            "stderr": stderr,
            "result": parsed,
        }
    return {"success": True, "stdout": stdout, "stderr": stderr, "result": parsed}


async def _handle_subtitle(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("videoPath") or "").strip()
    out_path = str(payload.get("out_path") or payload.get("outPath") or "").strip()
    if not video_path:
        return _error('Missing "video_path"')
    if not out_path:
        out_path = str(Path(video_path).with_suffix(".srt"))
    model = str(payload.get("model") or "small")
    language = str(payload.get("language") or "auto")
    return _run_cli_script(
        "api_nav_subtitle.py",
        [video_path, out_path, model, language],
    )


async def _handle_upscale(payload: dict) -> dict:
    image_path = str(payload.get("image_path") or payload.get("imagePath") or "").strip()
    out_path = str(payload.get("out_path") or payload.get("outPath") or "").strip()
    target_height = payload.get("target_height") or payload.get("targetHeight")
    if not image_path or not out_path:
        return _error('Missing "image_path" or "out_path"')
    try:
        target_height = int(target_height)
    except (TypeError, ValueError):
        return _error('Missing or invalid "target_height"')
    if target_height <= 0:
        return _error('"target_height" must be greater than zero')
    return _run_cli_script(
        "cli_upscale.py",
        ["--image", image_path, "--output", out_path, "--height", str(target_height)],
    )


async def _handle_bg_remove(payload: dict) -> dict:
    image_path = str(payload.get("image_path") or payload.get("imagePath") or "").strip()
    out_path = str(payload.get("out_path") or payload.get("outPath") or "").strip()
    color = str(payload.get("color") or "").strip()
    if not image_path or not out_path:
        return _error('Missing "image_path" or "out_path"')
    args = ["--image", image_path, "--output", out_path]
    if color:
        args.extend(["--color", color])
    return _run_cli_script("cli_bg_remove.py", args)


async def _handle_suggest_channels(payload: dict) -> dict:
    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        return _error('Missing "keyword"')
    return _run_cli_script("yt_goi_y.py", ["--keyword", keyword])


async def _handle_split_video(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("videoPath") or "").strip()
    output_dir = str(payload.get("output_dir") or payload.get("outputDir") or "").strip()
    target_duration = payload.get("target_duration") or payload.get("targetDuration") or 30
    if not video_path:
        return _error('Missing "video_path"')
    if not output_dir:
        output_dir = str(ROOT.parent / "public" / "splits")
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    result = _run_cli_script(
        "cat_nho.py",
        [video_path, output_dir, "--muc-tieu", str(target_duration)],
    )
    # Always attach real files produced under output_dir
    clips = sorted(
        [str(p) for p in out.glob("*.mp4")]
        + [str(p) for p in out.glob("*.mov")]
        + [str(p) for p in out.glob("*.mkv")],
        key=lambda s: s.lower(),
    )
    result["output_dir"] = str(out)
    result["clips"] = clips
    result["count"] = len(clips)
    if clips and not result.get("success"):
        # CLI may print non-json but still cut files
        result["success"] = True
        result.pop("error", None)
    if clips and not result.get("output_path"):
        result["output_path"] = clips[0]
    return result


async def _handle_download_video(payload: dict) -> dict:
    platform = str(payload.get("platform") or "yt").strip()
    dl_type = str(payload.get("type") or "search").strip()
    inp = str(payload.get("input") or "").strip()
    output_dir = str(payload.get("output_dir") or payload.get("outputDir") or "").strip()
    count = payload.get("count")
    if not inp:
        return _error('Missing "input"')
    if not output_dir:
        output_dir = str(ROOT.parent / "public" / "downloads")
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    args = ["--platform", platform, "--type", dl_type, "--input", inp, "--output", output_dir]
    if count is not None:
        try:
            c = int(count)
            if c > 0:
                args.extend(["--count", str(c)])
        except (TypeError, ValueError):
            pass
    return _run_cli_script("tai_ytdlp.py", args)


async def _handle_isolate_vocals(payload: dict) -> dict:
    audio_path = str(payload.get("audio_path") or payload.get("audioPath") or "").strip()
    output_dir = str(payload.get("output_dir") or payload.get("outputDir") or "").strip()
    if not audio_path:
        return _error('Missing "audio_path"')
    if not output_dir:
        output_dir = str(ROOT.parent / "public" / "isolated")
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    return _run_cli_script("isolate_vocals.py", [audio_path, output_dir])


async def _handle_watermark_audio(payload: dict) -> dict:
    audio_path = str(payload.get("audio_path") or payload.get("audioPath") or "").strip()
    mode = str(payload.get("mode") or "embed").strip()
    engine = str(payload.get("engine") or "").strip()
    output_path = str(payload.get("output_path") or payload.get("outputPath") or "").strip()
    if not audio_path:
        return _error('Missing "audio_path"')
    if mode not in ("embed", "detect"):
        return _error('Invalid "mode" — use embed or detect')
    if engine not in ("audioseal", "ffmpeg_metadata"):
        return _error('Invalid or missing "engine" - use audioseal or ffmpeg_metadata')
    args = [mode, audio_path, "--engine", engine]
    if mode == "embed":
        if not output_path:
            output_path = str(
                ROOT.parent / "public" / "watermarked" / f"watermarked_{Path(audio_path).name}"
            )
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        args.append(output_path)
    result = _run_cli_script("watermark_audio.py", args)
    parsed = result.get("result") if isinstance(result.get("result"), dict) else {}
    if mode == "embed":
        op = (
            (parsed or {}).get("output_path")
            or (parsed or {}).get("output")
            or output_path
        )
        if op and Path(str(op)).is_file():
            result["success"] = True
            result["output_path"] = str(op)
            result["engine"] = (parsed or {}).get("engine")
            result.pop("error", None)
        elif result.get("success"):
            result["output_path"] = output_path
    else:
        if isinstance(parsed, dict) and ("has_watermark" in parsed or result.get("success")):
            result["success"] = True
            result["has_watermark"] = parsed.get("has_watermark")
            result["confidence"] = parsed.get("confidence")
            result["message"] = parsed.get("message")
            result["engine"] = parsed.get("engine")
    return result


async def _handle_transcribe(payload: dict) -> dict:
    audio_path = str(payload.get("audio_path") or payload.get("audioPath") or "").strip()
    language = str(payload.get("language") or "vi").strip()
    output_dir = str(payload.get("output_dir") or payload.get("outputDir") or "").strip()
    if not audio_path:
        return _error('Missing "audio_path"')
    if not output_dir:
        output_dir = str(ROOT.parent / "public" / "transcripts")
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    result = _run_cli_script("diarize_audio.py", ["--language", language, audio_path])
    if not result.get("success"):
        return result
    parsed = result.get("result")
    if isinstance(parsed, dict) and isinstance(parsed.get("segments"), list):
        srt_path = str(Path(output_dir) / f"{Path(audio_path).stem}.srt")
        lines: list[str] = []
        for idx, seg in enumerate(parsed["segments"], 1):
            if not isinstance(seg, dict):
                continue
            text = str(seg.get("text") or "").strip()
            if not text:
                continue
            start = float(seg.get("start") or 0)
            end = float(seg.get("end") or 0)

            def _ts(sec: float) -> str:
                h = int(sec // 3600)
                m = int((sec % 3600) // 60)
                s = int(sec % 60)
                ms = int(round((sec - int(sec)) * 1000))
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

            lines.append(f"{idx}\n{_ts(start)} --> {_ts(end)}\n{text}\n")
        srt_text = "\n".join(lines)
        Path(srt_path).write_text(srt_text, encoding="utf-8")
        result["srt_path"] = srt_path
        result["srt"] = srt_text
        if isinstance(parsed, dict):
            parsed["srtPath"] = srt_path
            parsed["srt"] = srt_text
    return result


# ── Local NAV media tools (standalone, no NAVTools.exe) ───────────────────

async def _handle_probe_video(payload: dict) -> dict:
    path = str(payload.get("video_path") or payload.get("path") or "").strip()
    if not path:
        return _error('Missing "video_path"')
    info = lmt.probe_video(path)
    return {"success": bool(info.get("ok")), **info}


async def _handle_color_grade(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("input_path") or "").strip()
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    preset = str(payload.get("preset") or payload.get("preset_label") or "").strip()
    if not video_path:
        return _error('Missing "video_path"')
    if not preset:
        return _error('Missing "preset"')
    if not out_path:
        stem = Path(video_path).stem
        out_path = str(_default_out("graded", f"{stem}_graded.mp4"))
    return lmt.grade_video(video_path, out_path, preset)


async def _handle_delogo(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("input_path") or "").strip()
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    if not video_path:
        return _error('Missing "video_path"')
    if not out_path:
        stem = Path(video_path).stem
        out_path = str(_default_out("delogo", f"{stem}_delogo.mp4"))
    return lmt.delogo_video(video_path, out_path)


async def _handle_extract_frames(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("input_path") or "").strip()
    output_dir = str(payload.get("output_dir") or payload.get("out_dir") or "").strip()
    mode = str(payload.get("mode") or "fps").strip()
    value = payload.get("value")
    if value is None:
        value = payload.get("fps") or payload.get("count") or 1
    img_format = str(payload.get("format") or payload.get("img_format") or "png")
    if not video_path:
        return _error('Missing "video_path"')
    if not output_dir:
        output_dir = str(_default_out("frames", Path(video_path).stem))
        Path(output_dir).mkdir(parents=True, exist_ok=True)
    return lmt.extract_frames(video_path, output_dir, mode=mode, value=float(value), img_format=img_format)


async def _handle_make_gif(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("input_path") or "").strip()
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    if not video_path:
        return _error('Missing "video_path"')
    if not out_path:
        out_path = str(_default_out("gif", f"{Path(video_path).stem}.gif"))
    return lmt.make_gif(
        video_path,
        out_path,
        start=float(payload.get("start") or 0),
        duration=float(payload.get("duration") or 3),
        width=int(payload.get("width") or 480),
        fps=int(payload.get("fps") or 12),
    )


async def _handle_concat_videos(payload: dict) -> dict:
    paths = payload.get("input_paths") or payload.get("paths") or payload.get("videos") or []
    if isinstance(paths, str):
        paths = [p.strip() for p in paths.replace("\r", "").split("\n") if p.strip()]
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    re_encode = payload.get("re_encode")
    if re_encode is None:
        re_encode = True
    if not paths:
        return _error('Missing "input_paths"')
    if not out_path:
        out_path = str(_default_out("concat", f"concat_{len(paths)}clips.mp4"))
    return lmt.concat_videos(list(paths), out_path, re_encode=bool(re_encode))


async def _handle_resize_video(payload: dict) -> dict:
    video_path = str(payload.get("video_path") or payload.get("input_path") or "").strip()
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    ratio = str(payload.get("ratio") or payload.get("aspect_ratio") or "").strip()
    alignment = str(payload.get("alignment") or payload.get("align") or "").strip()
    if not video_path:
        return _error('Missing "video_path"')
    if not ratio or not alignment:
        return _error('Missing "ratio" or "alignment"')
    if not out_path:
        out_path = str(_default_out("resized", f"{Path(video_path).stem}_{ratio.replace(':', 'x')}.mp4"))
    return lmt.resize_video(video_path, out_path, ratio=ratio, alignment=alignment)


async def _handle_compose_timeline(payload: dict) -> dict:
    clips = payload.get("clips") or []
    out_path = str(payload.get("output_path") or payload.get("out_path") or "").strip()
    if not clips:
        return _error('Missing "clips" array')
    if not out_path:
        out_path = str(_default_out("timeline", "timeline_compose.mp4"))
    result = lmt.compose_timeline_simple(list(clips), out_path)
    return {**result, "engine": "local_media_tools"}


async def _handle_flow_status(payload: dict) -> dict:
    """Report Flow/account readiness without requiring NAVTools.exe."""
    cookie = str(payload.get("cookie") or payload.get("google_cookie") or "").strip()
    flow_ok = _module_ok("services.flow_client")
    tm_ok = _module_ok("workers.task_manager")
    return {
        "success": True,
        "flow_client_available": flow_ok,
        "task_manager_available": tm_ok,
        "cookie_provided": bool(cookie),
        "note": (
            "Flow gen chạy qua AI Novel generate-image/generate-video + cookie trong store. "
            "python_core.flow_client có sẵn để automation nâng cao; không phụ thuộc NAVTools.exe."
        ),
        "recommended_routes": [
            "/api/generate-image",
            "/api/generate-video",
            "/api/rpa-profile-manager",
            "/api/navtools/gateway",
        ],
    }


async def _handle_scheduler_list(payload: dict) -> dict:
    from services.nav_scheduler_store import list_jobs, store_info

    jobs = list_jobs()
    info = store_info()
    return {
        "success": True,
        "jobs": jobs,
        "count": len(jobs),
        "store": info,
        "standalone": True,
        "backend": "json",
    }


async def _handle_scheduler_save(payload: dict) -> dict:
    from services.nav_scheduler_store import save_job

    job = payload.get("job") if isinstance(payload.get("job"), dict) else payload
    if not isinstance(job, dict):
        return _error('Missing job object')
    # strip non-job keys if flat payload
    clean = {k: v for k, v in job.items() if k not in ("action", "op")}
    if not clean.get("name") and not clean.get("image_prompts") and not clean.get("video_prompts") and not clean.get("tasks"):
        return _error('Job needs at least name or prompts/tasks')
    saved = save_job(clean)
    return {"success": True, "job": saved}


async def _handle_scheduler_delete(payload: dict) -> dict:
    from services.nav_scheduler_store import delete_job

    jid = str(payload.get("id") or payload.get("job_id") or "").strip()
    if not jid:
        return _error('Missing "id"')
    ok = delete_job(jid)
    return {"success": ok, "deleted": ok, "id": jid, "error": None if ok else "not found"}


HANDLERS: dict[str, Callable] = {
    "ping": _handle_ping,
    "version": _handle_ping,
    "capabilities": _handle_capabilities,
    "list_presets": _handle_list_presets,
    "script2prompt": _handle_script2prompt,
    "storyboard": _handle_storyboard,
    "youtube_seo": _handle_youtube_seo,
    "youtube_analyze": _handle_youtube_analyze,
    "subtitle": _handle_subtitle,
    "upscale": _handle_upscale,
    "bg_remove": _handle_bg_remove,
    "suggest_channels": _handle_suggest_channels,
    "split_video": _handle_split_video,
    "download_video": _handle_download_video,
    "isolate_vocals": _handle_isolate_vocals,
    "watermark_audio": _handle_watermark_audio,
    "transcribe": _handle_transcribe,
    # Local media suite (NAV parity, host-bound)
    "probe_video": _handle_probe_video,
    "color_grade": _handle_color_grade,
    "delogo": _handle_delogo,
    "remove_logo": _handle_delogo,
    "extract_frames": _handle_extract_frames,
    "make_gif": _handle_make_gif,
    "concat_videos": _handle_concat_videos,
    "video_join": _handle_concat_videos,
    "resize_video": _handle_resize_video,
    "compose_timeline": _handle_compose_timeline,
    "flow_status": _handle_flow_status,
    "scheduler_list": _handle_scheduler_list,
    "scheduler_save": _handle_scheduler_save,
    "scheduler_delete": _handle_scheduler_delete,
}


async def dispatch(action: str, payload: dict) -> dict:
    handler = HANDLERS.get(action)
    if not handler:
        return _error(f"Unknown action: {action}", known_actions=sorted(HANDLERS.keys()))
    try:
        return await handler(payload)
    except Exception as exc:
        return _error(str(exc), action=action)


def _read_request() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        return {"action": "ping", "payload": {}}
    if raw.startswith("{"):
        data = json.loads(raw)
        if "action" in data:
            return {
                "action": data.get("action"),
                "payload": data.get("payload") or {k: v for k, v in data.items() if k != "action"},
            }
        return {"action": data.get("op") or "ping", "payload": data}
    # Legacy: base64 text for script2prompt CLI compat
    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        return {"action": "script2prompt", "payload": {"text": decoded}}
    except Exception:
        return {"action": "script2prompt", "payload": {"text": raw}}


def main() -> int:
    try:
        bound = ensure_host_bound()
        if not bound.get("success"):
            _emit(bound)
            return 2

        if len(sys.argv) >= 2 and sys.argv[1] != "--stdin":
            action = sys.argv[1]
            payload: dict[str, Any] = {}
            if len(sys.argv) >= 3:
                arg = sys.argv[2]
                try:
                    payload = json.loads(arg)
                except json.JSONDecodeError:
                    payload = {"text": arg}
            result = asyncio.run(dispatch(action, payload))
        else:
            req = _read_request()
            result = asyncio.run(dispatch(str(req.get("action") or "ping"), req.get("payload") or {}))
        _emit(result)
        return 0 if result.get("success") else 1
    except Exception as exc:
        _emit(_error(str(exc)))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
