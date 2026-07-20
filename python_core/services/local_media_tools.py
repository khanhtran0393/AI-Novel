"""
AI Novel — Local media tools (NAV-compatible behaviors, clean implementations).

Self-contained ffmpeg helpers. Does NOT depend on decompiled broken modules.
Resolves ffmpeg from python_core, project bin/, or PATH.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT.parent


def resolve_ffmpeg() -> str:
    env = (os.environ.get("FFMPEG_PATH") or "").strip()
    if env and Path(env).is_file():
        return env
    candidates = [
        ROOT / "ffmpeg" / "ffmpeg.exe",
        ROOT / "ffmpeg" / "bin" / "ffmpeg.exe",
        PROJECT_ROOT / "bin" / "ffmpeg.exe",
        PROJECT_ROOT / "bin" / "ffmpeg" / "ffmpeg.exe",
    ]
    try:
        from config.constants import FFMPEG_PATH as C_FFMPEG  # type: ignore

        if C_FFMPEG:
            candidates.insert(0, Path(str(C_FFMPEG)))
    except Exception:
        pass
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)
    which = shutil.which("ffmpeg")
    if which:
        return which
    return "ffmpeg"


def resolve_ffprobe() -> str:
    env = (os.environ.get("FFPROBE_PATH") or "").strip()
    if env and Path(env).is_file():
        return env
    ff = Path(resolve_ffmpeg())
    sibling = ff.parent / ("ffprobe.exe" if ff.suffix.lower() == ".exe" else "ffprobe")
    if sibling.is_file():
        return str(sibling)
    which = shutil.which("ffprobe")
    return which or "ffprobe"


def _run(cmd: list[str], timeout: int = 600) -> tuple[int, str, str]:
    try:
        kwargs: dict[str, Any] = {
            "capture_output": True,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "timeout": timeout,
        }
        if os.name == "nt":
            # Hide console window on Windows (CREATE_NO_WINDOW)
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        p = subprocess.run(cmd, **kwargs)
        return p.returncode, p.stdout or "", p.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except Exception as e:
        return 1, "", str(e)


def probe_video(path: str) -> dict[str, Any]:
    src = Path(path)
    if not src.is_file():
        return {"ok": False, "error": f"not found: {path}"}
    rc, out, err = _run(
        [
            resolve_ffprobe(),
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(src),
        ],
        timeout=60,
    )
    if rc != 0:
        return {"ok": False, "error": err or out or f"ffprobe rc={rc}"}
    if not out.strip():
        return {"ok": False, "error": "ffprobe returned no JSON"}
    try:
        data = json.loads(out)
        w = h = 0
        fps = 0.0
        duration = float((data.get("format") or {}).get("duration") or 0)
        for st in data.get("streams") or []:
            if st.get("codec_type") == "video":
                w = int(st.get("width") or 0)
                h = int(st.get("height") or 0)
                r = st.get("r_frame_rate") or "0/1"
                if "/" in str(r):
                    a, b = str(r).split("/", 1)
                    fps = float(a) / float(b) if float(b) else 0.0
                break
        return {
            "ok": True,
            "width": w,
            "height": h,
            "fps": fps,
            "duration": duration,
            "path": str(src),
        }
    except Exception as e:
        return {"ok": False, "error": f"probe parse: {e}", "stderr": err}


# ── Color grading (NAV presets) ───────────────────────────────────────────

COLOR_PRESETS: list[tuple[str, str]] = [
    ("🎬 Điện ảnh (Teal-Orange)", "colorbalance=rs=-0.08:bs=0.10:rh=0.10:bh=-0.10,eq=saturation=1.12:contrast=1.06"),
    ("🔥 Ấm áp (Warm)", "colorbalance=rs=0.10:gs=0.04:bs=-0.10,eq=saturation=1.08"),
    ("❄️ Lạnh (Cool)", "colorbalance=rs=-0.10:bs=0.12,eq=saturation=1.05"),
    ("🌈 Rực rỡ (Vivid)", "eq=saturation=1.40:contrast=1.10:brightness=0.02"),
    ("☀️ Tươi sáng (Bright)", "eq=brightness=0.06:contrast=1.05:gamma=1.08"),
    ("🌫️ Phai màu (Matte)", "eq=contrast=0.88:brightness=0.04:saturation=0.92"),
    ("🎞️ Hoài cổ (Vintage)", "curves=preset=vintage"),
    ("🧪 Cross Process", "curves=preset=cross_process"),
    ("📺 Tương phản cao", "curves=preset=strong_contrast,eq=saturation=1.05"),
    ("⚫ Trắng đen (B&W)", "hue=s=0,eq=contrast=1.08"),
]
_PRESET_MAP = {label: vf for label, vf in COLOR_PRESETS}


def list_color_presets() -> list[str]:
    return [p[0] for p in COLOR_PRESETS]


def grade_video(input_path: str, output_path: str, preset_label: str) -> dict[str, Any]:
    src, dst = Path(input_path), Path(output_path)
    if not src.is_file():
        return {"success": False, "error": f"missing input: {input_path}"}
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not preset_label or preset_label not in _PRESET_MAP:
        return {"success": False, "error": f"unknown color preset: {preset_label or '(missing)'}"}
    vf = _PRESET_MAP[preset_label]
    cmd = [
        resolve_ffmpeg(),
        "-y",
        "-i",
        str(src),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(dst),
    ]
    rc, out, err = _run(cmd, timeout=600)
    if rc != 0 or not dst.is_file() or dst.stat().st_size < 1000:
        return {"success": False, "error": err or out or f"ffmpeg rc={rc}", "output_path": str(dst)}
    return {"success": True, "output_path": str(dst), "preset": preset_label}


# ── Delogo Veo ─────────────────────────────────────────────────────────────

NATIVE_SHORT = 720
LOGO_PAD_R, LOGO_PAD_B, LOGO_W, LOGO_H = 85, 50, 70, 30


def delogo_video(input_path: str, output_path: str) -> dict[str, Any]:
    src, dst = Path(input_path), Path(output_path)
    if not src.is_file():
        return {"success": False, "error": f"missing input: {input_path}"}
    info = probe_video(str(src))
    if not info.get("ok"):
        return {"success": False, "error": info.get("error") or "probe failed"}
    w, h = int(info["width"]), int(info["height"])
    if w <= 0 or h <= 0:
        return {"success": False, "error": "invalid resolution"}
    scale = min(w, h) / float(NATIVE_SHORT) or 1.0
    lw = max(1, int(round(LOGO_W * scale)))
    lh = max(1, int(round(LOGO_H * scale)))
    x = max(1, min(int(round(w - LOGO_PAD_R * scale)), w - lw - 1))
    y = max(1, min(int(round(h - LOGO_PAD_B * scale)), h - lh - 1))
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = f"delogo=x={x}:y={y}:w={lw}:h={lh}:show=0"
    cmd = [
        resolve_ffmpeg(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-vf",
        vf,
        "-c:a",
        "copy",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        str(dst),
    ]
    rc, out, err = _run(cmd, timeout=300)
    if rc != 0 or not dst.is_file() or dst.stat().st_size < 1000:
        return {"success": False, "error": err or out or f"ffmpeg rc={rc}"}
    return {
        "success": True,
        "output_path": str(dst),
        "logo_box": {"x": x, "y": y, "w": lw, "h": lh},
        "resolution": f"{w}x{h}",
    }


# ── Frame extract + GIF ────────────────────────────────────────────────────

def extract_frames(
    input_path: str,
    output_dir: str,
    mode: str = "fps",
    value: float = 1.0,
    img_format: str = "png",
) -> dict[str, Any]:
    src = Path(input_path)
    out_dir = Path(output_dir)
    if not src.is_file():
        return {"success": False, "error": f"missing input: {input_path}"}
    out_dir.mkdir(parents=True, exist_ok=True)
    fmt = (img_format or "png").lower()
    if fmt not in ("png", "jpg", "jpeg"):
        return {"success": False, "error": f"unsupported image format: {fmt}"}
    if fmt == "jpeg":
        fmt = "jpg"
    if mode not in ("first", "last", "all", "count", "fps"):
        return {"success": False, "error": f"unsupported extract mode: {mode}"}

    if mode == "first":
        pattern = str(out_dir / f"{src.stem}_0001.{fmt}")
        cmd = [resolve_ffmpeg(), "-y", "-i", str(src), "-frames:v", "1", pattern]
    elif mode == "last":
        info = probe_video(str(src))
        if not info.get("ok"):
            return {
                "success": False,
                "error": f"ffprobe failed before last-frame extraction: {info.get('error') or 'unknown error'}",
            }
        dur = float(info.get("duration") or 0)
        if dur <= 0:
            return {"success": False, "error": "ffprobe returned invalid video duration"}
        seek = max(0.0, dur - 0.15) if dur > 0.2 else 0.0
        pattern = str(out_dir / f"{src.stem}_last.{fmt}")
        cmd = [
            resolve_ffmpeg(),
            "-y",
            "-ss",
            f"{seek:.3f}",
            "-i",
            str(src),
            "-frames:v",
            "1",
            pattern,
        ]
    else:
        pattern = str(out_dir / f"{src.stem}_%04d.{fmt}")
        vf: Optional[str] = None
        if mode == "all":
            vf = None
        elif mode == "count":
            n = int(value)
            if n <= 0:
                return {"success": False, "error": "frame count must be greater than zero"}
            info = probe_video(str(src))
            if not info.get("ok"):
                return {
                    "success": False,
                    "error": f"ffprobe failed before count extraction: {info.get('error') or 'unknown error'}",
                }
            dur = float(info.get("duration") or 0)
            if dur <= 0:
                return {"success": False, "error": "ffprobe returned invalid video duration"}
            fps = n / dur
            vf = f"fps={max(fps, 0.05):.6f}"
        else:  # fps
            fps = float(value)
            if fps <= 0:
                return {"success": False, "error": "fps must be greater than zero"}
            vf = f"fps={fps:.4f}"
        cmd = [resolve_ffmpeg(), "-y", "-i", str(src)]
        if vf:
            cmd += ["-vf", vf]
        cmd += [pattern]

    rc, out, err = _run(cmd, timeout=600)
    frames = sorted(out_dir.glob(f"{src.stem}_*.{fmt}")) + sorted(out_dir.glob(f"{src.stem}_last.{fmt}"))
    # unique
    seen = set()
    uniq = []
    for f in frames:
        if f.resolve() not in seen:
            seen.add(f.resolve())
            uniq.append(f)
    if rc != 0:
        return {"success": False, "error": err or out or f"ffmpeg rc={rc}"}
    if not uniq:
        return {"success": False, "error": "ffmpeg completed without producing frames"}
    return {
        "success": True,
        "count": len(uniq),
        "frames": [str(p) for p in uniq],
        "output_dir": str(out_dir),
        "mode": mode,
    }


def make_gif(
    input_path: str,
    output_path: str,
    start: float = 0.0,
    duration: float = 3.0,
    width: int = 480,
    fps: int = 12,
) -> dict[str, Any]:
    src, dst = Path(input_path), Path(output_path)
    if not src.is_file():
        return {"success": False, "error": f"missing input: {input_path}"}
    dst.parent.mkdir(parents=True, exist_ok=True)
    start = max(0.0, float(start))
    duration = max(0.2, float(duration))
    width = max(64, int(width))
    fps = max(4, min(30, int(fps)))
    # 2-pass palette
    with tempfile.TemporaryDirectory() as td:
        pal = Path(td) / "palette.png"
        vf_pal = f"fps={fps},scale={width}:-1:flags=lanczos,palettegen"
        cmd1 = [
            resolve_ffmpeg(),
            "-y",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(src),
            "-vf",
            vf_pal,
            str(pal),
        ]
        rc1, _, err1 = _run(cmd1, timeout=180)
        if rc1 != 0 or not pal.is_file():
            return {"success": False, "error": err1 or "palettegen failed"}
        vf_use = f"fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse"
        cmd2 = [
            resolve_ffmpeg(),
            "-y",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(src),
            "-i",
            str(pal),
            "-lavfi",
            vf_use,
            str(dst),
        ]
        rc2, _, err2 = _run(cmd2, timeout=180)
        if rc2 != 0 or not dst.is_file():
            return {"success": False, "error": err2 or "gif encode failed"}
    return {"success": True, "output_path": str(dst)}


# ── Concat ─────────────────────────────────────────────────────────────────

def concat_videos(
    input_paths: list[str],
    output_path: str,
    re_encode: bool = True,
) -> dict[str, Any]:
    paths = [Path(p) for p in input_paths if Path(p).is_file()]
    if len(paths) < 1:
        return {"success": False, "error": "need at least 1 existing video"}
    dst = Path(output_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    list_file = dst.with_suffix(".concat.txt")
    try:
        with open(list_file, "w", encoding="utf-8") as f:
            for p in paths:
                safe = str(p.resolve()).replace("\\", "/").replace("'", "'\\''")
                f.write(f"file '{safe}'\n")
        if re_encode:
            cmd = [
                resolve_ffmpeg(),
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                str(dst),
            ]
        else:
            cmd = [
                resolve_ffmpeg(),
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c",
                "copy",
                str(dst),
            ]
        rc, out, err = _run(cmd, timeout=900)
        if rc != 0 or not dst.is_file():
            return {"success": False, "error": err or out or f"rc={rc}"}
        return {
            "success": True,
            "output_path": str(dst),
            "count": len(paths),
            "size_mb": round(dst.stat().st_size / 1048576, 2),
        }
    finally:
        try:
            list_file.unlink(missing_ok=True)
        except Exception:
            pass


# ── Resize ─────────────────────────────────────────────────────────────────

ASPECT_SPECS = {
    "9:16": (9, 16, 720, 1280),
    "16:9": (16, 9, 1280, 720),
    "1:1": (1, 1, 1080, 1080),
    "4:5": (4, 5, 1080, 1350),
    "21:9": (21, 9, 2560, 1080),
}


def resize_video(
    input_path: str,
    output_path: str,
    ratio: str,
    alignment: str,
) -> dict[str, Any]:
    src, dst = Path(input_path), Path(output_path)
    if not src.is_file():
        return {"success": False, "error": f"missing input: {input_path}"}
    info = probe_video(str(src))
    if not info.get("ok"):
        return {"success": False, "error": f"ffprobe failed before resize: {info.get('error') or 'unknown error'}"}
    sw, sh = int(info.get("width") or 0), int(info.get("height") or 0)
    if sw <= 0 or sh <= 0:
        return {"success": False, "error": "ffprobe returned invalid video dimensions"}
    if ratio not in ASPECT_SPECS:
        return {"success": False, "error": f"unsupported aspect ratio: {ratio}"}
    spec = ASPECT_SPECS[ratio]
    rw, rh, def_w, def_h = spec
    longest = max(sw, sh)
    if rw >= rh:
        tw = longest
        th = int(tw * rh / rw)
    else:
        th = longest
        tw = int(th * rw / rh)
    tw = min(tw // 2 * 2, def_w * 2)
    th = min(th // 2 * 2, def_h * 2)
    align = alignment.lower()
    if align not in ("fit", "fill"):
        return {"success": False, "error": f"unsupported alignment: {alignment}"}
    if align == "fill":
        vf = f"scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th}"
    else:
        vf = f"scale={tw}:{th}:force_original_aspect_ratio=decrease,pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=black"
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        resolve_ffmpeg(),
        "-y",
        "-i",
        str(src),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(dst),
    ]
    rc, out, err = _run(cmd, timeout=600)
    if rc != 0 or not dst.is_file():
        return {"success": False, "error": err or out or f"rc={rc}"}
    return {
        "success": True,
        "output_path": str(dst),
        "target": f"{tw}x{th}",
        "ratio": ratio,
        "alignment": align,
    }


# ── Timeline simple compose (trim+concat subset) ───────────────────────────

def compose_timeline_simple(
    clips: list[dict[str, Any]],
    output_path: str,
) -> dict[str, Any]:
    """
    clips: [{path, start?, end?, speed?}]
    Renders each clip segment then concatenates.
    """
    if not clips:
        return {"success": False, "error": "no clips"}
    dst = Path(output_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        parts: list[Path] = []
        for i, c in enumerate(clips):
            p = Path(str(c.get("path") or ""))
            if not p.is_file():
                return {"success": False, "error": f"clip missing: {p}"}
            start = float(c.get("start") or 0)
            end = c.get("end")
            speed = float(c.get("speed") or 1.0) or 1.0
            part = td_path / f"part_{i:03d}.mp4"
            cmd = [resolve_ffmpeg(), "-y"]
            if start > 0:
                cmd += ["-ss", str(start)]
            cmd += ["-i", str(p)]
            if end is not None and float(end) > start:
                cmd += ["-t", str(float(end) - start)]
            vf_parts = []
            af_parts = []
            if abs(speed - 1.0) > 0.01:
                vf_parts.append(f"setpts=PTS/{speed}")
                # atempo chain 0.5-2.0
                sp = speed
                while sp > 2.0:
                    af_parts.append("atempo=2.0")
                    sp /= 2.0
                while sp < 0.5:
                    af_parts.append("atempo=0.5")
                    sp /= 0.5
                af_parts.append(f"atempo={sp:.4f}")
            if vf_parts:
                cmd += ["-vf", ",".join(vf_parts)]
            if af_parts:
                cmd += ["-af", ",".join(af_parts)]
            cmd += [
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                str(part),
            ]
            rc, _, err = _run(cmd, timeout=300)
            if rc != 0 or not part.is_file():
                return {"success": False, "error": f"clip {i}: {err or rc}"}
            parts.append(part)
        return concat_videos([str(p) for p in parts], str(dst), re_encode=True)


def capabilities() -> dict[str, Any]:
    ff = resolve_ffmpeg()
    fp = resolve_ffprobe()
    return {
        "ffmpeg": ff,
        "ffmpeg_exists": Path(ff).is_file() or shutil.which(ff) is not None,
        "ffprobe": fp,
        "color_presets": list_color_presets(),
        "aspect_ratios": list(ASPECT_SPECS.keys()),
        "extract_modes": ["fps", "count", "all", "first", "last"],
        "tools": [
            "color_grade",
            "delogo",
            "extract_frames",
            "make_gif",
            "concat_videos",
            "resize_video",
            "compose_timeline",
            "probe_video",
        ],
    }
