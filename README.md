# AI Novel & Script Generator - Trình Sinh Kịch Bản Tiểu Thuyết Mạt Thế (V2.3 Ultimate)

Chào mừng bạn đến với **AI Novel & Script Generator**, một không gian làm việc (Workspace) chuyên nghiệp, cao cấp dành riêng cho biên kịch và tác giả sáng tác truyện mạt thế, sinh tồn.
Hệ thống hiện tại đang vận hành ở phiên bản V2.3+ Ultimate, tích hợp quy chuẩn khép kín về giao diện (UI), quy trình (Logic) và hệ thống Tự động hóa ngầm đa luồng (Automations).

---

## ✨ KIẾN TRÚC & GIAO DIỆN CỐT LÕI (PREMIUM UI)
Ứng dụng được xây dựng trên **Next.js (App Router)** + **Tailwind CSS (v4)** + **Zustand Persist (Hydration Safe)**.
- **Tỷ lệ Vàng 3:7**: Không gian làm việc chia tỷ lệ vàng 3:7 (Sidebar/Content). Sidebar tích hợp Accordion co-giãn chứa Dàn ý và Cấu trúc Nhân vật (thay vì dùng Modal nổi gây phân tâm).
- **Màu sắc & Thẩm mỹ**: Giao diện Cyberpunk/Sci-Fi cực kỳ chuyên nghiệp (Nền `zinc-950`, viền `zinc-900/60`, điểm nhấn `amber-500` và `emerald-500` cho các nút bấm hành động).
- **Lightbox Zoom**: Tích hợp tính năng click ảnh phóng to toàn màn hình (Z-index 100, backdrop blur) để kiểm duyệt ảnh storyboard chất lượng cao.
- **Sticky Navigation & Word-Gate**: Thanh điều hướng chương đứng yên giúp chuyển chương siêu tốc, đi kèm Thanh tiến độ Cổng Từ (Word-Gate Progress Bar) dạng Neon trực quan.

## 🧠 LUỒNG LOGIC TỐI CAO
Hệ thống xoay quanh 3 Node vận hành song song:
1. **Setup Node**: Khởi tạo bối cảnh vĩ mô. Tuyệt đối sử dụng "Zero-Legacy Engine", loại bỏ mọi tên gọi rập khuôn, chỉ dùng tên Hán Việt đặc trưng hoang phế.
2. **Write Script Node**: Ứng dụng kỷ luật "Real-time Pacing", cấm AI tóm tắt hay nhảy cóc thời gian, ép miêu tả đa giác quan. Kết xuất bằng **Typing Effect** (Có `.normalize('NFC')` chuẩn tiếng Việt).
3. **Commit Memory Node**: Cuốn chiếu ký ức ngắn hạn liên tục để duy trì tính liền mạch của bộ truyện.

## 🤖 CÔNG NĂNG TỰ ĐỘNG HÓA MỞ RỘNG (V2.3+)
Dự án không chỉ sinh chữ, mà là một cỗ máy sản xuất phim phân cảnh hoàn chỉnh:
- **Đa kênh (Channel DNA)**: Mỗi kênh khóa **Cấu hình đầu ra** + **Giọng đọc toàn cục** (provider, ratio, DNA, speed/pitch…). Đổi kênh nạp lại DNA; self-heal chỉ sửa tạm, không ghi đè DNA.
- **YouTube Studio**: SEO meta chấm điểm, Thumb prompt (EN) gen ảnh như scene, viết lại ± Thumbnail line, overlay preview, biến thể thumb, lightbox.
- **Soát trước đăng**: Panel Ready / Not ready + click jump tới chỗ thiếu (TTS, ảnh, SEO, thumb…).
- **Job queue**: Gen tất cả ảnh xếp hàng — pause / cancel / dọn job xong (panel Jobs trên header).
- **Health + Backup**: Credential & runtime health; portable project export/import (strip secrets); job error report.
- **Ship quality**: CI (`verify:ci`), Zod hot APIs, correlationId logs, Labs hidden by default, core-loop onboarding.
- **Genre packs**: Mạt thế / Trinh thám / Horror radio / Romance / Xuyên không — nạp rules + DNA + TTS mặc định.
- **Ship pack**: copy **file media vật lý** vào folder pack + `media_copy_result.json` + SRT đa speaker.
- **Jobs panel**: Gen all **ảnh + video** + TTS chương mirror job; **Retry failed**; pause/cancel.
- **Policy ảnh**: fail safety → auto viết lại prompt → gen lại 1 lần.
- **Face-ref binary**: concept sheet `face_ref` load server-side → OpenAI edits / Gemini multimodal khi có file.
- **Toast**: workspace hooks chính (scene/TTS/thumb/video/file) dùng toast, giảm `alert`.
- **Studio drawer**: 1 panel mở TTS / Media / DNA / Health.
- **Editor banner**: verdict rewrite/polish → nút Sửa theo nhận xét (sticky).
- **Concept cache**: hash hồ sơ NV → reuse prompt sheet; `face_ref` sau gen concept.
- **Persist v3**: migrate channel `outputDna` / `ttsDna`.
- **TTS → timestamp**: Tự re-sync mốc prompt khi duration TTS lệch >15%.
- **Đa luồng Gen Ảnh**: Whisk/API, cookie xoay, worker song song, dọn profile Chrome.
- **TTS Local Cache**: Cache Storage API nghe thử offline.
- **Native Explorer**: `explorer.exe` mở thư mục lưu.

### Kiểm chứng lõi
```bash
npm run verify:core
```
Chạy DNA kênh · ship pack · publish readiness · youtube-safe · cast unit.

---

## 🚀 HƯỚNG DẪN BẮT ĐẦU NHANH
Chỉ cần nhấp đúp vào tệp: 👉 **`run.bat`** tại thư mục gốc của dự án. 
Tệp này sẽ tự động chạy Next.js Server và mở web trên trình duyệt: [http://localhost:3000](http://localhost:3000).

> Mọi đóng góp, can thiệp hay sửa chữa mã nguồn từ AI/Developer đều phải bám sát tuyệt đối quy chuẩn trong tài liệu `AGENTS.md` (Master Blueprint). Không phá vỡ hệ thống modular đang vận hành.
