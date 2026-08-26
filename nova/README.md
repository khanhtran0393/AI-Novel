# ChuKienMedia — App Desktop (Electron)

Bọc UI web chukienmedia thành app cho **Windows + macOS**. Giai đoạn 1: đăng nhập
Firebase + admin tab (giữ nguyên hệ thống Pro của bản web).

## Chạy thử (dev)
Cần **Node.js** (nodejs.org). Trong thư mục này:
```
npm install
npm start
```
→ App mở ra, load `https://chukienmedia.com`, đăng nhập Google như web.

Trỏ tới bản local khi phát triển:
```
APP_URL=http://localhost:5500 npm start     # Mac/Linux
set APP_URL=http://localhost:5500 && npm start   # Windows (cmd)
```

## Đóng gói file cài
```
npm run build:mac     # tạo .dmg + .zip (chạy trên máy Mac)
npm run build:win     # tạo .exe cài (NSIS) + portable (nên chạy trên máy Windows)
```
Kết quả nằm trong thư mục `dist/`.

> ⚠️ **Build .exe cho Windows nên chạy trên máy Windows** (hoặc CI Windows) để chắc.
> Build Mac chạy trên Mac. Muốn ký số (không bị cảnh báo virus) thì cần chứng chỉ
> Apple Developer (Mac) / Code Signing Cert (Windows) — làm ở giai đoạn phát hành.

## Ghi chú
- **Firebase login trong app:** popup Google mở thành cửa sổ con; nếu popup lỗi thì
  bản web tự fallback sang redirect (đã có sẵn trong chukienmedia). Nếu đăng nhập
  không được, báo lại để chỉnh luồng auth.
- **Giữ phiên đăng nhập:** dùng `partition: persist:chukienmedia` → không phải
  đăng nhập lại mỗi lần mở app.
- `preload.js` để sẵn cho **Giai đoạn 2** (gọi Flow trực tiếp, proxy per-account,
  lưu ảnh ra folder, FFmpeg…).

## Lộ trình
1. ✅ GĐ1: khung app + Firebase login + admin tab (file này).
2. GĐ2: quản lý tài khoản Flow + proxy per-account + gọi Flow trực tiếp.
3. GĐ3: FFmpeg dựng video + Whisper local + lưu file.
4. GĐ4: giọng nói GPU + ký số + phát hành.
