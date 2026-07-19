# -*- coding: utf-8 -*-
"""
XỬ LÝ VIDEO TỰ ĐỘNG (FFmpeg Pipeline) — phục vụ học tập.

Quét thư mục raw_videos/, với mỗi file .mp4 mới:
  1. Cắt 1 giây đầu + 1 giây cuối (bỏ intro/outro/metadata nguồn)
  2. Lật ngang (hflip) đổi "vân tay" hình ảnh
  3. Chèn logo watermark vào góc (có thể resize)
  4. Trộn âm thanh gốc với nhạc nền (nhạc nền nhỏ hơn)
  5. Tái mã hóa libx264 (crf/preset cấu hình được)
Xong → lưu sang processed_videos/ → xóa file gốc.

Xử lý TUẦN TỰ (1 file/lần) để không treo máy.
Cấu hình trong xu_ly_config.json (đổi đường dẫn/tọa độ/âm lượng không cần sửa code).
"""

import json
import logging
import os
import shutil
import subprocess
import socket
import sys
import time

THU_MUC_GOC = os.path.dirname(os.path.abspath(__file__))
THU_MUC_CRAWLER = os.path.join(THU_MUC_GOC, "MediaCrawler")
_LOCK_SOCK = None  # giữ socket khóa để chống chạy 2 bộ render cùng lúc
FILE_CONFIG = os.path.join(THU_MUC_GOC, "xu_ly_config.json")
FILE_LOG = os.path.join(THU_MUC_GOC, "process.log")
FLAG_TAM_DUNG = os.path.join(THU_MUC_GOC, "tam_dung_cao.flag")  # ổ đầy → tạm dừng cào

MAC_DINH = {
    "raw_dir": "raw_videos",
    "processed_dir": "processed_videos",
    "watermark_path": "watermark.png",
    "watermark_pos": "20:20",
    "watermark_scale": "",
    "bg_audio_path": "trending_audio.mp3",
    "bg_volume": 0.25,
    "trim_start": 1.0,
    "trim_end": 1.0,
    "mirror": True,
    "crf": 23,
    "preset": "medium",
    "video_encoder": "auto",   # auto = dùng GPU NVIDIA (h264_nvenc) nếu có, không thì libx264 (CPU)
    "audio_bitrate": "192k",
    "delete_original": True,
    "quet_tat_ca_nen_tang": True,  # True: rerender MỌI nền tảng trong MediaCrawler/data/*/videos
    "poll_interval": 5,
    "min_free_gb": 5,
    "ffmpeg_path": "ffmpeg",
    "ffprobe_path": "ffprobe",
}


