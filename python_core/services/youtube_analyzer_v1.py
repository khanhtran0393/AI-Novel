"""NAV TOOLS - YouTube to Prompt analyzer v1."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Optional

try:
    from config.constants import FFMPEG_PATH
except Exception:
    FFMPEG_PATH = "ffmpeg"

try:
    from utils.logger import log
except Exception:
    import logging

    log = logging.getLogger(__name__)

try:
    from utils.platform import get_subprocess_flags
except Exception:
    def get_subprocess_flags() -> int:
        return 0

from services.gemini_with_fallback import agenerate_with_fallback


MAX_DURATION = 300
VEO_VIDEO_LENGTH = 8


def _max_scenes_for_duration(duration):
    if duration <= 30:
        return 5
    if duration <= 60:
        return 8
    if duration <= 120:
        return 12
    return 15


class YouTubeAnalyzer:
    """Download and analyze YouTube videos into Veo 3.1 prompts."""

    _VISION_PROMPT_1 = "Describe this frame for a cinematic Veo 3 prompt. Return concise visual description only."
    _VISION_PROMPT_N = "Describe this frame, preserving the same main character identity when relevant. Return concise visual description only."
    _REWRITE_SCENE_1 = "Rewrite the visual description into one polished Veo 3 prompt. Include camera, subject, action and style."
    _REWRITE_SCENE_N = "Rewrite the visual description into one polished Veo 3 prompt, keeping character continuity from previous scenes."
    _CAMERAS = [
        "wide establishing shot",
        "medium shot",
        "close-up",
        "slow dolly-in",
        "smooth tracking shot",
        "aerial shot",
    ]
    _STRIP_PHRASES = (
        "the image shows",
        "this image shows",
        "in the image",
        "there is",
        "there are",
    )

    def __init__(self):
        self._temp_dir = None
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    @property
    def temp_dir(self):
        if self._temp_dir is None:
            self._temp_dir = tempfile.mkdtemp(prefix="navtools_yt_")
        return self._temp_dir

    def cleanup(self):
        if self._temp_dir:
            shutil.rmtree(self._temp_dir, ignore_errors=True)
            self._temp_dir = None

    async def download(self, url: str, progress_cb: Optional[Callable] = None):
        if progress_cb:
            progress_cb("Downloading video...")
        outtmpl = str(Path(self.temp_dir) / "video.%(ext)s")
        cmd = [
            "yt-dlp",
            "-f",
            "bv*[height<=720]+ba/b[height<=720]/best",
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--print-json",
            "-o",
            outtmpl,
            url,
        ]
        proc = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            creationflags=get_subprocess_flags(),
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "yt-dlp failed")
        info = {}
        for line in proc.stdout.splitlines()[::-1]:
            try:
                info = json.loads(line)
                break
            except Exception:
                continue
        duration = float(info.get("duration", 0) or 0)
        if duration > MAX_DURATION:
            raise RuntimeError(f"Video is too long ({duration:.0f}s); maximum is {MAX_DURATION}s")
        files = [p for p in Path(self.temp_dir).iterdir() if p.suffix.lower() in (".mp4", ".webm", ".mkv")]
        if not files:
            raise RuntimeError("Downloaded video file was not found")
        return str(files[0]), info.get("title", ""), duration

    async def detect_scenes(self, video_path, duration, progress_cb: Optional[Callable] = None):
        if progress_cb:
            progress_cb("Detecting scenes...")
        return await asyncio.to_thread(
            self._detect_scenes_ffmpeg,
            video_path,
            duration,
            progress_cb,
        )

    def _detect_scenes_ffmpeg(self, video_path, duration, progress_cb=None):
        import cv2

        count = _max_scenes_for_duration(duration)
        frames_dir = Path(self.temp_dir) / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError("Cannot open video")
        scenes = []
        step = max(float(duration or 0) / max(count, 1), VEO_VIDEO_LENGTH)
        for i in range(count):
            start = i * step
            end = min(float(duration or start + step), start + step)
            mid = (start + end) / 2
            cap.set(cv2.CAP_PROP_POS_MSEC, mid * 1000)
            ok, frame = cap.read()
            keyframe = frames_dir / f"scene_{i + 1:03d}.jpg"
            if ok:
                cv2.imwrite(str(keyframe), frame)
            scenes.append({"scene_num": i + 1, "start": start, "end": end, "keyframe": str(keyframe)})
        cap.release()
        return scenes

    @staticmethod
    def _gemini_client(gemini_api_key):
        from google import genai

        return genai.Client(api_key=gemini_api_key)

    async def _genai_vision(self, image_path, prompt, gemini_api_key, model):
        data = Path(image_path).read_bytes()
        image_text = base64.b64encode(data).decode("ascii")[:120000]
        full_prompt = f"{prompt}\nImage base64 JPEG:\n{image_text}"
        response = await agenerate_with_fallback(
            self._gemini_client(gemini_api_key),
            model=model,
            contents=[full_prompt],
        )
        return str(getattr(response, "text", "") or "").strip()

    async def _gemini_rewrite(self, raw_caption, gemini_api_key, model):
        prompt = f"Rewrite this raw visual caption into a cinematic Veo 3 prompt:\n{raw_caption}"
        response = await agenerate_with_fallback(
            self._gemini_client(gemini_api_key),
            model=model,
            contents=[prompt],
        )
        return str(getattr(response, "text", "") or "").strip()

    @staticmethod
    def _parse_rewrite(text):
        text = str(text or "").strip()
        match = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
        if match:
            text = match.group(1).strip()
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data.get("prompt") or data.get("caption") or data.get("text") or text
        except Exception:
            pass
        return text

    def _clean_caption(self, caption):
        text = re.sub(r"\s+", " ", str(caption or "")).strip()
        low = text.lower()
        for phrase in self._STRIP_PHRASES:
            if low.startswith(phrase):
                text = text[len(phrase):].lstrip(" ,:-")
                break
        return text.rstrip(".") + "." if text else ""

    async def _backbone_caption(self, image_path, gemini_api_key, model):
        return await self._genai_vision(
            image_path,
            self._VISION_PROMPT_1,
            gemini_api_key,
            model,
        )

    async def generate_captions(self, scenes, gemini_api_key, model, style_lock=None, global_context="", character_aliases=None, progress_cb=None):
        captions = []
        first_character = ""
        for idx, scene in enumerate(scenes or [], 1):
            if self._cancelled:
                raise RuntimeError("Analysis cancelled")
            if progress_cb:
                progress_cb(f"Generating prompt {idx}/{len(scenes)}")
            raw = await self._backbone_caption(
                scene.get("keyframe", ""),
                gemini_api_key,
                model,
            ) if scene.get("keyframe") else ""
            cleaned = self._clean_caption(raw)
            if idx == 1:
                first_character = cleaned
                rewrite_base = self._REWRITE_SCENE_1
            else:
                rewrite_base = self._REWRITE_SCENE_N + f"\nScene 1 character reference: {first_character}"
            context = f"\nGlobal context: {global_context}" if global_context else ""
            aliases = f"\nCharacter aliases: {', '.join(character_aliases or [])}" if character_aliases else ""
            rewritten = await self._gemini_rewrite(
                f"{rewrite_base}{context}{aliases}\nRaw caption: {cleaned}",
                gemini_api_key,
                model,
            )
            prompt = self._parse_rewrite(rewritten)
            item = dict(scene)
            item["raw_caption"] = raw
            item["caption"] = prompt
            item["prompt"] = prompt
            captions.append(item)
        return captions

    async def analyze(self, url, gemini_api_key, model, style_lock=None, global_context="", character_aliases=None, progress_cb=None):
        if not str(model or "").strip():
            raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")
        video_path, title, duration = await self.download(url, progress_cb)
        scenes = await self.detect_scenes(video_path, duration, progress_cb)
        captions = await self.generate_captions(
            scenes,
            gemini_api_key,
            model,
            style_lock=style_lock,
            global_context=global_context,
            character_aliases=character_aliases,
            progress_cb=progress_cb,
        )
        return {
            "title": title,
            "duration": duration,
            "video_path": video_path,
            "scenes": captions,
            "captions": captions,
        }
