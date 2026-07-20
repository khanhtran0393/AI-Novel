# -*- coding: utf-8 -*-
"""
Tải video YouTube / TikTok / Twitter(X) / Reddit / Instagram bằng yt-dlp (cho học tập).
Chế độ: search (YouTube + Reddit), creator (theo kênh/user/subreddit), detail (theo link).

Dùng:
  python tai_ytdlp.py --platform yt --type search  --input "tu khoa" --count 10
  python tai_ytdlp.py --platform rd --type search  --input "tu khoa" --count 10 --sort top --time week
  python tai_ytdlp.py --platform rd --type creator --input "r/funny" --count 10 --sort controversial
  python tai_ytdlp.py --platform tw --type creator --input "@elonmusk" --count 10 --cookies-browser chrome
  python tai_ytdlp.py --platform ig --type detail  --input "https://www.instagram.com/reel/..." --cookies-browser chrome

In ra các dòng "LOG:..." để web_app đọc và hiển thị tiến trình.
Lưu vào: MediaCrawler/data/{youtube|tiktok|twitter|reddit|instagram}/videos/{tu-khoa/<kw>|kenh/<ten>|link}/
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

THU_MUC_GOC = os.path.dirname(os.path.abspath(__file__))
THU_MUC_CRAWLER = os.path.join(THU_MUC_GOC, "MediaCrawler")

NEN = {
    "yt": {"thu_muc": "youtube", "search_prefix": "ytsearch"},
    "tt": {"thu_muc": "tiktok"},
    "tw": {"thu_muc": "twitter"},
    "rd": {"thu_muc": "reddit"},
    "ig": {"thu_muc": "instagram"},
}
# Nền tảng cần cookie đăng nhập (đọc từ trình duyệt) mới tải được hầu hết video
NEN_CAN_COOKIE = ("ig", "tw")
# Sort hợp lệ khi liệt kê 1 subreddit (search có thêm 'relevance'/'comments')
REDDIT_SUB_SORT = ("hot", "new", "top", "rising", "controversial")


def log(msg):
    print("LOG:" + msg, flush=True)


def an_toan(ten):
    """Làm sạch tên thư mục (bỏ ký tự cấm trên Windows)."""
    ten = re.sub(r'[<>:"/\\|?*\n\r\t]+', " ", ten or "").strip()
    ten = re.sub(r"\s+", " ", ten)
    return (ten[:60] or "khac").rstrip(". ")


def tach_dong(s):
    return [x.strip() for x in re.split(r"[\n,]+", s or "") if x.strip()]


def media_files_under(root, since_ts=0, limit=200):
    exts = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
    found = []
    if not root or not os.path.isdir(root):
        return found
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in exts:
                continue
            full = os.path.join(dirpath, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            if since_ts and stat.st_mtime < since_ts:
                continue
            found.append({
                "path": full,
                "name": name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
    found.sort(key=lambda item: item["mtime"], reverse=True)
    return found[:limit]


def chuan_hoa_user(platform, s):
    """@handle hoặc link -> URL trang user (Twitter/Instagram)."""
    s = (s or "").strip()
    if s.lower().startswith("http"):
        return s
    h = s.lstrip("@/").strip()
    if platform == "tw":
        return f"https://x.com/{h}"
    if platform == "ig":
        return f"https://www.instagram.com/{h}/"
    return s


# Các tab hợp lệ của trang kênh YouTube (URL kết thúc bằng tab nào thì giữ nguyên)
_YT_TABS = ("videos", "shorts", "streams", "live", "featured", "playlists", "community", "posts")


def chuan_hoa_kenh_youtube(s):
    """Kênh YouTube -> URL tab '/videos'.
    URL kênh trần (youtube.com/@abc) resolve ra danh sách TAB (Videos/Live/Shorts),
    khiến playlistend giới hạn theo TAB chứ không theo VIDEO -> tải loạn cả kênh.
    Thêm '/videos' để liệt kê thẳng video. Giữ nguyên link 1 video hoặc tab đã chỉ định."""
    s = (s or "").strip()
    if not s:
        return s
    low = s.lower()
    # Link 1 video / 1 short cụ thể -> để nguyên
    if "watch?v=" in low or "youtu.be/" in low or re.search(r"/shorts/[\w-]+", low):
        return s
    # Handle trần: "@abc" hoặc "abc" (không phải URL)
    if not low.startswith("http") and "/" not in s:
        h = s if s.startswith("@") else "@" + s
        return f"https://www.youtube.com/{h}/videos"
    if not low.startswith("http"):
        s = "https://" + s
    base_url = s.split("?")[0].split("#")[0].rstrip("/")
    if base_url.rsplit("/", 1)[-1].lower() in _YT_TABS:
        return base_url                      # đã trỏ tab cụ thể
    return base_url + "/videos"


def _tiktok_secuid(handle):
    """Lấy secUid 1 user TikTok qua Playwright (TikTok chặn HTTP thường = trả trang captcha).
    yt-dlp 2026.06 KHÔNG resolve được @username ('Unable to extract secondary user ID'),
    bắt buộc đưa secUid dạng 'tiktokuser:<secUid>'. Trả '' nếu thất bại."""
    handle = (handle or "").lstrip("@").strip()
    if not handle:
        return ""
    url = "https://www.tiktok.com/@%s" % handle
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            pg = b.new_page()
            try:
                pg.goto(url, wait_until="domcontentloaded", timeout=30000)
                pg.wait_for_timeout(2500)
                html = pg.content()
            finally:
                b.close()
    except Exception as e:
        log(f"⚠ Không mở được trang TikTok @{handle}: {str(e)[:120]}")
        return ""
    # Chính xác: JSON __UNIVERSAL_DATA_FOR_REHYDRATION__ -> userInfo.user.secUid (của CHỦ trang)
    m = re.search(r'__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html, re.S)
    if m:
        try:
            scope = json.loads(m.group(1)).get("__DEFAULT_SCOPE__", {})
            for v in scope.values():
                u = v.get("userInfo", {}).get("user", {}) if isinstance(v, dict) else {}
                if u.get("secUid"):
                    return u["secUid"]
        except Exception:
            pass
    m = re.search(r'"secUid":"([A-Za-z0-9_\-]{30,})"', html)   # dự phòng
    return m.group(1) if m else ""


def chuan_hoa_kenh_tiktok(s):
    """@user / link profile TikTok -> 'tiktokuser:<secUid>' (yt-dlp resolve được). '' nếu thất bại."""
    s = (s or "").strip()
    if s.lower().startswith("tiktokuser:"):
        return s
    m = re.search(r"tiktok\.com/@([\w.\-]+)", s, re.I)
    handle = m.group(1) if m else s
    sid = _tiktok_secuid(handle)
    return ("tiktokuser:" + sid) if sid else ""


def _tiktok_search(query, count, log=print):
    """SEARCH TikTok qua Playwright (yt-dlp KHÔNG search TT được). Dùng profile đăng nhập sẵn
    (browser_data/tt_user_data_dir) để né tường login. Trả list item {id,title,thumb,url,...}.
    FRAGILE: phụ thuộc DOM/anti-bot TikTok + cần đã đăng nhập TikTok."""
    udd = os.path.join(THU_MUC_CRAWLER, "browser_data", "tt_user_data_dir")
    if not os.path.isdir(udd):
        udd = os.path.join(THU_MUC_CRAWLER, "browser_data", "_tt_tmp")
    url = "https://www.tiktok.com/search?q=" + urllib.parse.quote(query)
    anchors = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(udd, headless=True)
            try:
                pg = ctx.pages[0] if ctx.pages else ctx.new_page()
                pg.goto(url, wait_until="domcontentloaded", timeout=40000)
                pg.wait_for_timeout(3500)
                js = ("els=>els.map(a=>{const im=a.querySelector('img');"
                      "return {href:a.href, img:im?im.src:'', alt:im?im.alt:''};})")
                for _ in range(4):
                    try:
                        anchors = pg.eval_on_selector_all("a[href*='/video/']", js)
                    except Exception:
                        anchors = []
                    if len(anchors) >= count:
                        break
                    pg.mouse.wheel(0, 3000)
                    pg.wait_for_timeout(1500)
            finally:
                ctx.close()
    except Exception as e:
        log("⚠ Search TikTok lỗi (%s) — đã đăng nhập TikTok chưa?" % str(e)[:120])
        return []
    items, seen = [], set()
    for a in anchors:
        m = re.search(r"tiktok\.com/@([\w.\-]+)/video/(\d+)", a.get("href", ""))
        if not m:
            continue
        nick, vid = m.group(1), m.group(2)
        if vid in seen:
            continue
        seen.add(vid)
        items.append({"id": vid, "title": (a.get("alt") or "").strip()[:160], "thumb": a.get("img") or "",
                      "loai": "video", "video": True, "so_anh": 0,
                      "url": "https://www.tiktok.com/@%s/video/%s" % (nick, vid), "like": "", "nick": nick})
        if len(items) >= count:
            break
    return items


def reddit_sub(s):
    """'funny' | 'r/funny' | link subreddit -> tên subreddit sạch."""
    s = (s or "").strip()
    m = re.search(r"reddit\.com/r/([^/?#]+)", s, re.I)
    if m:
        return m.group(1)
    return re.sub(r"[^A-Za-z0-9_]", "", s.lstrip("/").split("?")[0].removeprefix("r/").removeprefix("R/"))


def _reddit_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "reupo-tool/1.0 (video reup, hoc tap)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _co_video(d):
    """Post Reddit này có video không (để yt-dlp tải được)?"""
    if d.get("is_video"):
        return True
    if d.get("post_hint") in ("hosted:video", "rich:video"):
        return True
    dom = (d.get("domain") or "").lower()
    return any(h in dom for h in ("v.redd.it", "youtube.com", "youtu.be",
                                  "redgifs.com", "gfycat.com", "streamable.com"))


def reddit_lay_links(che_do, kw_hoac_sub, sort, time_window, count):
    """Gọi Reddit JSON -> trả list link post (có video), đã giới hạn count.
    che_do='search' (tìm từ khóa toàn Reddit) | 'creator' (1 subreddit)."""
    sort = (sort or "").strip().lower()
    t = (time_window or "").strip().lower()
    links, after, vong = [], None, 0
    while len(links) < count and vong < 6:
        vong += 1
        params = {"limit": 100, "raw_json": 1}
        if after:
            params["after"] = after
        if che_do == "search":
            params["q"] = kw_hoac_sub
            params["type"] = "link"
            params["include_over_18"] = "on"
            params["sort"] = sort if sort in ("relevance", "hot", "top", "new", "comments") else "top"
            if params["sort"] == "top" and t:
                params["t"] = t
            url = "https://www.reddit.com/search.json?" + urllib.parse.urlencode(params)
        else:  # creator = 1 subreddit
            sub = reddit_sub(kw_hoac_sub)
            s = sort if sort in REDDIT_SUB_SORT else "hot"
            if s in ("top", "controversial") and t:
                params["t"] = t
            url = f"https://www.reddit.com/r/{sub}/{s}.json?" + urllib.parse.urlencode(params)
        try:
            data = _reddit_get_json(url)
        except Exception as e:
            log(f"⚠ Lỗi gọi Reddit: {str(e)[:160]}")
            break
        children = (data.get("data") or {}).get("children") or []
        if not children:
            break
        for c in children:
            d = c.get("data") or {}
            if _co_video(d) and d.get("permalink"):
                links.append("https://www.reddit.com" + d["permalink"])
                if len(links) >= count:
                    break
        after = (data.get("data") or {}).get("after")
        if not after:
            break
    return links


def xuat_cookie_tu_phien(platform):
    """X/IG: mở profile đăng nhập (browser_data/<plat>_user_data_dir) bằng Playwright,
    xuất cookie ra cookies.txt (Netscape) cho yt-dlp. Trả đường dẫn hoặc ''.
    (yt-dlp không giải mã trực tiếp được cookie Chromium của Playwright nên phải xuất qua Playwright.)"""
    udd = os.path.join(THU_MUC_CRAWLER, "browser_data", f"{platform}_user_data_dir")
    if not os.path.isdir(udd):
        return ""
    out = os.path.join(THU_MUC_CRAWLER, "browser_data", f"{platform}_cookies.txt")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(udd, headless=True)
            try:
                cks = ctx.cookies()
            finally:
                ctx.close()
    except Exception as e:
        log(f"⚠ Không đọc được phiên đăng nhập {platform}: {str(e)[:120]}")
        return ""
    if not cks:
        return ""
    try:
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write("# Netscape HTTP Cookie File\n")
            for c in cks:
                dom = c.get("domain", "")
                exp = int(c.get("expires") or 0)
                f.write("\t".join([dom, "TRUE" if dom.startswith(".") else "FALSE",
                                   c.get("path", "/"), "TRUE" if c.get("secure") else "FALSE",
                                   str(exp if exp > 0 else 0), c.get("name", ""),
                                   c.get("value", "")]) + "\n")
        return out
    except Exception:
        return ""


# ---------------- XEM TRƯỚC (liệt kê metadata, KHÔNG tải) — cho nút "Xem trước & chọn" ----------------
def _item_yt(e):
    vid = e.get("id") or ""
    return {
        "id": vid,
        "title": (e.get("title") or "").strip()[:160],
        "thumb": "https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid if vid else "",  # suy từ ID (flat không có thumb)
        "loai": "video", "video": True, "so_anh": 0,
        "url": e.get("url") or ("https://www.youtube.com/watch?v=%s" % vid if vid else ""),
        "like": str(e.get("view_count") or ""),
        "nick": e.get("channel") or e.get("uploader") or "",
    }


def _item_tt(e):
    vid = str(e.get("id") or "")
    thumbs = e.get("thumbnails") or []
    thumb = e.get("thumbnail") or (thumbs[-1].get("url") if thumbs else "")
    return {
        "id": vid,
        "title": (e.get("title") or e.get("description") or "").strip()[:160],
        "thumb": thumb,
        "loai": "video", "video": True, "so_anh": 0,
        "url": e.get("url") or "",
        "like": str(e.get("view_count") or e.get("like_count") or ""),
        "nick": e.get("uploader") or e.get("channel") or "",
    }


def liet_ke(a, count):
    """Liệt kê video (metadata-only, extract_flat) cho XEM TRƯỚC — in 1 dòng JSON {ok, items}.
    YouTube: search (ytsearchN) + creator (kênh /videos).
    TikTok: search = HASHTAG (tiktok.com/tag/<từ khoá>) qua yt-dlp + cookie đăng nhập, dự phòng scrape
            trang search; creator = kênh."""
    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "success": False,
            "msg": "Missing dependency: yt-dlp",
            "error": str(exc),
        }, ensure_ascii=False))
        return
    plat = a.platform
    if plat not in ("yt", "tt"):
        print(json.dumps({"ok": False, "msg": "Nền tảng chưa hỗ trợ xem trước: " + plat})); return
    cookiefile = ""
    if a.type == "creator":
        if plat == "yt":
            urls = [chuan_hoa_kenh_youtube(x) for x in tach_dong(a.input)]
        else:
            cookiefile = xuat_cookie_tu_phien("tt")    # best-effort: dùng phiên đăng nhập TikTok nếu có
            urls = [u for u in (chuan_hoa_kenh_tiktok(x) for x in tach_dong(a.input)) if u]
        if not urls:
            print(json.dumps({"ok": False, "msg": "Không lấy được kênh (thử dán link 1 video của kênh)."})); return
    elif plat == "tt":  # TikTok search: từ khoá = HASHTAG (tag) — cần cookie đăng nhập TikTok
        cookiefile = xuat_cookie_tu_phien("tt")
        if not cookiefile:
            print(json.dumps({"ok": False, "msg": "Chưa đăng nhập TikTok — bấm thẻ TikTok ở mục Đăng nhập nền tảng rồi thử lại."})); return
        urls = ["https://www.tiktok.com/tag/%s" % urllib.parse.quote(kw.lstrip("#").replace(" ", "").strip())
                for kw in tach_dong(a.input) if kw.strip()]
        if not urls:
            print(json.dumps({"ok": False, "msg": "Chưa nhập từ khóa."})); return
    else:  # search YouTube
        urls = ["ytsearch%d:%s" % (count, kw) for kw in tach_dong(a.input)]
        if not urls:
            print(json.dumps({"ok": False, "msg": "Chưa nhập từ khóa."})); return

    opts = {"extract_flat": "in_playlist", "skip_download": True, "playlistend": count,
            "quiet": True, "no_warnings": True, "ignoreerrors": True, "nocheckcertificate": True}
    if cookiefile and os.path.isfile(cookiefile):
        opts["cookiefile"] = cookiefile
    parser = _item_yt if plat == "yt" else _item_tt
    items, seen = [], set()
    try:
        with YoutubeDL(opts) as ydl:
            for u in urls:
                try:
                    info = ydl.extract_info(u, download=False)
                except Exception as e:
                    log("⚠ Lỗi liệt kê %s: %s" % (u[:40], str(e)[:120])); continue
                entries = info.get("entries") if isinstance(info, dict) else None
                for e in (entries or ([info] if info else [])):
                    if not e:
                        continue
                    it = parser(e)
                    if it["id"] and it["id"] not in seen:
                        seen.add(it["id"]); items.append(it)
                    if len(items) >= count:
                        break
                if len(items) >= count:
                    break
    except Exception as e:
        print(json.dumps({"ok": False, "msg": "Lỗi xem trước: " + str(e)[:160]})); return
    # TikTok: hashtag qua yt-dlp đôi khi lỗi 'No app info' -> dự phòng scrape trang search (cùng phiên login)
    if plat == "tt" and a.type != "creator" and not items:
        log("ℹ Hashtag TikTok không ra video — thử scrape trang search.")
        for kw in tach_dong(a.input):
            for it in _tiktok_search(kw, count):
                if it["id"] and it["id"] not in seen:
                    seen.add(it["id"]); items.append(it)
                if len(items) >= count:
                    break
            if len(items) >= count:
                break
    print(json.dumps({"ok": True, "items": items, "tong": len(items)}, ensure_ascii=False))


def main():
    session_started = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True, choices=list(NEN.keys()))
    ap.add_argument("--type", required=True, choices=["search", "creator", "detail"])
    ap.add_argument("--input", required=True)
    ap.add_argument("--count", default="10")
    ap.add_argument("--sort", default="")            # Reddit: relevance/top/comments/hot/new/controversial
    ap.add_argument("--time", default="")            # Reddit: hour/day/week/month/year/all
    ap.add_argument("--cookies-browser", dest="cookies_browser", default="")  # chrome/edge/firefox...
    ap.add_argument("--cookies", default="")          # đường dẫn cookies.txt (Netscape) — X/IG
    ap.add_argument("--list", action="store_true")    # CHỈ liệt kê metadata (xem trước), KHÔNG tải
    ap.add_argument("--output", default="")           # Thư mục lưu video đầu ra
    a = ap.parse_args()

    try:
        count = max(1, int(a.count))
    except ValueError:
        count = 10

    if a.list:                       # xem trước (metadata-only) -> in JSON rồi thoát, KHÔNG tải
        liet_ke(a, count)
        return

    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "downloaded": 0,
            "outputDir": a.output or "",
            "files": [],
            "error": "Missing dependency: yt-dlp",
            "detail": str(exc),
        }, ensure_ascii=False), flush=True)
        return

    plat = NEN[a.platform]
    if a.output:
        base = a.output
        archive = os.path.join(base, "_da_tai.txt")
    else:
        app_root = os.path.dirname(THU_MUC_GOC)
        downloads_root = os.path.join(app_root, "downloads")
        base = os.path.join(downloads_root, plat["thu_muc"], "videos")
        archive = os.path.join(downloads_root, plat["thu_muc"], "_da_tai.txt")
    os.makedirs(base, exist_ok=True)

    ffmpeg = shutil.which("ffmpeg")
    cookies_browser = (a.cookies_browser or "").strip().lower()
    cookies_file = (a.cookies or "").strip()
    _co_cookie = lambda: cookies_browser or (cookies_file and os.path.isfile(cookies_file))
    # X/IG: chưa truyền cookie thủ công -> lấy từ phiên đăng nhập (mo_dang_nhap)
    if a.platform in NEN_CAN_COOKIE and not _co_cookie():
        cf = xuat_cookie_tu_phien(a.platform)
        if cf:
            cookies_file = cf
            log(f"🔑 Dùng cookie phiên đăng nhập {a.platform.upper()}.")
    if a.platform in NEN_CAN_COOKIE and not _co_cookie():
        log(f"⚠ {a.platform.upper()} cần đăng nhập — chưa có phiên. Bấm 'Đăng nhập {a.platform.upper()}' trước khi cào.")
    # TikTok: dùng cookie phiên đăng nhập nếu có (tải ổn định hơn / né rate-limit) — KHÔNG bắt buộc cho tải kênh/link
    if a.platform == "tt" and not _co_cookie():
        cf = xuat_cookie_tu_phien("tt")
        if cf:
            cookies_file = cf
            log("🔑 Dùng cookie phiên đăng nhập TikTok.")

    # Đếm số video tải được trong phiên (theo id để không đếm trùng stream video+audio)
    da_xong = set()

    def hook(d):
        if d.get("status") == "finished":
            info = d.get("info_dict") or {}
            vid = info.get("id") or d.get("filename", "")
            if vid in da_xong:
                return
            da_xong.add(vid)
            ten = info.get("title") or os.path.basename(d.get("filename", ""))
            log(f"✔ Đã tải {len(da_xong)}: {ten[:80]}")

    def opts_cho(outtmpl, playlistend=None):
        o = {
            "outtmpl": outtmpl,
            # Ưu tiên H.264 (avc1/h264) để trình duyệt phát được — tránh HEVC/bytevc1 (đen hình, chỉ có tiếng)
            "format": ("bv*[vcodec~='^(avc1|h264)']+ba[ext=m4a]/"
                       "b[vcodec~='^(avc1|h264)']/"
                       "bv*[ext=mp4]+ba/b[ext=mp4]/b"),
            "format_sort": ["vcodec:h264"],
            "merge_output_format": "mp4",
            "ignoreerrors": True,
            "nocheckcertificate": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "retries": 3,
            "download_archive": archive,
            "progress_hooks": [hook],
            "concurrent_fragment_downloads": 4,
        }
        if ffmpeg:
            o["ffmpeg_location"] = ffmpeg
        if cookies_file and os.path.isfile(cookies_file):
            o["cookiefile"] = cookies_file
        elif cookies_browser:
            o["cookiesfrombrowser"] = (cookies_browser,)
        if playlistend:
            o["playlistend"] = playlistend
        return o

    # ---- Dựng danh sách (URL, outtmpl) theo chế độ ----
    cong_viec = []  # mỗi phần tử: (list_url, outtmpl, playlistend)

    if a.type == "search":
        if a.platform == "yt":
            for kw in tach_dong(a.input):
                thu_muc = os.path.join(base, "tu-khoa", an_toan(kw))
                outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
                cong_viec.append(([f"{plat['search_prefix']}{count}:{kw}"], outtmpl, count))
                log(f"🔎 Tìm YouTube: {kw} (tối đa {count})")
        elif a.platform == "rd":
            for kw in tach_dong(a.input):
                links = reddit_lay_links("search", kw, a.sort, a.time, count)
                if not links:
                    log(f"⚠ Reddit: không thấy post có video cho '{kw}'.")
                    continue
                thu_muc = os.path.join(base, "tu-khoa", an_toan(kw))
                outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
                cong_viec.append((links, outtmpl, None))
                log(f"🔎 Reddit '{kw}' (sort={a.sort or 'top'}): {len(links)} post có video")
        else:
            log(f"⚠ {a.platform.upper()} không hỗ trợ tìm theo từ khóa. Dùng link hoặc theo kênh/user.")
            print(json.dumps({
                "success": False,
                "downloaded": 0,
                "outputDir": base,
                "files": [],
                "error": "Unsupported search platform",
            }, ensure_ascii=False), flush=True)
            return

    elif a.type == "creator":
        if a.platform == "rd":
            for sub_in in tach_dong(a.input):
                sub = reddit_sub(sub_in)
                links = reddit_lay_links("creator", sub_in, a.sort, a.time, count)
                if not links:
                    log(f"⚠ Reddit r/{sub}: không thấy post có video.")
                    continue
                thu_muc = os.path.join(base, "kenh", an_toan(sub))
                outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
                cong_viec.append((links, outtmpl, None))
                log(f"📺 Reddit r/{sub} (sort={a.sort or 'hot'}): {len(links)} post có video")
        elif a.platform in ("tw", "ig"):
            urls = [chuan_hoa_user(a.platform, x) for x in tach_dong(a.input)]
            thu_muc = os.path.join(base, "kenh", "%(uploader,channel,uploader_id)s")
            outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
            cong_viec.append((urls, outtmpl, count))
            log(f"📺 Tải theo user: {len(urls)} user (tối đa {count} video/user)")
        elif a.platform == "yt":
            urls = [chuan_hoa_kenh_youtube(x) for x in tach_dong(a.input)]
            thu_muc = os.path.join(base, "kenh", "%(channel,uploader,uploader_id)s")
            outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
            cong_viec.append((urls, outtmpl, count))
            log(f"📺 Tải theo kênh YouTube: {len(urls)} kênh (tối đa {count} video/kênh)")
        else:  # tt
            urls = []
            for x in tach_dong(a.input):
                u = chuan_hoa_kenh_tiktok(x)
                if u:
                    urls.append(u)
                else:
                    log(f"⚠ TikTok: không lấy được kênh từ '{x[:50]}' (thử lại, hoặc dán link 1 video của kênh).")
            if not urls:
                log("⚠ TikTok: không có kênh hợp lệ để tải.")
                print(json.dumps({
                    "success": False,
                    "downloaded": 0,
                    "outputDir": base,
                    "files": [],
                    "error": "No valid TikTok channel",
                }, ensure_ascii=False), flush=True)
                return
            thu_muc = os.path.join(base, "kenh", "%(channel,uploader,uploader_id)s")
            outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
            cong_viec.append((urls, outtmpl, count))
            log(f"📺 Tải theo kênh TikTok: {len(urls)} kênh (tối đa {count} video/kênh)")

    else:  # detail
        urls = tach_dong(a.input)
        thu_muc = os.path.join(base, "link")
        outtmpl = os.path.join(thu_muc, "%(title).80B [%(id)s].%(ext)s")
        cong_viec.append((urls, outtmpl, None))
        log(f"🔗 Tải theo link: {len(urls)} video")

    # ---- Thực thi ----
    for urls, outtmpl, pe in cong_viec:
        try:
            with YoutubeDL(opts_cho(outtmpl, pe)) as ydl:
                ydl.download(urls)
        except Exception as e:
            log(f"⚠ Lỗi: {str(e)[:160]}")

    log(f"✔ Hoàn tất. Tải được {len(da_xong)} video.")
    print(json.dumps({
        "success": True,
        "downloaded": len(da_xong),
        "outputDir": base,
        "archive": archive,
        "files": media_files_under(base, session_started - 2),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
