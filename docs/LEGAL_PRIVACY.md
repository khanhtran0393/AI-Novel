# Chính sách quyền riêng tư — AI Novel

**Phiên bản:** 1.0

## Dữ liệu lưu local (mặc định)

- Dự án truyện, lorebook, media path, TTS config: **trên máy bạn** (localStorage + durable Electron).
- API key, cookie và session bạn dán: được mã hóa bằng Windows DPAPI thông qua Electron `safeStorage`, lưu trong vault riêng tại userData; không nằm trong localStorage, snapshot dự án hoặc backup trạng thái.
- HWID: fingerprint máy để gắn license (hostname/arch/OS hash) — **không** phải TPM serial đầy đủ.

## Trial / license

- Bản thương mại gửi mã kích hoạt hoặc token tới license API HTTPS do nhà bán vận hành; token Pro được xác minh offline bằng khóa công khai Ed25519 đóng gói trong app.
- Khóa ký riêng, admin key, payment secret và dữ liệu phát hành license không được lưu trong app khách.

## Không thu thập (mặc định)

- Không analytics bắt buộc.
- Crash log Electron có thể ghi local `%APPDATA%/ai-novel-script-generator/electron-crash.log`.

## Bên thứ ba

Khi bạn dùng Gemini/Flow/OpenAI/Edge… dữ liệu prompt/media đi theo **chính sách của nhà cung cấp đó**.

## Liên hệ

Xóa dữ liệu: gỡ app + xóa userData + thư mục dự án. Hỗ trợ: `docs/INSTALL_SUPPORT.md`.
