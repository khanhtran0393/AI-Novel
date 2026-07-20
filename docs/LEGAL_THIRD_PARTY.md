# Thông báo thành phần bên thứ ba — AI Novel

Ứng dụng chỉ được phát hành công khai khi mọi thành phần đóng gói đạt trạng thái cho phép trong `THIRD_PARTY_MANIFEST.md`.

| Thành phần | Nghĩa vụ chính |
|---|---|
| Electron / Chromium | Giữ nguyên license Electron và danh sách license Chromium do bộ đóng gói sinh ra. |
| Next.js / React / npm packages | Phân phối notice và license tương ứng với đúng phiên bản đã đóng gói. |
| FableCut | MIT; giữ `vendor/FableCut/LICENSE` trong bản phân phối. |
| FFmpeg | Binary hiện tại bật GPL v3 và codec GPL; phải kèm GPL, thông tin build và quyền truy cập exact corresponding source. |
| Piper / eSpeak NG | Phải xác định chính xác nguồn binary, phiên bản và toàn bộ license/notice áp dụng. |
| Model và voice assets | Chỉ phân phối khi có quyền thương mại, quyền giọng nói và quyền tái phân phối bằng văn bản. |
| Fonts | Mỗi font phải có nguồn, license và bằng chứng quyền tái phân phối. |
| Google Flow / Gemini / OpenAI / xAI / Edge / CapCut | Là dịch vụ hoặc phần mềm bên thứ ba; người dùng phải tuân thủ điều khoản của từng nhà cung cấp. |

Flow Bridge là automation do người dùng chủ động cấu hình; xem thêm `LEGAL_FLOW_DISCLAIMER.md`.
