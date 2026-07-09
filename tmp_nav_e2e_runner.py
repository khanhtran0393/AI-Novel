# -*- coding: utf-8 -*-
"""End-to-end NAV gateway smoke test — verifies real file outputs."""
from __future__ import annotations

import glob
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PC = ROOT / "python_core"
GW = PC / "gateway" / "nav_gateway.py"
OUT = ROOT / "tmp_nav_e2e"
OUT.mkdir(exist_ok=True)

FFMPEG = ROOT / "bin" / "ffmpeg.exe"
if not FFMPEG.is_file():
    FFMPEG = PC / "ffmpeg" / "ffmpeg.exe"
if not FFMPEG.is_file():
    FFMPEG = pathlib.Path(shutil.which("ffmpeg") or "ffmpeg")

SRC = OUT / "source_test.mp4"
IMG = ROOT / "test.png"
AUDIO = ROOT / "python_core" / "assets" / "voice_refs" / "minhquan.mp3"

results: list[dict] = []


def make_source_video() -> pathlib.Path:
    """Create a real 6s 640x360 test video with tone so tools produce non-trivial outputs."""
    if SRC.is_file() and SRC.stat().st_size > 50_000:
        return SRC
    cmd = [
        str(FFMPEG),
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x360:rate=24:duration=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=6",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        str(SRC),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0 or not SRC.is_file():
        raise RuntimeError(f"failed to create source video: {p.stderr[-500:]}")
    return SRC


def run(action: str, payload: dict, timeout: int = 300) -> dict:
    env = {**os.environ, "PYTHONPATH": str(PC), "PYTHONIOENCODING": "utf-8"}
    p = subprocess.run(
        [sys.executable, str(GW), action, json.dumps(payload, ensure_ascii=False)],
        cwd=str(PC),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=timeout,
    )
    lines = [ln for ln in (p.stdout or "").splitlines() if ln.strip().startswith("{")]
    if lines:
        try:
            data = json.loads(lines[-1])
        except Exception as e:
            data = {"success": False, "error": f"parse: {e}", "raw": lines[-1][:500]}
    else:
        data = {
            "success": False,
            "error": "no json",
            "stdout": (p.stdout or "")[:800],
            "stderr": (p.stderr or "")[:400],
            "rc": p.returncode,
        }

    ok = bool(data.get("success"))
    op = data.get("output_path")
    if not op and isinstance(data.get("result"), dict):
        op = data["result"].get("output_path") or data["result"].get("output")
    frames = data.get("frames") or []
    clips = data.get("clips") or []
    files_ok: list[str] = []
    for candidate in [op, *frames[:20], *clips[:20]]:
        if not candidate:
            continue
        pp = pathlib.Path(str(candidate))
        if pp.is_file() and pp.stat().st_size > 50:
            files_ok.append(str(pp))
    srt = data.get("srt_path")
    if srt and pathlib.Path(str(srt)).is_file():
        files_ok.append(str(srt))
    res = data.get("result")
    if isinstance(res, dict):
        for k in ("output", "output_path", "path", "out"):
            v = res.get(k)
            if v and pathlib.Path(str(v)).is_file():
                files_ok.append(str(v))

    # unique preserve order
    seen = set()
    uniq = []
    for f in files_ok:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    files_ok = uniq

    row = {
        "action": action,
        "success": ok,
        "error": data.get("error") or data.get("warning"),
        "output_path": op,
        "files_verified": files_ok,
        "file_count": len(files_ok),
        "size_hint": data.get("count") or data.get("size_mb") or data.get("resolution"),
        "engine": data.get("engine") or (res.get("engine") if isinstance(res, dict) else None),
    }
    results.append(row)
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {action} | files={len(files_ok)} | err={row['error'] or '-'}")
    return data


def main() -> int:
    src = make_source_video()
    print("SRC", src, "size", src.stat().st_size)
    print("OUT", OUT)

    run("ping", {})
    run("capabilities", {})
    run("list_presets", {})
    run("flow_status", {})
    run("scheduler_list", {})
    run(
        "scheduler_save",
        {
            "name": "e2e-test-job",
            "image_prompts": ["a neon cyberpunk alley at night"],
            "video_prompts": ["camera pan across ruins"],
            "status": "idle",
        },
    )
    run("scheduler_list", {})
    run("probe_video", {"video_path": str(src)})

    grade_out = str(OUT / "grade.mp4")
    run("color_grade", {"video_path": str(src), "output_path": grade_out, "preset": ""})

    delogo_out = str(OUT / "delogo.mp4")
    run("delogo", {"video_path": str(src), "output_path": delogo_out})

    frames_dir = str(OUT / "frames")
    # clean frames dir
    pathlib.Path(frames_dir).mkdir(parents=True, exist_ok=True)
    for old in pathlib.Path(frames_dir).glob("*"):
        try:
            old.unlink()
        except Exception:
            pass
    run(
        "extract_frames",
        {"video_path": str(src), "output_dir": frames_dir, "mode": "count", "value": 4},
    )

    gif_out = str(OUT / "sample.gif")
    run(
        "make_gif",
        {
            "video_path": str(src),
            "output_path": gif_out,
            "start": 0,
            "duration": 2,
            "width": 320,
            "fps": 10,
        },
    )

    split_dir = str(OUT / "splits")
    pathlib.Path(split_dir).mkdir(parents=True, exist_ok=True)
    for old in pathlib.Path(split_dir).glob("*.mp4"):
        try:
            old.unlink()
        except Exception:
            pass
    run(
        "split_video",
        {"video_path": str(src), "output_dir": split_dir, "target_duration": 2},
        timeout=180,
    )

    splits = sorted(glob.glob(str(pathlib.Path(split_dir) / "*.mp4")))
    print("splits found", len(splits))
    join_out = str(OUT / "joined.mp4")
    if len(splits) >= 2:
        run(
            "concat_videos",
            {"input_paths": splits[:2], "output_path": join_out, "re_encode": True},
        )
    else:
        run(
            "concat_videos",
            {
                "input_paths": [grade_out, delogo_out],
                "output_path": join_out,
                "re_encode": True,
            },
        )

    resize_out = str(OUT / "resize_916.mp4")
    run(
        "resize_video",
        {
            "video_path": str(src),
            "output_path": resize_out,
            "ratio": "9:16",
            "alignment": "fit",
        },
    )

    tl_out = str(OUT / "timeline.mp4")
    run(
        "compose_timeline",
        {
            "clips": [
                {"path": str(src), "start": 0, "end": 2, "speed": 1.0},
                {"path": str(src), "start": 1, "end": 3, "speed": 1.25},
            ],
            "output_path": tl_out,
        },
    )

    if IMG.is_file():
        up_out = str(OUT / "upscaled.png")
        run(
            "upscale",
            {"image_path": str(IMG), "out_path": up_out, "target_height": 0},
            timeout=600,
        )
        bg_out = str(OUT / "nobg.png")
        run("bg_remove", {"image_path": str(IMG), "out_path": bg_out}, timeout=600)
    else:
        print("SKIP upscale/bg — no test.png")

    if AUDIO.is_file():
        wm_out = str(OUT / "wm_audio.mp3")
        run(
            "watermark_audio",
            {"audio_path": str(AUDIO), "mode": "embed", "output_path": wm_out},
            timeout=180,
        )
        # detect on produced file if exists
        if pathlib.Path(wm_out).is_file():
            run(
                "watermark_audio",
                {"audio_path": wm_out, "mode": "detect"},
                timeout=120,
            )
    else:
        print("SKIP watermark — no audio")

    passed = sum(1 for r in results if r["success"])
    failed = [r for r in results if not r["success"]]
    print("\n=== SUMMARY ===")
    print(f"PASS {passed}/{len(results)}")
    for r in failed:
        print("FAIL", r["action"], r.get("error"))

    summary_path = OUT / "e2e_results.json"
    summary_path.write_text(
        json.dumps({"src": str(src), "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("wrote", summary_path)
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.suffix.lower() in {
            ".mp4",
            ".png",
            ".gif",
            ".mp3",
            ".srt",
            ".json",
            ".wav",
        }:
            print(f"  {p.relative_to(OUT)}  {p.stat().st_size} bytes")

    core = {
        "ping",
        "probe_video",
        "color_grade",
        "delogo",
        "extract_frames",
        "make_gif",
        "resize_video",
        "compose_timeline",
        "watermark_audio",
        "scheduler_save",
        "concat_videos",
    }
    core_fail = [r for r in results if r["action"] in core and not r["success"]]
    media_actions = {
        "color_grade",
        "delogo",
        "extract_frames",
        "make_gif",
        "resize_video",
        "compose_timeline",
        "concat_videos",
    }
    no_files = [
        r
        for r in results
        if r["action"] in media_actions and r["success"] and r["file_count"] == 0
    ]
    # watermark embed must produce a file
    wm_rows = [r for r in results if r["action"] == "watermark_audio" and "embed" not in str(r)]
    # check first watermark row has files if success
    wm_embed = next((r for r in results if r["action"] == "watermark_audio"), None)
    if wm_embed and wm_embed["success"] and wm_embed["file_count"] == 0:
        # re-check path
        if not pathlib.Path(OUT / "wm_audio.mp3").is_file():
            no_files.append(wm_embed)

    if core_fail or no_files:
        print("CORE/MEDIA VERIFICATION FAILED")
        print("core_fail", core_fail)
        print("no_files", no_files)
        return 1

    # size sanity: grade should be substantial for 6s testsrc
    if pathlib.Path(grade_out).is_file() and pathlib.Path(grade_out).stat().st_size < 20_000:
        print("WARNING: grade output unusually small", pathlib.Path(grade_out).stat().st_size)
    print("CORE MEDIA VERIFIED OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
