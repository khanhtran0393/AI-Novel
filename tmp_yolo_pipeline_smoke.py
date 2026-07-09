# -*- coding: utf-8 -*-
"""Smoke test YOLO auto-pipeline stages (same order as /api/navtools/auto-pipeline)."""
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
OUT = ROOT / "public" / "navtools" / "pipeline" / f"smoke_{int(time.time())}"
OUT.mkdir(parents=True, exist_ok=True)

FFMPEG = ROOT / "bin" / "ffmpeg.exe"
if not FFMPEG.is_file():
    FFMPEG = PC / "ffmpeg" / "ffmpeg.exe"


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
        return {"success": False, "error": "no json", "stdout": (p.stdout or "")[:400]}
    return json.loads(lines[-1])


def ensure_src() -> pathlib.Path:
    src = OUT / "source.mp4"
    if src.is_file() and src.stat().st_size > 50_000:
        return src
    e2e = ROOT / "tmp_nav_e2e" / "source_test.mp4"
    if e2e.is_file():
        shutil.copy2(e2e, src)
        return src
    cmd = [
        str(FFMPEG),
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
        raise SystemExit(f"cannot create source: {r.stderr[-300:]}")
    return src


def main() -> int:
    src = ensure_src()
    log = []
    print("OUT", OUT)
    print("SRC", src, src.stat().st_size)

    # Split into 2 clips so concat is meaningful
    split_dir = OUT / "splits"
    split_dir.mkdir(exist_ok=True)
    r = gw(
        "split_video",
        {"video_path": str(src), "output_dir": str(split_dir), "target_duration": 2},
    )
    clips = r.get("clips") or sorted(str(p) for p in split_dir.glob("*.mp4"))
    print("split", r.get("success"), "clips", len(clips))
    log.append(("split", bool(r.get("success")) and len(clips) >= 1))

    if len(clips) < 2:
        clips = [str(src), str(src)]

    chain = []
    for i, c in enumerate(clips[:3]):
        g_out = str(OUT / f"grade_{i+1}.mp4")
        g = gw("color_grade", {"video_path": c, "output_path": g_out})
        ok = bool(g.get("success") and pathlib.Path(g_out).is_file())
        print("grade", i + 1, ok, pathlib.Path(g_out).stat().st_size if ok else g.get("error"))
        log.append((f"grade_{i+1}", ok))
        cur = g_out if ok else c

        d_out = str(OUT / f"delogo_{i+1}.mp4")
        d = gw("delogo", {"video_path": cur, "output_path": d_out})
        ok2 = bool(d.get("success") and pathlib.Path(d_out).is_file())
        print("delogo", i + 1, ok2, pathlib.Path(d_out).stat().st_size if ok2 else d.get("error"))
        log.append((f"delogo_{i+1}", ok2))
        chain.append(d_out if ok2 else cur)

    final = str(OUT / "FINAL_concat.mp4")
    j = gw("concat_videos", {"input_paths": chain, "output_path": final, "re_encode": True})
    okj = bool(j.get("success") and pathlib.Path(final).is_file() and pathlib.Path(final).stat().st_size > 1000)
    print("concat", okj, pathlib.Path(final).stat().st_size if okj else j.get("error"))
    log.append(("concat", okj))

    gif = str(OUT / "preview.gif")
    g2 = gw(
        "make_gif",
        {"video_path": final if okj else chain[0], "output_path": gif, "duration": 2, "width": 320},
    )
    okg = bool(g2.get("success") and pathlib.Path(gif).is_file())
    print("gif", okg, pathlib.Path(gif).stat().st_size if okg else g2.get("error"))
    log.append(("gif", okg))

    summary = {"out": str(OUT), "steps": log, "final": final if okj else None}
    (OUT / "smoke_result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    failed = [n for n, ok in log if not ok]
    print("=== YOLO SMOKE ===")
    print("PASS" if not failed else f"FAIL {failed}")
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.suffix.lower() in {".mp4", ".gif", ".json"}:
            print(f"  {p.relative_to(OUT)}  {p.stat().st_size} B")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
