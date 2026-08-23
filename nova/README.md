# Nova Studio Runtime (GUI + Logic chuẩn, tích hợp vào AI Novel)

`d:\AI Novel` giờ chạy **Nova Studio** làm GUI/logic chính — runtime nội bộ, tự chứa,
**không phụ thuộc** `D:\Nova Studio` (app tham chiếu gốc).

## Cấu trúc

```
nova/                          # Runtime Nova Studio (từ app.asar gốc v0.1.29)
├── main.js                    # Main process Electron (obfuscate — chạy nguyên bản)
├── preload.js                 # contextBridge → window.native.* (Flow/render/upscale/voice/llm-fetch…)
├── flow-native.js             # Google Flow đa tài khoản (token capture, pool gen)
├── flow-bridge.js / flow-cft.js / flow-chrome.js
├── native-tools.js            # FFmpeg render video (ffmpeg-static + ffprobe)
├── upscale-native.js          # Real-ESRGAN offline (GPU Vulkan)
├── watermark-native.js        # Xoá watermark (WatermarkRemover-AI ngoài)
├── voice-native.js            # OmniVoice/XTTS backend (voice-studio/)
├── cli-bridge-native.js       # Bridge CLI Claude/Codex (8790/8791)
├── web/                       # GUI thật (index.html 1.29MB + logo)
├── node_modules/              # ffmpeg-static, ffprobe-static, onnxruntime-node, ws, electron-updater…
├── upscaler-bin/              # realesrgan-ncnn-vulkan.exe + models
├── inpaint-bin/               # migan.onnx (inpaint watermark)
├── voice-backend/             # Backend giọng nói đóng gói (bản cài đặt)
├── sqlite-bin/                # Binary sqlite
└── flow-extension/            # Chrome extension Flow (bridge 8792)

voice-studio/                  # Voice backend đã "cài" (probe path: nova/../voice-studio)
```

## Cách chạy

- `Khoi_Dong_App.bat` hoặc `Khoi_Dong_App_Silent.vbs` → `electron nova`
- `npm run dev:desktop` / `electron .` → cũng boot `nova/main.js` (package.json `main`)
- `productName: chukienmedia-app` → userData = `%APPDATA%\chukienmedia-app`
  (kế thừa dữ liệu thật: profiles, flow-accounts.json, localStorage)

## Đóng gói (installer / portable độc lập)

- `npm run nova:pack:dir` → bản portable `dist-nova\win-unpacked\Nova Studio.exe`
- `npm run nova:pack` → installer NSIS `dist-nova\Nova Studio Setup .exe`
- Config: `nova/electron-builder.json` — layout giống app gốc:
  JS trong `app.asar` (~6.5MB), binary native trong `app.asar.unpacked/nova/*`
  (ffmpeg, ffprobe, onnxruntime, upscaler-bin, inpaint-bin, sqlite-bin, flow-extension).
- ⚠️ KHÔNG chạy exe khi môi trường có `ELECTRON_RUN_AS_NODE=1` (agent IDE) —
  exe crash vì chạy nhầm chế độ Node. Launcher `.bat` đã tự xóa biến này.
- Lưu ý: pipeline pack legacy cũ (`pack:ship`, `preflight:pack`…) gắn với shell
  AI Novel đã xóa — không dùng lại, cần viết lại nếu muốn pack theo kiểu cũ.


## Runtime nội bộ (đã verify bằng probe)

- HTTP server nội bộ `127.0.0.1:47280+` phục vụ `web/index.html` — GUI không load repo ngoài.
- flow-bridge `:8792`, cli-bridge claude `:8790` / codex `:8791`, voice `:8770`.
- FFmpeg/FFprobe: `nova/node_modules/ffmpeg-static/ffmpeg.exe` ✓
- Upscaler: `nova/upscaler-bin/realesrgan-ncnn-vulkan.exe` + 4 models ✓
- MiGAN inpaint: `nova/inpaint-bin/migan.onnx` ✓
- fs-probe boot: **0 đọc file ngoài repo** (không đụng `D:\Nova Studio`).

## GUI cũ AI Novel

Đã xóa (`src/app/workspace/`, shell `main.js`/`preload.js`/splash cũ).
Next.js chỉ còn các API routes (`src/app/api/**`) + lib — để cải tiến dần sau.

## Clean-room QA (máy trắng) + MCP

- **MCP:** `mcps/nova-clean-room/` (stdio) — 8 tools: `setup_clean_room` (backup+wipe userData
  thật), `launch_app` (exe + CDP :9333), `app_status`, `ui_eval`, `ui_click`, `ui_fill`,
  `ui_press_escape`, `teardown` (khôi phục userData thật). Chạy: `node mcps/nova-clean-room/index.mjs`;
  smoke: `npm run smoke --prefix mcps/nova-clean-room`.
- **GUI patches** (inject cuối `nova/web/index.html`, có marker `nova-patch-*`):
  - `nova-patch-esc-close` — Esc đóng modal bằng nút close THẬT của app.
  - `nova-patch-friendly-llm` — lỗi CLI/mạng/401 → hướng dẫn tiếng Việt (wrap `callLLM`).
  - `nova-patch-unlock-sync` — đồng bộ badge UI với trạng thái mở khóa đầy đủ
    (badge `MAX 👑`, ẩn nút Nâng cấp, chip topbar `Admin`).
- **Mở khóa toàn bộ (verified live):** tier = `max` · `isPro/isAdmin = true` ·
  mọi giới hạn (cảnh/kênh/Flow accounts/hàng đợi) = `Infinity` · auto-run + mọi tool mở.
  Không có gate tier ở main process. Verify: `node scratch\verify-unlock.mjs` (CDP :9333).
- **Bài học clean-room (Windows):** Chromium ignore env `APPDATA` → phải backup+rename
  `%APPDATA%\chukienmedia-app` thật; Playwright `connectOverCDP` **không** `browser.close()`
  (giết app); repack khi VS Code mở có thể EBUSY app.asar → output `dist-nova2`.
- Build sạch mới nhất: **`dist-nova2\win-unpacked`**.

## Ghi chú

- Logic main process là code obfuscate của nhà sản xuất — chạy nguyên bản, không sửa.
  GUI (`nova/web/index.html`) KHÔNG obfuscate — đọc/sửa được khi cần tùy biến.
- GUI load Firebase + jszip từ CDN lần đầu (hành vi gốc) — cần mạng.
- Auto-update bỏ qua khi chạy unpackaged (`app.isPackaged = false`).