# ---------------- Cấu hình & log ----------------
def nap_config() -> dict:
    cfg = dict(MAC_DINH)
    if os.path.exists(FILE_CONFIG):
        try:
            with open(FILE_CONFIG, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            print(f"[CẢNH BÁO] Lỗi đọc config, dùng mặc định: {e}")
    # Chuẩn hóa đường dẫn tương đối -> tuyệt đối (theo thư mục script)
    for k in ("raw_dir", "processed_dir", "watermark_path", "bg_audio_path"):
        if cfg.get(k) and not os.path.isabs(cfg[k]):
            cfg[k] = os.path.join(THU_MUC_GOC, cfg[k])
    return cfg


def setup_log():
    # Ép console dùng UTF-8 để in được tiếng Việt (Windows mặc định cp1252)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(FILE_LOG, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


# ---------------- Kiểm tra FFmpeg ----------------
def tim_exe(base):
    """Tìm 1 exe (base = 'ffmpeg' | 'ffprobe'): PATH -> BUNDLE (vendor/ffmpeg/bin) -> winget.
    Trả về đường dẫn tuyệt đối nếu thấy; không thấy gì thì trả tên trần `base`
    (để subprocess báo lỗi rõ ràng). Dùng CHUNG cho web_app/xu_ly_video/localize."""
    p = shutil.which(base)
    if p:
        return p
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    exe = base + ".exe"
    # bundle: app đóng gói (file ở app-src) -> ../vendor ; dev (repo) -> desktop/vendor
    for b in (os.path.join(here, "ffmpeg"),
              os.path.join(here, "ffmpeg", "bin"),
              os.path.join(root, "bin"),
              os.path.join(here, "..", "vendor", "ffmpeg", "bin"),
              os.path.join(here, "desktop", "vendor", "ffmpeg", "bin")):
        c = os.path.join(b, exe)
        if os.path.isfile(c):
            return os.path.abspath(c)
    import glob as _glob
    winget = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages")
    hits = _glob.glob(os.path.join(winget, "**", exe), recursive=True) if winget else []
    return hits[0] if hits else base


def tu_tim_ffmpeg(cfg):
    """Điền ffmpeg_path/ffprobe_path khi chưa hợp lệ. Ưu tiên BUNDLE kèm app
    (vendor/ffmpeg/bin — khách KHÔNG cần cài gì), rồi winget. Lưới đỡ phòng khi
    childEnv (desktop) chưa kịp thêm vendor vào PATH."""
    for key, base in (("ffmpeg_path", "ffmpeg"), ("ffprobe_path", "ffprobe")):
        val = cfg.get(key, "")
        if shutil.which(val) or (val and os.path.isfile(val)):
            continue
        found = tim_exe(base)
        if os.path.isfile(found) or shutil.which(found):   # chỉ ghi đè khi tìm THẬT ra
            cfg[key] = found
            logging.info(f"Tự tìm thấy {base}: {found}")
    return cfg


def kiem_tra_ffmpeg(cfg) -> bool:
    """Kiểm tra ffmpeg & ffprobe có chạy được không."""
    for ten, duong_dan in (("ffmpeg", cfg["ffmpeg_path"]), ("ffprobe", cfg["ffprobe_path"])):
        path = shutil.which(duong_dan) or (duong_dan if os.path.isfile(duong_dan) else None)
        if not path:
            logging.error(
                f"KHÔNG tìm thấy {ten}! Hãy cài FFmpeg và thêm vào PATH.\n"
                f"  • Cách 1 (Windows 10/11): mở PowerShell gõ:  winget install Gyan.FFmpeg\n"
                f"  • Cách 2: tải tại https://www.gyan.dev/ffmpeg/builds/ , giải nén, "
                f"thêm thư mục bin vào biến môi trường PATH.\n"
                f"  • Hoặc đặt đường dẫn đầy đủ tới {ten}.exe trong xu_ly_config.json "
                f"(khóa '{ten}_path')."
            )
            return False
    return True


# ---------------- Tiện ích ----------------
def lay_thoi_luong(cfg, path) -> float:
    """Lấy thời lượng video (giây) bằng ffprobe. Trả 0 nếu lỗi."""
    try:
        kq = subprocess.run(
            [cfg["ffprobe_path"], "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=60,
        )
        return float(kq.stdout.strip())
    except Exception:
        return 0.0


def file_on_dinh(path, cho=2.0) -> bool:
    """Kiểm tra file đã ghi xong chưa (kích thước không đổi)."""
    try:
        s1 = os.path.getsize(path)
        if s1 == 0:
            return False
        time.sleep(cho)
        return os.path.getsize(path) == s1
    except OSError:
        return False


def kiem_tra_o_cung(cfg) -> bool:
    """Còn đủ dung lượng không? Nếu thiếu -> tạo flag tạm dừng cào."""
    try:
        free_gb = shutil.disk_usage(cfg["processed_dir"]).free / (1024 ** 3)
    except Exception:
        free_gb = 999
    if free_gb < cfg["min_free_gb"]:
        if not os.path.exists(FLAG_TAM_DUNG):
            with open(FLAG_TAM_DUNG, "w", encoding="utf-8") as f:
                f.write(f"O cung con {free_gb:.1f}GB < nguong {cfg['min_free_gb']}GB")
            logging.warning(f"Ổ cứng còn {free_gb:.1f}GB (< {cfg['min_free_gb']}GB) "
                            f"→ TẠM DỪNG cào (tạo {os.path.basename(FLAG_TAM_DUNG)}).")
        return False
    # đủ chỗ lại → gỡ flag
    if os.path.exists(FLAG_TAM_DUNG):
        try:
            os.remove(FLAG_TAM_DUNG)
            logging.info("Ổ cứng đã đủ chỗ → bỏ tạm dừng cào.")
        except OSError:
            pass
    return True


# ---------------- Chọn encoder (GPU NVIDIA nếu có) ----------------
_NVENC = None


def co_nvenc(ffmpeg_path="ffmpeg", che_do="auto") -> bool:
    """True nếu nên encode bằng h264_nvenc (GPU NVIDIA). che_do: auto/nvenc/cpu.
    'auto' = thử encode thử 1 frame; lỗi (không GPU/driver, vd máy AMD/CPU) → False.
    Kết quả cache lại để khỏi thử nhiều lần."""
    global _NVENC
    che_do = (che_do or "auto").lower()
    if che_do == "cpu":
        return False
    if che_do == "nvenc":
        return True
    if _NVENC is None:
        try:
            r = subprocess.run([ffmpeg_path, "-hide_banner", "-loglevel", "error",
                                "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2",
                                "-c:v", "h264_nvenc", "-f", "null", "-"],
                               capture_output=True, timeout=30)
            _NVENC = (r.returncode == 0)
            logging.info("Encoder video: %s", "h264_nvenc (GPU)" if _NVENC else "libx264 (CPU)")
        except Exception:
            _NVENC = False
    return _NVENC


# ---------------- Dựng lệnh FFmpeg ----------------
def dung_lenh_ffmpeg(cfg, src, dst, duration) -> list:
    """Tạo danh sách tham số ffmpeg cho 1 video."""
    trim_start = float(cfg["trim_start"])
    trim_end = float(cfg["trim_end"])
    eff_dur = duration - trim_start - trim_end if duration > 0 else 0

    co_watermark = bool(cfg.get("watermark_path")) and os.path.isfile(cfg["watermark_path"])
    co_bg = bool(cfg.get("bg_audio_path")) and os.path.isfile(cfg["bg_audio_path"])

    cmd = [cfg["ffmpeg_path"], "-y"]
    # Cắt đầu/cuối ngay khi đọc input 0 (nếu video đủ dài)
    if eff_dur > 0.5:
        cmd += ["-ss", str(trim_start), "-t", str(eff_dur)]
    cmd += ["-i", src]                                  # input 0: video gốc
    idx = 1
    wm_idx = bg_idx = None
    if co_watermark:
        cmd += ["-i", cfg["watermark_path"]]            # input: logo
        wm_idx = idx
        idx += 1
    if co_bg:
        cmd += ["-i", cfg["bg_audio_path"]]             # input: nhạc nền
        bg_idx = idx
        idx += 1

    speed = float(cfg.get("speed", 1.0) or 1.0)

    filtres = []
    # ----- Video: hflip + tăng tốc (setpts) -----
    vf = []
    if cfg.get("mirror"):
        vf.append("hflip")
    if cfg.get("color_filter"):
        vf.append(cfg["color_filter"])  # chỉnh màu nhẹ (đổi vân tay nhưng vẫn dễ nhìn)
    if speed != 1.0:
        vf.append(f"setpts=PTS/{speed}")
    if vf:
        filtres.append(f"[0:v]{','.join(vf)}[vbase]")
        cur = "vbase"
    else:
        cur = "0:v"
    if co_watermark:
        if cfg.get("watermark_scale"):
            filtres.append(f"[{wm_idx}:v]scale={cfg['watermark_scale']}[wm]")
            wm_lab = "wm"
        else:
            wm_lab = f"{wm_idx}:v"
        filtres.append(f"[{cur}][{wm_lab}]overlay={cfg['watermark_pos']}[vout]")
        video_map = "[vout]"
    else:
        video_map = f"[{cur}]" if cur != "0:v" else "0:v"

    # ----- Âm thanh: tăng tốc (atempo) + trộn nhạc nền -----
    af = []
    if speed != 1.0:
        af.append(f"atempo={speed}")  # atempo hỗ trợ 0.5–2.0
    if co_bg:
        if af:
            filtres.append(f"[0:a]{','.join(af)}[a0]")
            orig_a = "a0"
        else:
            orig_a = "0:a"
        filtres.append(f"[{bg_idx}:a]volume={cfg['bg_volume']}[bg]")
        filtres.append(f"[{orig_a}][bg]amix=inputs=2:duration=first:normalize=0[aout]")
        audio_map = "[aout]"
    elif af:
        filtres.append(f"[0:a]{','.join(af)}[aout]")
        audio_map = "[aout]"
    else:
        audio_map = "0:a?"

    if filtres:
        cmd += ["-filter_complex", ";".join(filtres)]
    cmd += ["-map", video_map, "-map", audio_map]
    if co_nvenc(cfg["ffmpeg_path"], cfg.get("video_encoder", "auto")):
        # GPU NVIDIA: nhanh hơn nhiều, nhả CPU cho việc khác (vd crawl chạy song song)
        cmd += ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr",
                "-cq", str(cfg["crf"]), "-b:v", "0"]
    else:
        cmd += ["-c:v", "libx264", "-crf", str(cfg["crf"]), "-preset", cfg["preset"]]
    cmd += ["-c:a", "aac", "-b:a", cfg["audio_bitrate"], "-movflags", "+faststart", dst]
    return cmd


def lay_kich_thuoc(cfg, path):
    """(rộng, cao) của video bằng ffprobe. Trả (0,0) nếu lỗi."""
    try:
        kq = subprocess.run(
            [cfg["ffprobe_path"], "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height",
             "-of", "csv=s=x:p=0", path],
            capture_output=True, text=True, timeout=60)
        w, h = kq.stdout.strip().split("x")[:2]
        return int(w), int(h)
    except Exception:
        return 0, 0


def _enc_args(cfg):
    """Tham số encoder video (NVENC nếu có, không thì libx264) — dùng chung."""
    if co_nvenc(cfg["ffmpeg_path"], cfg.get("video_encoder", "auto")):
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr",
                "-cq", str(cfg["crf"]), "-b:v", "0"]
    return ["-c:v", "libx264", "-crf", str(cfg["crf"]), "-preset", cfg["preset"]]


