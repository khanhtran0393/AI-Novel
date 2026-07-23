# AI Novel & Script Generator - Ultimate Studio

Chào mừng bạn đến với **AI Novel & Script Generator**, một không gian làm việc (Workspace) chuyên nghiệp, cao cấp dành riêng cho biên kịch, đạo diễn hình ảnh và tác giả sáng tác nội dung đa phương tiện.
Hệ thống hiện tại là một Studio khép kín: từ khâu viết kịch bản AI, storyboard, lồng tiếng đa nhân vật (TTS), cho đến gen ảnh, gen video và xuất dự án thẳng vào CapCut.

---

## ✨ KIẾN TRÚC & GIAO DIỆN (PREMIUM UI)
Ứng dụng được xây dựng trên **Next.js (App Router)** + **Tailwind CSS (v4)** + **Zustand Persist (Hydration Safe)**, được bọc trong một vỏ **Electron** (Desktop Shell) để can thiệp hệ thống tệp và tiến trình hệ điều hành.
- **Tỷ lệ Vàng 3:7**: Không gian làm việc chia tỷ lệ vàng 3:7 (Sidebar trái / Content phải). Sidebar tích hợp Accordion co-giãn chứa Dàn ý và Cấu trúc Nhân vật.
- **Màu sắc & Thẩm mỹ**: Giao diện Cyberpunk/Sci-Fi chuyên nghiệp (Nền `zinc-950/zinc-900`, hiệu ứng kính mờ glassmorphism, điểm nhấn `emerald-500` cho hành động chính).
- **Lightbox Zoom**: Tích hợp tính năng click ảnh/video phóng to toàn màn hình (Z-index 100, backdrop blur) để kiểm duyệt chất lượng cao.
- **Tính năng độc quyền**: Sticky Navigation, Word-Gate, thanh công cụ Toolbars, màn hình giám sát luồng Gen (Media Gen Progress).

## 🧠 LÕI ENGINE "NATIVE"
- **Zero-Legacy Engine**: Code engine hoạt động 100% bằng TypeScript Native in-process. Không phụ thuộc vào các binary Go cũ. Hỗ trợ đa dạng thể loại (không ép buộc một thể loại cố định). 
- **Setup Genre**: Quy định thế giới, phong cách, luật lệ được cá nhân hóa hoàn toàn ở Bước Setup (không hardcode).
- **Character Roster**: Quản lý hồ sơ nhân vật sâu (tuổi, giới tính, ngoại hình, khuyết điểm, động cơ, giọng TTS riêng biệt). Tự động nạp vào Prompt Studio để khóa định dạng nhân vật (Identity Lock).

## 🎬 TỔ HỢP SẢN XUẤT MEDIA TOÀN DIỆN
Dự án không chỉ sinh chữ, mà là một cỗ máy sản xuất phim phân cảnh hoàn chỉnh:
- **Prompt Studio**: Tự động sinh `image_prompt` (ảnh), `video_prompt` (video), phân rã timestamp đồng bộ với TTS. Tích hợp đạo diễn (Director Formulas) cho góc máy (Wide, Medium, Close-up).
- **Voice Cast (Multi-Voice TTS)**: Gán giọng riêng biệt cho từng nhân vật. Hỗ trợ Vina Voice, Edge TTS, Piper, CapCut. Ghép nối liền mạch đoạn hội thoại và dẫn truyện. Tự động đồng bộ (re-sync) timestamp hình ảnh theo thời lượng giọng nói.
- **Ảnh (Images) & Video Gen**: Hỗ trợ xuất qua Flow Bridge (Google Flow), Veo, Whisk, Gemini, OpenAI... Tự động lập lịch xếp hàng (Job Queue).
- **Google Flow Bridge**: Hệ thống cầu nối (Bridge) tự động điều khiển trình duyệt qua Puppeteer để gen ảnh/video trên Flow một cách âm thầm, hỗ trợ đa tài khoản (Multi-account).

## 🤖 CÔNG NĂNG TỰ ĐỘNG HÓA & TÍCH HỢP
- **CapCut / FableCut Integration**: Tự động build timeline JSON. Sắp xếp Audio, Hình ảnh, Video, Subtitles thành một file dự án CapCut/FableCut mở lên là render được ngay. Hỗ trợ Pro Gate.
- **YouTube SEO**: Hỗ trợ chuẩn bị đăng bài (Title, Description, Tags, Thumbnail Prompt, Checklist an toàn tâm lý).
- **Auto-Debug & Self-Heal**: Hệ thống tự động sửa lỗi ngầm với API. Cấu trúc bypass-engine để xử lý các block từ CDN/Cloudflare.
- **Tích hợp Job Queue**: Quản lý tiến trình Gen Media đa luồng (pause/cancel/resume).
- **Quản lý Media Path**: Mọi file ảnh/video/audio đều lưu trữ vật lý trên đĩa và được map thông qua `sceneAssetKey`.

## 🚀 HƯỚNG DẪN BẮT ĐẦU NHANH
- **Chạy Dev Web**: 
  ```bash
  npm run dev
  ```
  Truy cập vào web trên trình duyệt: [http://localhost:3000](http://localhost:3000)

- **Chạy Desktop (Electron)**: 
  Mở terminal khác, chạy:
  ```bash
  npm run electron
  ```

> ⚠️ **Lưu ý**: Mọi đóng góp, can thiệp hay sửa chữa mã nguồn từ AI/Developer đều phải bám sát tuyệt đối quy chuẩn trong tài liệu `AGENTS.md` (Bách khoa toàn thư dự án). Không phá vỡ hệ thống modular đang vận hành. Tuyệt đối không fallback ngầm nếu gặp lỗi (luật B10).
