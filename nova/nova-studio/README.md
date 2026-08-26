# Flow Image Gen — Tạo ảnh AI giá rẻ (Chrome Extension)

Extension tự chứa (không cần app/agent riêng) để **tạo ảnh AI hàng loạt** qua tài
khoản **Google Labs Flow** — giống app "Workflow AI Giá Rẻ", nhưng chạy hoàn toàn
trong extension. Dùng model **Nano Banana Pro / Nano Banana 2**.

## Cách hoạt động

1. Extension bắt `Authorization: Bearer ya29.*` từ các request của `labs.google`.
2. Hỏi `/v1/credits` để biết gói (Pro/Ultra) + số credit còn lại.
3. Với mỗi prompt: giải reCAPTCHA Enterprise trên tab Flow (content.js + injected.js),
   rồi gọi `…/flowMedia:batchGenerateImages`.
4. Lấy `fifeUrl` từ kết quả để hiển thị + tải về.

## Cài đặt

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc phải trên).
3. **Load unpacked** → chọn thư mục `flow-image-gen`.
4. Bấm icon extension để mở bảng điều khiển.

## Dùng

1. Bấm **🌐 Mở tab Flow** → đăng nhập Google tại `labs.google/fx/tools/flow`
   (giữ tab đó mở — cần cho việc giải captcha).
2. Quay lại bảng điều khiển, bấm **↻ Quét lại** đến khi thấy `● đã kết nối`.
3. Chọn model, tỷ lệ, số lượng/prompt, chất lượng tải.
4. Nhập prompt (mỗi dòng 1 prompt) → **▶ Bắt đầu tạo**.
5. Ảnh hiện trong lưới; **⤓** để tải từng ảnh, **⤓ Tải tất cả** để tải cả mẻ.

## Ghi chú

- **Model:** chỉ 2 model đã xác minh — Nano Banana Pro (`GEM_PIX_2`),
  Nano Banana 2 (`NARWHAL`). Imagen 4 chưa có key xác minh qua API này nên chưa đưa vào.
- **Tỷ lệ:** Flow chỉ có enum xác minh `LANDSCAPE / SQUARE / PORTRAIT`. Nút 4:3 dùng
  chung LANDSCAPE, 3:4 dùng chung PORTRAIT.
- **Captcha:** cần ít nhất 1 tab `labs.google/fx/tools/flow` đang mở & đã đăng nhập.
- Credit sẽ bị trừ theo tài khoản Flow của bạn cho mỗi ảnh — đây chỉ là công cụ
  tự động hoá thao tác bạn vốn làm thủ công trên Flow.

## Cấu trúc

| File | Vai trò |
|------|---------|
| `background.js` | Bắt token, gọi `/v1/credits`, giải captcha, tạo project & sinh ảnh |
| `content.js` / `injected.js` | Cầu nối giải reCAPTCHA trên tab Flow |
| `rules.json` | Đặt lại header `Origin`/`Referer` cho request aisandbox |
| `app.html` / `app.css` / `app.js` | Bảng điều khiển: prompt, cấu hình, hàng đợi, kết quả |

Tham khảo API lấy từ dự án Flowboard (`agent/flowboard/services/flow_sdk.py`).
