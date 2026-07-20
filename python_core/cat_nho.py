# -*- coding: utf-8 -*-
"""
BĂM VIDEO DÀI -> NHIỀU CLIP NGẮN theo CẢNH (PySceneDetect) — phục vụ reup shorts.

Ý tưởng: dò ranh giới CẢNH bằng PySceneDetect (ContentDetector, OpenCV, CPU-only) rồi GOM
các cảnh liền nhau thành chunk ~độ-dài-mục-tiêu, CẮT TẠI ranh giới cảnh (không cắt giữa cảnh).
Tùy chọn đổi khung 9:16 (nền mờ) ngay trong cùng lần encode qua xu_ly_video.bien_doi_khung.

Không thêm dep nặng: chỉ `scenedetect` (kéo theo opencv/numpy đã có). Chạy được cả CPU lẫn GPU.

CLI:
  python cat_nho.py <video> [thu_muc_ra] [--muc-tieu 40] [--ratio 9:16] [--nguong 27] [--chinh-xac]
"""
import os
import json
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import xu_ly_video

# Windows: ẩn cửa sổ console của ffmpeg/ffprobe (chuẩn dự án)
_CNW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _cfg():
    """cfg đầy đủ (ffmpeg/ffprobe/encoder...) tương thích bien_doi_khung — tái dùng nạp_config."""
    cfg = xu_ly_video.tu_tim_ffmpeg(xu_ly_video.nap_config())
    cfg["crf"] = int(cfg.get("crf", 23))
    return cfg


def thoi_luong(video, ffprobe, ffmpeg=None):
    """Thời lượng (giây) của video; 0.0 nếu lỗi."""
    try:
        kq = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video],
            capture_output=True, text=True, timeout=60, creationflags=_CNW)
        if kq.returncode == 0 and kq.stdout.strip():
            return float(kq.stdout.strip())
    except Exception:
        pass
    if not ffmpeg:
        return 0.0
    try:
        probe = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", video],
            capture_output=True, text=True, timeout=60, creationflags=_CNW)
        text = (probe.stderr or "") + "\n" + (probe.stdout or "")
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if not match:
            return 0.0
        hours, minutes, seconds = match.groups()
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except Exception:
        return 0.0


def phat_hien_canh(video, nguong=27.0, log_fn=print):
    """Trả list (start_sec, end_sec) của TỪNG cảnh bằng PySceneDetect. [] nếu lỗi/không có cảnh."""
    try:
        from scenedetect import detect, ContentDetector
    except Exception as e:
        log_fn("⚠ Thiếu scenedetect (%s) → cắt theo thời lượng đều." % str(e)[:60])
        return []
    try:
        scenes = detect(video, ContentDetector(threshold=float(nguong)))
    except Exception as e:
        log_fn("⚠ Dò cảnh lỗi (%s) → cắt theo thời lượng đều." % str(e)[:60])
        return []
    return [(s.get_seconds(), e.get_seconds()) for s, e in scenes]


def _chia_deu(s, e, muc_tieu):
    """Chia khoảng [s, e] thành các đoạn ~muc_tieu giây (đều nhau)."""
    n = max(1, int(round((e - s) / max(1.0, muc_tieu))))
    buoc = (e - s) / n
    return [(s + i * buoc, s + (i + 1) * buoc) for i in range(n)]


def gom_chunk(canh, dur_total, muc_tieu=40.0, toi_thieu=None, toi_da=None):
    """Gom các cảnh liền nhau thành chunk ~muc_tieu giây, CẮT tại ranh giới cảnh.
    - cảnh đơn dài hơn toi_da -> chia đều thành nhiều đoạn.
    - chunk cuối ngắn hơn toi_thieu -> gộp vào chunk trước.
    toi_thieu/toi_da mặc định theo TỈ LỆ muc_tieu (0.5x / 2x) để khớp mọi độ dài mục tiêu.
    Trả list (start, end). Không có cảnh -> chia đều cả video."""
    if toi_thieu is None:
        toi_thieu = muc_tieu * 0.5
    if toi_da is None:
        toi_da = muc_tieu * 2.0
    if not canh:
        return _chia_deu(0.0, dur_total, muc_tieu)
    chunks = []
    cs = canh[0][0]
    for (_s, e) in canh:
        if e - cs >= muc_tieu:      # tới ngưỡng -> chốt chunk tại CUỐI cảnh này
            chunks.append((cs, e))
            cs = e
    if cs < dur_total - 0.1:        # phần đuôi còn lại
        chunks.append((cs, dur_total))
    if len(chunks) >= 2 and (chunks[-1][1] - chunks[-1][0]) < toi_thieu:
        cuoi = chunks.pop()
        chunks[-1] = (chunks[-1][0], cuoi[1])
    out = []
    for (s, e) in chunks:
        if e - s > toi_da:
            out.extend(_chia_deu(s, e, muc_tieu))
        else:
            out.append((s, e))
    return out


def _cat_copy(ff, video, s, d, dst):
    """Cắt nhanh KHÔNG re-encode (-c copy) — keyframe-accurate, tức thì. Trả True nếu ra dst."""
    cmd = [ff, "-y", "-ss", "%.3f" % s, "-i", video, "-t", "%.3f" % d,
           "-c", "copy", "-movflags", "+faststart", dst]
    kq = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                        errors="replace", creationflags=_CNW)
    return kq.returncode == 0 and os.path.isfile(dst)


