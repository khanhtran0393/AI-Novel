# AI Video Studio Independent

Ứng dụng desktop Electron độc lập, sử dụng giao diện AI Video Studio GUI và runtime native được đóng gói trong thư mục `nova/`.

## Chạy phát triển

```powershell
npm install
npm start
```

## Đóng gói Windows

```powershell
npm run build:win
```

Ứng dụng không khởi chạy Next.js, không sử dụng backend AI Novel và không đọc runtime từ thư mục cài đặt AI Video Studio khác. Dữ liệu cấu hình, cache, browser session và tài khoản Flow được lưu riêng trong `%APPDATA%\\AI Video Studio Independent`; không chia sẻ hoặc tự động nhập dữ liệu từ app cũ.

Runtime GUI được mirror từ AI Video Studio 0.1.34; source shell Electron riêng nằm tại `nova/main.plain.js`, protected pair `nova/main.js`, và `nova/preload.js`.

## Canonical source và Auto-Fix

Canonical Electron source được đăng ký tại `auto-fix/config/canonical-source.json` với remote `https://github.com/khanhtran0393/AI-Novel.git`, branch `nova-logic`, và immutable baseline `d936dc4054bfc1e38d0e01e345010d02b8f4ebf0`. Adapter chỉ đọc Git để đối chiếu identity. CI validation/package/provenance đã được định nghĩa nhưng chưa tạo operational evidence hoặc branch protection. Việc đăng ký và CI definition không bật Auto-Fix runtime hoặc quyền đọc/ghi source, chạy command, build, signing, release, rollout hay rollback. M1 vẫn `BLOCKED`; xem `auto-fix/M1-READINESS-REPORT.md`.
