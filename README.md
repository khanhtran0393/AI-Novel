# Nova Studio Independent

Ứng dụng desktop Electron độc lập, sử dụng giao diện Nova GUI và runtime native được đóng gói trong thư mục `nova/`.

## Chạy phát triển

```powershell
npm install
npm start
```

## Đóng gói Windows

```powershell
npm run build:win
```

Ứng dụng không khởi chạy Next.js, không sử dụng backend AI Novel và không đọc runtime từ thư mục cài đặt Nova Studio khác. Dữ liệu cấu hình được lưu trong `app.getPath("userData")` của ứng dụng này.

Runtime GUI được mirror từ Nova Studio 0.1.34; source shell Electron riêng nằm tại `nova/main.js` và `nova/preload.js`.
