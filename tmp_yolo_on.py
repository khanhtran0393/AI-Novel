# -*- coding: utf-8 -*-
"""Bật YOLO: chạy pipeline live + publish LATEST_FINAL.mp4"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent
PC = ROOT / "python_core"
GW = PC / "gateway" / "nav_gateway.py"
LATEST_DIR = ROOT / "public" / "navtools" / "pipeline"
OUT = LATEST_DIR / f"yolo_live_{int(time.time())}"
OUT.mkdir(parents=True, exist_ok=True)

FF = ROOT / "bin" / "ffmpeg.exe"
if not FF.is_file():
    FF = PC / "ffmpeg" / "ffmpeg.exe"


def gw(action: str, payload: dict, timeout: int = 300) -> dict:
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
    if not lines:
        return {"success": False, "error": (p.stderr or p.stdout or "no json")[:500]}
    return json.loads(lines[-1])


def main() -> int:
    print("YOLO BOOT", flush=True)
    print("OUT", OUT, flush=True)

    src_candidate = ROOT / "tmp_nav_e2e" / "source_test.mp4"
    src = OUT / "source.mp4"
    if src_candidate.is_file():
        shutil.copy2(src_candidate, src)
    else:
        cmd = [
            str(FF),
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=24:duration=5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100:duration=5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(src),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0 or not src.is_file():
            print("FAIL create source", r.stderr[-300:], flush=True)
            return 2

    print("SRC size", src.stat().st_size, flush=True)

    split_dir = OUT / "splits"
    split_dir.mkdir(exist_ok=True)
    r = gw(
        "split_video",
        {"video_path": str(src), "output_dir": str(split_dir), "target_duration": 2},
    )
    clips = r.get("clips") or [str(p) for p in sorted(split_dir.glob("*.mp4"))]
    print("clips", len(clips), flush=True)
    if len(clips) < 2:
        clips = [str(src), str(src)]

    chain: list[str] = []
    for i, c in enumerate(clips[:3]):
        g = OUT / f"grade_{i + 1}.mp4"
        d = OUT / f"delogo_{i + 1}.mp4"
        gg = gw("color_grade", {"video_path": c, "output_path": str(g)})
        print("grade", i + 1, gg.get("success"), g.stat().st_size if g.is_file() else 0, flush=True)
        cur = str(g) if g.is_file() else c
        dd = gw("delogo", {"video_path": cur, "output_path": str(d)})
        print("delogo", i + 1, dd.get("success"), d.stat().st_size if d.is_file() else 0, flush=True)
        chain.append(str(d) if d.is_file() else cur)

    final = OUT / "FINAL_concat.mp4"
    jj = gw("concat_videos", {"input_paths": chain, "output_path": str(final), "re_encode": True})
    print("concat", jj.get("success"), final.stat().st_size if final.is_file() else 0, flush=True)

    gif = OUT / "preview.gif"
    src_gif = str(final if final.is_file() else chain[0])
    gf = gw(
        "make_gif",
        {"video_path": src_gif, "output_path": str(gif), "duration": 2, "width": 360},
    )
    print("gif", gf.get("success"), gif.stat().st_size if gif.is_file() else 0, flush=True)

    ok = final.is_file() and final.stat().st_size > 1000
    if ok:
        shutil.copy2(final, LATEST_DIR / "LATEST_FINAL.mp4")
    if gif.is_file():
        shutil.copy2(gif, LATEST_DIR / "LATEST_preview.gif")

    meta = {
        "yolo": True,
        "status": "ON" if ok else "FAIL",
        "work_dir": str(OUT),
        "final": str(final),
        "final_size": final.stat().st_size if final.is_file() else 0,
        "gif_size": gif.stat().st_size if gif.is_file() else 0,
        "latest": str(LATEST_DIR / "LATEST_FINAL.mp4"),
        "public_url": "/navtools/pipeline/LATEST_FINAL.mp4",
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (LATEST_DIR / "YOLO_STATUS.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "result.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2), flush=True)
    print("YOLO", meta["status"], flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
