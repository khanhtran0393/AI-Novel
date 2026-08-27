# Nova Studio — App Desktop (Electron)

App desktop **Windows + macOS** cho pipeline video faceless hoàn chỉnh: kịch bản AI,
storyboard, sinh ảnh/video (Google Flow), giọng đọc (OmniVoice), dựng video (Remotion +
FFmpeg), đăng YouTube đa kênh.

> **Lưu ý bản này:** hệ thống đăng nhập đã được gỡ bỏ hoàn toàn. App khởi động thẳng
> vào giao diện làm việc, **mọi tính năng Pro/Max đều mở khóa sẵn** — không cần tài
> khoản, không cần kích hoạt.

## Chạy thử (dev)

Cần **Node.js** (nodejs.org). Trong thư mục này:

```
npm install
npm start
```

App mở giao diện local (`web/index.html`) và khởi động trực tiếp — không có màn
hình đăng nhập.

## Đóng gói file cài

```
npm run build:mac     # tạo .dmg + .zip (chạy trên máy Mac)
npm run build:win     # tạo .exe cài (NSIS) + portable (chạy trên máy Windows)
```

Kết quả nằm trong thư mục `dist/`.

## Cấu trúc chính

| Thành phần | Vị trí |
| --- | --- |
| Tiến trình chính Electron | `main.plain.js` (bản dễ đọc), `main.js` (bản đã rút gọn) |
| Bridge renderer | `preload.js` |
| Giao diện (GUI) | `web/` — `index.html` + module JS |
| Trình dựng video | `editor-pro/` (Remotion bundle + Nova editor) |
| Extension chụp Flow | `flow-extension/`, `nova-studio/` (Chrome MV3) |
| Server MCP | `mcp-server/` |
| Native helpers | `flow-native.plain.js`, `voice-native.plain.js`, `watermark-native.js` |

## Runtime binaries (không track trong git)

`node_modules`, `upscaler-bin`, `inpaint-bin`, `voice-backend`, `sqlite-bin`,
`onnx-bin`, `ytdlp-bin`, `editor-pro/remotion-browser` được app tự tải/giải nén khi
cần — xem `.gitignore` ở gốc repo.

## Ghi chú

- Đăng nhập **Google Flow** (trong Settings) là dịch vụ ngoài để sinh ảnh/video —
  giữ nguyên, không liên quan tới tài khoản app.
- Phiên trình duyệt nội bộ dùng `partition: persist:nova-studio-independent`.
- Toàn bộ cấu hình, cache và tài khoản Flow được lưu riêng tại thư mục Electron
  `%APPDATA%\\Nova Studio Independent`; app không đọc hoặc di chuyển dữ liệu từ app cũ.

