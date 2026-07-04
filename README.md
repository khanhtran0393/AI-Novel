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

## 🤖 CÔNG NĂNG TỰ ĐỘNG HÓA MỞ RỘNG (V2.3)
Dự án không chỉ sinh chữ, mà là một cỗ máy sản xuất phim phân cảnh hoàn chỉnh:
- **Đa luồng Gen Ảnh (Labs Whisk)**: Chạy ngầm Headless qua thư viện `puppeteer-stealth`, xoay tua danh sách `cookies` tự động, chạy song song nhiều Worker cùng lúc mà không làm treo UI, và tự dọn dẹp thư mục Chrome sau khi xong.
- **Tách câu động (Dynamic Clause-Level Splitting)**: Backend tự động chẻ nhỏ các đoạn văn dài >100 ký tự bằng các dấu (`,`, `，`, `-`) thành các mệnh đề hình ảnh, đảm bảo đủ số lượng Storyboard cho phân cảnh dài.
- **TTS Local Cache (Nghe thử Offline)**: Tích hợp công nghệ `Cache Storage API` để phát blob URL cục bộ, tiết kiệm băng thông và tăng tốc nghe thử giọng đọc. Đồng bộ timestamp thực tế của TTS sang quy trình chia mốc thời gian vẽ ảnh.
- **Giao tiếp Hệ điều hành (Native Explorer)**: Tích hợp nút `child_process` gọi trực tiếp `explorer.exe` mở thư mục Google Drive Desktop cục bộ.

---

## 🚀 HƯỚNG DẪN BẮT ĐẦU NHANH
Chỉ cần nhấp đúp vào tệp: 👉 **`run.bat`** tại thư mục gốc của dự án. 
Tệp này sẽ tự động chạy Next.js Server và mở web trên trình duyệt: [http://localhost:3000](http://localhost:3000).

> Mọi đóng góp, can thiệp hay sửa chữa mã nguồn từ AI/Developer đều phải bám sát tuyệt đối quy chuẩn trong tài liệu `AGENTS.md` (Master Blueprint). Không phá vỡ hệ thống modular đang vận hành.
