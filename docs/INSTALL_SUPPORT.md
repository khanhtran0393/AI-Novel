# Cài đặt và hỗ trợ khách hàng — AI Novel

## Cài đặt trên máy mới

1. Chạy bộ cài `AI-Novel-*-Setup.exe` đã ký số.
2. Mở ứng dụng. Bản thương mại đã chứa cấu hình công khai tới license API; khách hàng không cần nhận file bí mật từ seller.
3. Nhấp logo góc trái → **Bản quyền** → sao chép HWID.
4. Dùng mã `AINOVEL-…`, token đã mua, hoặc bắt đầu Trial nếu máy đủ điều kiện.
5. Nhập API key LLM/ảnh của khách hàng (BYOK), chọn chủ đề + phong cách, rồi viết một chương thử.

File `%APPDATA%\ai-novel-script-generator\.env.commercial` chỉ dùng khi cần ghi đè endpoint công khai. File này tuyệt đối không chứa private key, admin key, webhook secret hoặc Supabase service-role key.

## Free / Trial / Pro

- **Free:** viết, outline, Gen Prompt, TTS Edge cơ bản, ảnh BYOK, project portable.
- **Trial:** 3 ngày / 1 HWID; mở quyền Trial theo ma trận thương mại.
- **Pro:** license gắn HWID; mở video, CapCut/ship và các tính năng Pro tương ứng.

Trial thật được cấp bởi license server. Bản Electron packaged không tạo trial local.

## Thành phần media tùy chọn

Bản public là bản **core sạch** và không phân phối các binary/model chưa có đủ hồ sơ quyền thương mại:

- FFmpeg/Piper trong `bin/`;
- Vina Voice ONNX trong `src/python_core/models/vina_voice/*.onnx`;
- MediaCrawler và audio tham chiếu giọng;
- bộ font gốc chưa xác minh.

Khi một luồng cần thành phần chưa được cài hợp lệ, app phải báo thiếu thành phần; không tự đổi provider, engine hoặc voice. Chỉ bổ sung các thành phần này từ gói riêng đã được seller xác minh quyền phân phối, đúng đường dẫn runtime được tài liệu kỹ thuật quy định.

### Điều kiện dùng CapCut TTS

CapCut TTS là tích hợp tùy chọn và chỉ chạy khi máy khách đã cài:

- CapCut Desktop hợp lệ, có `sscronet.dll` từ chính bản cài của khách hàng;
- CPython x64;
- `cryptography==48.0.0`: `python -m pip install cryptography==48.0.0`.

Kiểm tra Python trước khi hỗ trợ: `python -c "import cryptography; print(cryptography.__version__)"`. AI Novel chỉ đóng gói adapter do dự án sở hữu; không đóng gói CapCut, `sscronet.dll`, tài khoản, cookie hoặc voice của bên thứ ba. Khi thiếu điều kiện, CapCut TTS báo lỗi thẳng và không đổi sang engine khác.

## FAQ nhanh

| Lỗi | Cách xử lý |
|---|---|
| 403 Pro | Kích hoạt token/code hoặc Trial. |
| License API không kết nối | Kiểm tra Internet và `https://ai-novel-flax.vercel.app/api/cloud/status`. |
| Token sai HWID | Xin seller transfer seat hoặc cấp lại token đúng máy. |
| CapCut fail | Cài CapCut Desktop + CPython x64, rồi chạy `python -m pip install cryptography==48.0.0`; app không tự chuyển sang Edge TTS. |
| Flow fail | Đăng nhập lại profile và kiểm tra Flow Bridge. |
| Thiếu FFmpeg/Piper/Vina | Cài gói thành phần đã được cấp quyền; app không đóng gói các file development-only. |
| SmartScreen chặn | Chỉ phát hành bộ cài sau khi có chứng thư ký Windows tin cậy. |
| Không tự cập nhật | Kiểm tra Internet và feed `https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest/latest.yml`; app chỉ cài bản đúng publisher đã ký số. |

## Hỗ trợ

- Zalo admin: **0868.715.114** — `https://zalo.me/0868715114`
- Khi báo lỗi, gửi version app, HWID và correlation id; không gửi API key hoặc token bí mật qua chat công khai.
