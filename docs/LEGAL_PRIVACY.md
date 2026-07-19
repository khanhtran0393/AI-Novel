# Chính sách quyền riêng tư — AI Novel

**Phiên bản:** 1.0

## Dữ liệu lưu local (mặc định)

- Dự án truyện, lorebook, media path, TTS config: **trên máy bạn** (localStorage + durable Electron).
- API keys bạn dán: lưu local; app cố gắng **redact** khi log/toast.
- HWID: fingerprint máy để gắn license (hostname/arch/OS hash) — **không** phải TPM serial đầy đủ.

## Trial / license vault (server local)

- File dưới `data/licenses/` trên máy chạy app (trial HWID, activation codes khi seller issue trên máy đó).
- Không tự gửi lên cloud trừ khi **bạn** cấu hình webhook/payment server riêng.

## Không thu thập (mặc định)

- Không analytics bắt buộc.
- Crash log Electron có thể ghi local `%APPDATA%/ai-novel-script-generator/electron-crash.log`.

## Bên thứ ba

Khi bạn dùng Gemini/Flow/OpenAI/Edge… dữ liệu prompt/media đi theo **chính sách của nhà cung cấp đó**.

## Liên hệ

Xóa dữ liệu: gỡ app + xóa userData + thư mục dự án. Hỗ trợ: `docs/INSTALL_SUPPORT.md`.
