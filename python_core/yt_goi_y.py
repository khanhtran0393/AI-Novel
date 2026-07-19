# -*- coding: utf-8 -*-
"""
Gợi ý kênh YouTube THẬT bằng yt-dlp: tìm video theo từ khóa -> gom theo kênh ->
lấy số đăng ký (subscriber) + avatar + mô tả, xếp theo subscriber giảm dần.

Dùng:  python yt_goi_y.py "<từ khóa>"
Env:   GOI_Y_OUT (json ra), GOI_Y_LIMIT (số kênh, mặc định 12)
"""
import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor

from yt_dlp import YoutubeDL

THU_MUC_GOC = os.path.dirname(os.path.abspath(__file__))
THU_MUC_CRAWLER = os.path.join(THU_MUC_GOC, "MediaCrawler")


def _ydl(extra):
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "ignoreerrors": True, "socket_timeout": 20}
    opts.update(extra)
    return YoutubeDL(opts)


def _avatar(thumbs):
    if not thumbs:
        return ""
    # Ưu tiên ảnh vuông (avatar) thay vì banner ngang
    vuong = [t for t in thumbs if t.get("width") and t.get("height")
             and abs(t["width"] - t["height"]) <= 4]
    chon = (vuong or thumbs)[-1]
    return chon.get("url", "")


def goi_y_youtube(keyword, so_video=25, limit=12):
    with _ydl({"extract_flat": True}) as ydl:
        res = ydl.extract_info(f"ytsearch{so_video}:{keyword}", download=False) or {}
    entries = res.get("entries") or []
    chans, order = {}, []
    for e in entries:
        if not e:
            continue
        cu = e.get("channel_url") or e.get("uploader_url")
        ten = e.get("channel") or e.get("uploader")
        if not cu or not ten:
            continue
        if cu not in chans:
            chans[cu] = {"ten": ten}
            order.append(cu)
    order = order[:limit]

    def lay_1(cu):
        out = {"nickname": chans[cu]["ten"], "link": cu, "avatar": "",
               "fans": 0, "videos_count": 0, "signature": ""}
        try:
            with _ydl({"extract_flat": True, "playlist_items": "1"}) as ydl:
                ci = ydl.extract_info(cu, download=False) or {}
            out["nickname"] = ci.get("channel") or ci.get("uploader") or out["nickname"]
            out["fans"] = ci.get("channel_follower_count") or 0
            # yt-dlp không cho tổng số video của kênh một cách rẻ -> để 0 (UI ẩn) thay vì số sai
            out["videos_count"] = 0
            out["signature"] = (ci.get("description") or "").strip()[:140]
            out["avatar"] = _avatar(ci.get("thumbnails"))
        except Exception:
            pass
        return out

    with ThreadPoolExecutor(max_workers=6) as ex:
        creators = list(ex.map(lay_1, order))
    creators.sort(key=lambda c: c.get("fans") or 0, reverse=True)
    return creators


def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(os.environ.get("GOI_Y_LIMIT", "12"))
    out_path = os.environ.get("GOI_Y_OUT") or os.path.join(
        THU_MUC_CRAWLER, "data", "youtube", "_goi_y_kenh.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    creators = []
    try:
        creators = goi_y_youtube(keyword, limit=limit)
    except Exception as e:
        print("YT_GOI_Y_ERR " + str(e))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(creators, f, ensure_ascii=False)
    print("YT_GOI_Y_DONE " + str(len(creators)))


if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