def cat(video, thu_muc_ra="", muc_tieu=40.0, ratio="", nguong=27.0, chinh_xac=False, log_fn=print):
    """Băm `video` thành nhiều clip trong `thu_muc_ra`.
    - muc_tieu: độ dài mục tiêu mỗi clip (giây).
    - ratio: "" giữ khung | "9:16" | "16:9" (đổi khung nền mờ, cùng lần encode khi cắt).
    - chinh_xac: True -> cắt re-encode (chính xác frame) kể cả khi ratio="" (chậm hơn).
    Trả list đường dẫn clip đã tạo."""
    video = os.path.abspath(video)
    if not os.path.isfile(video):
        log_fn("⚠ Không thấy video: %s" % video)
        return []
    cfg = _cfg()
    ff, ffp = cfg["ffmpeg_path"], cfg["ffprobe_path"]
    dur = thoi_luong(video, ffp, ff)
    if dur <= 0:
        log_fn("⚠ Không đọc được thời lượng (ffprobe). Bỏ qua.")
        return []
    if not thu_muc_ra:
        thu_muc_ra = os.path.join(os.path.dirname(video), "clip_nho")
    os.makedirs(thu_muc_ra, exist_ok=True)

    canh = phat_hien_canh(video, nguong, log_fn)
    khoang = gom_chunk(canh, dur, muc_tieu)
    log_fn("🎬 %d cảnh → ✂ băm %d clip (mục tiêu ~%.0fs%s)."
           % (len(canh), len(khoang), muc_tieu, (" + " + ratio) if ratio else ""))

    ten = os.path.splitext(os.path.basename(video))[0]
    doi_khung = ratio in xu_ly_video.KHUNG_RATIO
    ra = []
    for i, (s, e) in enumerate(khoang, 1):
        d = e - s
        if d < 1.0:
            continue
        hau_to = ("_" + ratio.replace(":", "x")) if doi_khung else ""
        dst = os.path.join(thu_muc_ra, "%s_cảnh%02d%s.mp4" % (ten, i, hau_to))
        if doi_khung or chinh_xac:
            # 1 lần encode: cắt [s, s+d] + (đổi khung 9:16 nếu có) — chính xác theo frame
            ok, err = xu_ly_video.bien_doi_khung(cfg, video, dst, ratio=ratio, ss=s, dur=d)
            if not ok:
                log_fn("  ⚠ clip%02d lỗi: %s" % (i, (err or "")[:200]))
                continue
        else:
            # nhanh: copy stream (không encode)
            if not _cat_copy(ff, video, s, d, dst):
                log_fn("  ⚠ clip%02d cắt -c copy lỗi → thử re-encode." % i)
                ok, err = xu_ly_video.bien_doi_khung(cfg, video, dst, ss=s, dur=d)
                if not ok:
                    log_fn("  ⚠ clip%02d lỗi: %s" % (i, (err or "")[:200]))
                    continue
        ra.append(dst)
        log_fn("  ✓ %s (%.1fs)" % (os.path.basename(dst), d))
    log_fn("✅ Xong: %d/%d clip → %s" % (len(ra), len(khoang), thu_muc_ra))
    return ra


def main(argv):
    # Ép console UTF-8 để in được emoji/tiếng Việt (Windows mặc định cp1252 -> crash)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if not argv:
        print(json.dumps({
            "success": False,
            "error": "Usage: python cat_nho.py <video> [output_dir] [--muc-tieu 40] [--ratio 9:16] [--nguong 27] [--chinh-xac]",
        }, ensure_ascii=False))
        return 1
        print("Dùng: python cat_nho.py <video> [thu_muc_ra] "
              "[--muc-tieu 40] [--ratio 9:16] [--nguong 27] [--chinh-xac]")
        return 1
    video = argv[0]
    thu_muc_ra = ""
    muc_tieu, ratio, nguong, chinh_xac = 40.0, "", 27.0, False
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--muc-tieu" and i + 1 < len(argv):
            muc_tieu = float(argv[i + 1]); i += 2
        elif a == "--ratio" and i + 1 < len(argv):
            ratio = argv[i + 1]; i += 2
        elif a == "--nguong" and i + 1 < len(argv):
            nguong = float(argv[i + 1]); i += 2
        elif a == "--chinh-xac":
            chinh_xac = True; i += 1
        elif not a.startswith("--") and not thu_muc_ra:
            thu_muc_ra = a; i += 1
        else:
            i += 1
    resolved_output_dir = thu_muc_ra or os.path.join(os.path.dirname(os.path.abspath(video)), "clip_nho")
    try:
        ra = cat(video, thu_muc_ra, muc_tieu=muc_tieu, ratio=ratio, nguong=nguong, chinh_xac=chinh_xac)
        print(json.dumps({
            "success": bool(ra),
            "clips": ra,
            "clipCount": len(ra),
            "outputDir": os.path.abspath(resolved_output_dir),
            "targetDuration": muc_tieu,
            "ratio": ratio,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "error": str(exc),
            "outputDir": os.path.abspath(resolved_output_dir),
        }, ensure_ascii=False))
        return 0


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    sys.exit(main(sys.argv[1:]))
