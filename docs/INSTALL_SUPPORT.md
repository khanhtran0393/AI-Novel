# Cài đặt & hỗ trợ khách — AI Novel

## Cài đặt (máy trắng)

1. Chạy `AI-Novel-*-Setup.exe` (NSIS) hoặc bản portable.
2. (Seller) đặt file secrets:
   - `%APPDATA%\ai-novel-script-generator\.env.commercial`
   - Nội dung tối thiểu:
     ```env
     AINOVEL_ENTITLEMENT_MODE=enforce
     AINOVEL_ENTITLEMENT_SECRET=<chuỗi ≥24 random>
     AINOVEL_ENTITLEMENT_ADMIN_KEY=<seller only — không đưa khách>
     ```
3. Mở app → **Cài đặt → Bản quyền** → copy **HWID**.
4. Gửi HWID cho seller (hoặc redeem mã `AINOVEL-…` đã mua).
5. Dán API key LLM (Gemini/OpenAI…) — **BYOK**.
6. Setup chủ đề + phong cách → viết 1 chương thử.

## Trial

- Nút **Trial** trong Bản quyền: 3 ngày / 1 máy (nếu seller bật `AINOVEL_TRIAL_ENABLED=1`, `AINOVEL_TRIAL_DAYS=3`).
- Hết trial → Free (mất video/CapCut/ship) hoặc mua Pro.

## FAQ nhanh

| Lỗi | Cách xử |
|-----|---------|
| 403 Pro/VIP | Kích hoạt token/code hoặc Trial |
| CapCut fail | Cài CapCut PC; **không** auto Edge (B10) |
| Flow fail | Login lại profile; xem `flow-environment-setup.md` |
| Thiếu FFmpeg | `bin/ffmpeg.exe` trong gói; kiểm tra Health |
| Token HWID sai | Token gắn máy khác — xin seller re-issue |

## Kênh hỗ trợ

- Zalo admin: **0868.715.114** (`https://zalo.me/0868715114`)
- Telegram: cấu hình bot env — khách bấm **Đã thanh toán** trong Bản quyền → tin nhắn gói + HWID + nội dung CK.
- Đính kèm: version app, HWID, correlation id lỗi (nếu có).

## Gói Free làm được gì?

Viết chương, outline, Gen Prompt, TTS Edge/Piper, gen ảnh BYOK, portable project.  
**Pro/Trial:** gen video, CapCut, ship pack, toolbox labs, multi-channel nâng cao.