# Tỉ lệ đích -> kích thước chuẩn
KHUNG_RATIO = {"9:16": (1080, 1920), "16:9": (1920, 1080)}


def bien_doi_khung(cfg, src, dst, ratio="", blur_boxes=None, logo=None, mirror=False,
                   ss=None, dur=None):
    """1 PASS ffmpeg: làm mờ vùng (xoá logo gốc) -> chèn logo của mình -> đổi tỉ lệ khung
    (nền mờ giữ toàn khung). Toạ độ tính theo PIXEL của video GỐC (như bộ vẽ hiển thị).

    - blur_boxes: [{x,y,w,h}, ...] vùng làm mờ. mirror=True -> tự lật x (logo gốc đã bị
      hflip nên dịch sang phía đối diện) để blur trúng.
    - logo: {path, x, y, w, h} chèn logo (KHÔNG lật x — giữ đúng vị trí màn hình người vẽ).
    - ratio: "" giữ nguyên | "9:16" | "16:9".
    - ss/dur: (giây) CẮT đoạn [ss, ss+dur] trong CÙNG lần encode (cho chức năng băm clip —
      cat_nho.py). None = cả video. -ss đặt TRƯỚC -i: seek nhanh keyframe rồi decode tới ss,
      khi re-encode cho cắt CHÍNH XÁC theo frame.
    Trả True nếu tạo được dst.
    """
    blur_boxes = blur_boxes or []
    src_w, _src_h = (lay_kich_thuoc(cfg, src) if (mirror and blur_boxes) else (0, 0))

    cmd = [cfg["ffmpeg_path"], "-y"]
    if ss is not None:
        cmd += ["-ss", "%.3f" % float(ss)]
    cmd += ["-i", src]
    if dur is not None:
        cmd += ["-t", "%.3f" % float(dur)]
    logo_ok = bool(logo and logo.get("path") and os.path.isfile(logo["path"]))
    if logo_ok:
        cmd += ["-i", logo["path"]]

    parts = ["[0:v]null[v0]"]
    cur = "v0"
    n = 0
    # ----- Làm mờ từng vùng (xoá logo gốc) -----
    for b in blur_boxes:
        try:
            x, y, w, h = int(b["x"]), int(b["y"]), int(b["w"]), int(b["h"])
        except Exception:
            continue
        if w <= 0 or h <= 0:
            continue
        if mirror and src_w > 0:
            x = max(0, src_w - x - w)
        n += 1
        a, c, bl, out = f"v{n}a", f"v{n}c", f"v{n}b", f"v{n}"
        parts.append(f"[{cur}]split[{a}][{c}]")
        parts.append(f"[{c}]crop={w}:{h}:{x}:{y},boxblur=12:2[{bl}]")
        parts.append(f"[{a}][{bl}]overlay={x}:{y}[{out}]")
        cur = out
    # ----- Chèn logo của mình -----
    if logo_ok:
        try:
            lx, ly, lw, lh = int(logo["x"]), int(logo["y"]), int(logo["w"]), int(logo["h"])
        except Exception:
            lx = ly = lw = lh = 0
        if lw > 0 and lh > 0:
            n += 1
            out = f"v{n}"
            parts.append(f"[1:v]scale={lw}:{lh}[lg]")
            parts.append(f"[{cur}][lg]overlay={lx}:{ly}[{out}]")
            cur = out
    # ----- Đổi tỉ lệ khung (nền mờ giữ toàn khung) -----
    if ratio in KHUNG_RATIO:
        ow, oh = KHUNG_RATIO[ratio]
        n += 1
        out = f"v{n}"
        parts.append(f"[{cur}]split[rbg][rfg]")
        parts.append(f"[rbg]scale={ow}:{oh}:force_original_aspect_ratio=increase,"
                     f"crop={ow}:{oh},boxblur=20:3,setsar=1[rbgb]")
        parts.append(f"[rfg]scale={ow}:{oh}:force_original_aspect_ratio=decrease,setsar=1[rfgs]")
        parts.append(f"[rbgb][rfgs]overlay=(W-w)/2:(H-h)/2[{out}]")
        cur = out

    cmd += ["-filter_complex", ";".join(parts), "-map", f"[{cur}]", "-map", "0:a?"]
    cmd += _enc_args(cfg)
    cmd += ["-c:a", "copy", "-movflags", "+faststart", dst]

    kq = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if kq.returncode != 0 or not os.path.isfile(dst):
        # audio copy có thể fail (codec lạ) -> thử lại với aac
        cmd2 = cmd[:-3] + ["-c:a", "aac", "-b:a", cfg.get("audio_bitrate", "192k"),
                           "-movflags", "+faststart", dst]
        kq = subprocess.run(cmd2, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if kq.returncode != 0 or not os.path.isfile(dst):
            return False, (kq.stderr or "")[-500:]
    return True, ""


# ---------------- Danh sách thư mục cần quét ----------------
def cac_thu_muc_quet(cfg):
    """Trả [(thu_muc_quet, thu_muc_goc_de_tinh_rel)].
    Bật quet_tat_ca_nen_tang -> quét data/<nen_tang>/videos, giữ tên nền tảng trong đường ra."""
    if cfg.get("quet_tat_ca_nen_tang", True):
        base = os.path.join(THU_MUC_CRAWLER, "data")
        ds = []
        for plat in ("douyin", "tiktok", "youtube", "bili", "xhs", "weibo", "kuaishou",
                     "twitter", "instagram"):
            d = os.path.join(base, plat, "videos")
            if os.path.isdir(d):
                ds.append((d, base))   # rel tính từ data/ -> đường ra có "douyin/videos/..."
        if ds:
            return ds
    # Mặc định: 1 thư mục raw_dir (rel tính từ chính nó -> đường ra không có tên nền tảng)
    return [(cfg["raw_dir"], cfg["raw_dir"])]


# ---------------- Xử lý 1 file ----------------
def xu_ly_file(cfg, src, base_dir=None, watch_dir=None) -> bool:
    base_dir = base_dir or cfg["raw_dir"]
    watch_dir = watch_dir or base_dir
    rel = os.path.relpath(src, base_dir)
    dst = os.path.join(cfg["processed_dir"], rel)
    if os.path.exists(dst):
        logging.info(f"Đã có bản rerender, bỏ qua: {rel}")
        if cfg.get("delete_original"):
            try:
                os.remove(src)
                logging.info(f"🗑 Xóa bản gốc trùng: {rel}")
            except OSError:
                pass
        return True
    os.makedirs(os.path.dirname(dst) or cfg["processed_dir"], exist_ok=True)

    if not file_on_dinh(src):
        logging.info(f"File đang được ghi, chờ lượt sau: {rel}")
        return False

    duration = lay_thoi_luong(cfg, src)
    logging.info(f"▶ Bắt đầu xử lý: {rel} (thời lượng {duration:.1f}s)")
    t0 = time.time()
    cmd = dung_lenh_ffmpeg(cfg, src, dst, duration)
    try:
        kq = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except Exception as e:
        logging.error(f"Lỗi gọi ffmpeg: {e}")
        return False

    if kq.returncode != 0:
        logging.error(f"FFmpeg lỗi với {rel}:\n{(kq.stderr or '')[-1500:]}")
        # dọn file lỗi (nếu có)
        if os.path.exists(dst):
            try:
                os.remove(dst)
            except OSError:
                pass
        return False

    logging.info(f"✔ Xong: {rel} ({time.time()-t0:.1f}s) → {os.path.relpath(dst, THU_MUC_GOC)}")

    # Dọn file gốc
    if cfg.get("delete_original"):
        try:
            os.remove(src)
            logging.info(f"🗑 Đã xóa file gốc (cào): {rel}")
            # dọn thư mục con rỗng (không xóa thư mục gốc đang theo dõi)
            d = os.path.dirname(src)
            if os.path.abspath(d) != os.path.abspath(watch_dir) and not os.listdir(d):
                os.rmdir(d)
        except OSError as e:
            logging.warning(f"Không xóa được file gốc {rel}: {e}")
    return True


# ---------------- Vòng lặp chính ----------------
def quet_va_xu_ly(cfg):
    """Quét tất cả thư mục cần theo dõi, xử lý tuần tự từng file .mp4."""
    files = []   # (src, base_dir, watch_dir)
    for watch_dir, base_dir in cac_thu_muc_quet(cfg):
        for root, _dirs, names in os.walk(watch_dir):
            for n in names:
                if n.lower().endswith(".mp4"):
                    files.append((os.path.join(root, n), base_dir, watch_dir))
    files.sort()
    for src, base_dir, watch_dir in files:
        if not kiem_tra_o_cung(cfg):
            logging.warning("Tạm dừng xử lý do ổ cứng đầy.")
            break
        try:
            xu_ly_file(cfg, src, base_dir, watch_dir)  # TUẦN TỰ — 1 file/lần
        except Exception as e:
            logging.error(f"Lỗi không mong đợi với {src}: {e}")


def _da_chay_roi() -> bool:
    """Chống chạy 2 bộ render cùng lúc (bind 1 cổng cục bộ; bind lỗi = đã có bản đang chạy)."""
    global _LOCK_SOCK
    _LOCK_SOCK = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        _LOCK_SOCK.bind(("127.0.0.1", 47654))
        return False
    except OSError:
        return True


def main():
    setup_log()
    if _da_chay_roi():
        logging.info("Đã có 1 bộ render đang chạy → thoát (tránh trùng).")
        return
    cfg = nap_config()
    logging.info("=" * 50)
    logging.info("Khởi động bộ xử lý video (FFmpeg pipeline).")

    cfg = tu_tim_ffmpeg(cfg)
    if not kiem_tra_ffmpeg(cfg):
        sys.exit(1)

    os.makedirs(cfg["raw_dir"], exist_ok=True)
    os.makedirs(cfg["processed_dir"], exist_ok=True)
    if not (cfg.get("watermark_path") and os.path.isfile(cfg["watermark_path"])):
        logging.warning(f"Không thấy logo watermark ({cfg.get('watermark_path')}) → bỏ qua chèn logo.")
    if not (cfg.get("bg_audio_path") and os.path.isfile(cfg["bg_audio_path"])):
        logging.warning(f"Không thấy nhạc nền ({cfg.get('bg_audio_path')}) → giữ nguyên âm thanh gốc.")

    ds_quet = [d for d, _ in cac_thu_muc_quet(cfg)]
    logging.info("Theo dõi %d thư mục (quét mỗi %ss):" % (len(ds_quet), cfg["poll_interval"]))
    for d in ds_quet:
        logging.info("  • " + os.path.relpath(d, THU_MUC_GOC))
    try:
        while True:
            quet_va_xu_ly(cfg)
            time.sleep(float(cfg["poll_interval"]))
    except KeyboardInterrupt:
        logging.info("Đã dừng bộ xử lý (người dùng).")


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
