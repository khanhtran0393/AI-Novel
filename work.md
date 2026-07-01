# MASTER BLUEPRINT: AI NOVEL & SCRIPT GENERATOR

## 1. BACKGROUND (BỐI CẢNH & MỤC TIÊU DỰ ÁN)
Dự án này là một hệ thống Web App tiên tiến hỗ trợ Biên kịch / Tác giả viết tiểu thuyết (đặc biệt là thể loại Mạt Thế/Sinh Tồn). Khác với các công cụ AI chat thông thường, hệ thống này được thiết kế theo một **Pipeline 3 bước** chuyên nghiệp, tích hợp cơ chế **Rolling Memory** (ký ức cuốn chiếu) để tạo ra các chương truyện dài, logic, liền mạch, cực kỳ đa giác quan và bám sát thực tế.

## 2. PROCESSES (QUY TRÌNH & LUỒNG HOẠT ĐỘNG)
Ứng dụng hoạt động dựa trên 3 Node chính (phải đi tuần tự):

### Node 1: Setup (Khởi tạo Cấu trúc Vĩ mô)
- **Đầu vào:** Tên tác phẩm, Dàn ý tổng thể, Cấu trúc nhân vật, Lorebook (Luật thế giới), và Target Số Từ (Word-Gate: mặc định 4250 từ).
- **Mục đích:** Xây dựng móng vững chắc cho toàn bộ tác phẩm.

### Node 2: Write Script (Sinh kịch bản Đa giác quan)
- **Đầu vào:** Prompt khổng lồ lấy ngữ cảnh từ Node 1.
- **Thực thi:** Gọi API Google Gemini. Sử dụng kỹ thuật **Real-time Pacing** để ép AI miêu tả siêu chi tiết, tránh time-skip.
- **Hiển thị:** Kết xuất văn bản bằng **Typing Effect** (hiệu ứng gõ chữ thời gian thực).

### Node 3: Commit Memory (Nén & Ghi Sổ Ký Ức)
- **Đầu vào:** Kịch bản vừa sinh ra ở Node 2.
- **Thực thi:** Gọi AI đọc lại kịch bản để tự động trích xuất:
  - Tạo tóm tắt cuốn chiếu (<500 từ) để nhồi vào prompt cho Chương tiếp theo.
  - Cập nhật trí nhớ ngắn hạn.

## 3. TASKS CẦN LÀM ĐỂ BUILD APP (TỪ CON SỐ 0)
Nếu bạn bắt đầu lại, hãy thực hiện theo đúng Checklist sau:

- [ ] **Khởi tạo Project:** `npx create-next-app@latest .` (Chọn App Router, TypeScript, Tailwind CSS).
- [ ] **Cài đặt thư viện lõi:** `npm i zustand lucide-react puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-core`
- [ ] **Setup UI/UX:** Cấu hình Tailwind cho giao diện Dark Mode pha Glassmorphism (Nền `zinc-950`, viền `zinc-900/60`, text `zinc-300`, điểm nhấn `amber-500`).
- [ ] **Xây dựng Global Store (Zustand):** 
  - Tạo file `useNovelStore.ts`.
  - Định nghĩa toàn bộ State (Dữ liệu tác phẩm, danh sách API Keys, trạng thái các Node).
  - Tích hợp middleware `persist` để lưu vào `localStorage`.
- [ ] **Xây dựng Giao Diện Pipeline:** Code 3 Tab hiển thị tuần tự cho 3 Node. Thêm hiệu ứng gõ chữ (setInterval kết hợp `substring`) cho Node 2.
- [ ] **Viết API Backend (AI Generator):**
  - Tạo `src/app/api/generate/route.ts`.
  - Xây dựng hàm `callGemini` xử lý: Xoay tua API Key, Backoff (Ngủ đông khi gặp lỗi 429), Model Fallback (từ Lite -> Pro).
- [ ] **Viết API Lấy Cookie (Automation):**
  - Tạo `/api/get-cookie`.
  - Dùng Puppeteer Stealth để mở trình duyệt, vượt Bot Detection của Google, lấy session cookie phục vụ cơ chế Scraping (nếu cần).

## 4. MISTAKES & SOLUTIONS (NHỮNG BẪY KINH ĐIỂN ĐÃ GIẢI QUYẾT)

### 🚨 Bẫy 1: Hydration Mismatch do Zustand Persist
- **Lỗi:** Next.js báo lỗi cây HTML trên Server khác với Client do Zustand load data từ `localStorage` ngay lần render đầu.
- **Cách giải quyết:** Tạo một flag `isHydrated` trong store. Component chỉ render data thật sau khi `useEffect` kích hoạt cờ này lên `true`.

### 🚨 Bẫy 2: Nát Font Tiếng Việt do Typing Effect
- **Lỗi:** Chữ bị rớt dấu (VD: `bấ c`). Nguyên nhân do hàm `substring` cắt trúng ký tự gộp Unicode (NFD), kết hợp với `font-serif` mặc định của Tailwind (Times New Roman) không hỗ trợ tốt tiếng Việt.
- **Cách giải quyết:** Bắt buộc áp dụng hàm `.normalize('NFC')` cho chuỗi trả về từ AI. Đồng thời xóa bỏ `font-serif`, chuyển sang dùng System Font mặc định (Segoe UI / Inter).

### 🚨 Bẫy 3: Webpack Bundle phá vỡ thư viện Puppeteer
- **Lỗi:** Khi gọi API get-cookie, Next.js báo lỗi `utils.typeOf is not a function`. Nguyên nhân do Turbopack/Webpack bundle sai các Dynamic Import trong lõi của `puppeteer-extra`.
- **Cách giải quyết:** Khai báo loại trừ trong `next.config.ts`:
  ```typescript
  serverExternalPackages: ["puppeteer", "puppeteer-core", "puppeteer-extra", "puppeteer-extra-plugin-stealth"]
  ```

### 🚨 Bẫy 4: Thuật toán Xoay Tua API Key & Model bị ngược
- **Lỗi:** Nếu để vòng lặp Key bọc ngoài vòng lặp Model, khi Key 1 kiệt sức ở Model xịn nhất, hệ thống sẽ ngu ngốc hạ cấp Model của chính Key 1 thay vì dùng Key 2 cho Model xịn.
- **Cách giải quyết:** Đảo ngược vòng lặp (Swap Loops). Vòng lặp `Models` nằm ngoài, `Keys` nằm trong. Vắt kiệt toàn bộ các Key cho Model xịn nhất (VD: `gemini-2.5-flash-lite`), khi tất cả đều báo 429 thì mới hạ cấp Model. Đồng thời thêm lệnh `sleep(15000)` (Ngủ đông 15s) giữa các lần xoay Key để tránh bị Google ban IP.

### 🚨 Bẫy 5: Kháng lệnh "Word-Gate" (AI viết quá ngắn)
- **Lỗi:** AI chỉ sinh ra ~2500 từ dù Prompt yêu cầu 4250 từ. Do giới hạn token tự nhiên và bản năng thích tóm tắt của LLM.
- **Cách giải quyết:** Tối ưu hóa lại cấu trúc Prompt bằng kỹ thuật **Real-time Pacing** (Hack luồng tư duy):
  - Ra lệnh: "KHÔNG nhảy cóc thời gian, KHÔNG tóm tắt".
  - Bắt buộc "Miêu tả cực kỳ chậm rãi từng hành động, mở rộng hội thoại".
  - Nhấn mạnh đây là mục tiêu sống còn. Kỹ thuật này ép AI phải vắt chữ, tối đa hóa output token đến mức kịch trần.

## 5. CẤU TRÚC THƯ MỤC DỰ ÁN SẠCH SẼ (CLEAN DIRECTORY MAP)

Dưới đây là sơ đồ tệp tin chuẩn hóa của dự án sau khi đã được quét dọn sạch sẽ các file rác và tài nguyên mẫu không sử dụng:

```text
chuyen-gia-mac-the-app/
├── .git/                      # Lịch sử phiên bản Git
├── .next/                     # Bộ nhớ cache & Build output của Next.js
├── node_modules/              # Thư mục chứa các thư viện dependencies
├── public/                    # Tài nguyên tĩnh sạch (Hoàn toàn trống)
├── scratch/                   # Không gian hoạt động tự động hóa
│   └── chrome-profile-secure/ # Profile Chrome thực tế lưu session đăng nhập Google
├── src/                       # Thư mục mã nguồn chính
│   ├── app/                   # Next.js App Router
│   │   ├── api/               # Các API endpoints backend
│   │   │   ├── check-key/     # API xác thực API Key của Gemini
│   │   │   ├── generate/      # API lõi xử lý Pipeline & Xoay Model
│   │   │   └── get-cookie/    # API tự động lấy Session Cookie từ Google Studio
│   │   ├── workspace/         # Màn hình không gian làm việc chính
│   │   │   └── page.tsx       # Toàn bộ logic frontend, Stepper, Sidebar Trí nhớ
│   │   ├── favicon.ico        # Icon hiển thị trên tab trình duyệt
│   │   ├── globals.css        # Cấu hình Tailwind v4 & Glassmorphic styles
│   │   ├── layout.tsx         # Bố cục HTML & Cấu hình SEO Meta chính
│   │   └── page.tsx           # Trang chủ điều hướng trung chuyển (Loading Sci-fi)
│   ├── scripts/               # Các scripts chạy bổ trợ backend
│   │   └── getCookieWorker.mjs# Worker Puppeteer để chạy tách biệt khi lấy cookie
│   └── store/                 # Quản lý State tập trung
│       └── useNovelStore.ts   # Zustand Store kết hợp Persist (LocalStorage)
├── .gitignore                 # Cấu hình bỏ qua tệp tin Git
├── AGENTS.md                  # Hướng dẫn mô hình phát triển Next.js
├── CLAUDE.md                  # Phím tắt điều phối của Claude
├── README.md                  # Hướng dẫn phát triển tổng quát
├── error.md                   # Cẩm nang phòng ngừa lỗi hệ thống (Hydration, Compile)
├── work.md                    # Bản thiết kế hệ thống (Master Blueprint - File này)
├── next-env.d.ts              # Định nghĩa môi trường kiểu Next.js
├── next.config.ts             # Cấu hình Next.js (chứa Server External Packages)
├── package.json               # Danh sách dependencies & NPM Scripts
├── package-lock.json          # Khóa phiên bản dependencies chi tiết
├── postcss.config.mjs         # Cấu hình xử lý CSS
├── run.bat                    # Trình khởi động một chạm nhanh trên Windows
└── tsconfig.json              # Cấu hình biên dịch TypeScript
```

---
*Tài liệu này là "Chiến lược đóng gói" toàn diện. Bất kỳ AI/Developer nào đọc hiểu tài liệu này đều có thể clone lại 100% logic phức tạp nhất của dự án.*

## 6. CHI TIẾT CẢI TIẾN HỆ THỐNG & NHẬT KÝ CẬP NHẬT (PHIÊN BẢN V2.1)

Vào ngày 25/05/2026, toàn bộ hệ thống đã được nâng cấp lên **Phiên bản V2.1** với các cải tiến sâu về mặt UX/UI, tối ưu hóa thuật toán sinh văn bản, tích hợp sâu vào hệ điều hành cục bộ (Desktop Integrations) và nâng cao tính nhất quán hình ảnh của nhân vật (Character Visual Consistency):

### 1. Nút Viết Lại Toàn Bộ Kịch Bản (Full Chapter Overwrite)
- **Cơ chế:** Thêm nút **"Viết lại kịch bản từ đầu"** trong cột điều khiển bên trái (`Sidebar.tsx`). Khi kích hoạt, tham số `overwrite = true` được truyền vào `handleWriteChapter`.
- **Logic:** `baseContent` của chương sẽ bị ép về chuỗi rỗng `""`, cho phép gọi API sinh lại kịch bản chi tiết của chương từ đầu thay vì chỉ viết tiếp (`append`) như trước.

### 2. Định Dạng Số Thứ Tự Prompt Theo Cảnh (`c1-01`, `c1-02`...)
- **Cơ chế:** Thay thế mốc thời gian hiển thị cũ hoặc lồng ghép tinh tế định dạng số thứ tự tuần tự dạng `c[Cảnh]-[Thứ tự Prompt]` (ví dụ: `c1-01`, `c1-02`...) trong `SceneCard.tsx`.
- **Sao chép:** Định dạng mới cũng được tự động chèn vào khi sao chép toàn bộ prompt của phân cảnh nhằm đồng bộ hóa tối đa với tên tệp tài nguyên khi đưa vào các studio vẽ ảnh/video bên ngoài.

### 3. Bộ Nhớ Đệm Âm Thanh Nghe Thử Cục Bộ (TTS Local Pre-listening Cache)
- **Cơ chế:** Tận dụng công nghệ trình duyệt gốc **Cache Storage API** (`caches.open('tts-prelisten-cache-v1')`) trong `useTTSActions.ts`.
- **Luồng chạy:** 
  1. Khi nhấn "Nghe thử", hệ thống tạo một `cacheKey` duy nhất dựa trên tên giọng đọc và băm đoạn văn bản mẫu.
  2. Nếu tìm thấy tệp trong Cache Storage, phát trực tiếp qua `URL.createObjectURL(blob)` mà hoàn toàn không cần gọi mạng (Offline-first).
  3. Nếu chưa có cache, gọi API `/api/generate-tts` để tải file về, lưu trữ vào Cache Storage rồi phát.

### 4. Đồng Bộ Tên Kịch Bản Lưu Trên Google Drive
- **Cơ chế:** Truyền trực tiếp `ten_tac_pham: store.ten_tac_pham` từ client lên API `/api/generate-tts`.
- **Đặt tên file:** API phía máy chủ sẽ tự động làm sạch tên truyện khỏi các ký tự cấm của hệ điều hành, sau đó đặt tên file thu âm trên Google Drive cục bộ dạng: `[Tên Truyện]_Chuong_[X]_Canh_[Y].mp3`, giúp việc đồng bộ hóa dữ liệu cực kỳ ngăn nắp.

### 5. Di Cư Dàn Ý Kịch Bản Qua Cột Trái (Sidebar Outline Relocation)
- **UI/UX:** Loại bỏ hoàn toàn hệ thống các Tab điều hướng chập chờn ở giữa. Ô trung tâm giờ đây được giải phóng 100% không gian chỉ dành riêng cho **Kịch Bản Làm Việc (Working Script)**.
- **Tích hợp cột trái:** Dàn ý chi tiết của chương, Dàn ý tổng quan toàn tác phẩm, và Sổ tay thế giới (Lorebook) được gom lại gọn gàng dưới dạng các thẻ accordion Sci-Fi có khả năng co giãn tùy ý bên cột trái (`Sidebar.tsx`), giúp biên kịch dễ dàng đối chiếu cốt truyện trong lúc làm việc.

### 6. Tích Hợp Mở Thư Mục Hệ Điều Hành Cục Bộ (Native Explorer Hooking)
- **Cơ chế:** Xây dựng API `/api/open-folder` sử dụng module `child_process` của Node.js để kích hoạt trực tiếp tiến trình `explorer.exe` trên hệ điều hành Windows của người dùng.
- **Nút tương tác:** Thêm nút **"Mở"** bên cạnh ô nhập đường dẫn Drive ở Header, và các nút **"📁 Mở thư mục lưu"** trong các bảng Accordion TTS & Studio phân cảnh, cho phép biên kịch mở nhanh thư mục lưu trữ assets cục bộ chỉ với 1 cú click chuột.

### 7. Thanh Tiến Độ Cổng Từ Chương (Word-Gate Progress Bar)
- **UX/UI:** Render một thanh tiến độ dạng neon rực rỡ kèm thông số chính xác ở đầu trình soạn thảo kịch bản: `Tiến độ chương: [Số từ hiện tại] / [Số từ yêu cầu] từ ([Phần trăm]%)`.
- **Tác dụng:** Giúp người dùng kiểm soát trực quan độ dài của chương truyện, đồng thời hiển thị cảnh báo hướng dẫn biên kịch viết thêm hoặc gọi AI viết tiếp nếu chưa đạt tiêu chí số từ yêu cầu (Word-Gate).

### 8. Thiết Lập Tạo Hình Nhân Vật & Tính Nhất Quán Hình Ảnh (Character Profile Modal)
- **Modal nổi:** Khi click vào các tag nhân vật đã phát hiện bên cột trái, một cửa sổ nổi chuyên nghiệp `CharacterPromptModal.tsx` sẽ xuất hiện.
- **Thuộc tính:** Người dùng có thể điền Giới tính, Trang phục, Sở thích, Thói quen và bấm nút **"Sáng tạo Prompt AI"** để AI tự động vẽ concept art tiếng Anh cho nhân vật.
- **Nhất quán hình ảnh (Consistency):** Khi người dùng bấm sinh Prompt vẽ ảnh cho phân cảnh, client sẽ truyền danh sách `nhan_vat_prompts` lên `/api/generate`. AI sẽ tự động phân tích xem câu truyện có nhắc đến tên nhân vật nào không để tự động chèn mô tả tạo hình chi tiết của nhân vật đó vào prompt vẽ ảnh tiếng Anh, đảm bảo hình ảnh nhân vật luôn đồng nhất qua mọi phân cảnh.

### 9. Nút Viết Lại Prompt Đơn Lẻ (Targeted Prompt Regen)
- **Cơ chế:** Thêm nút **"Viết lại" (Regen)** bên cạnh nút Copy của từng câu prompt nhỏ trong Studio Cảnh.
- **Đặc trị:** Khi một prompt bị lỗi, không vừa ý hoặc vi phạm chính sách của Midjourney/Stable Diffusion, người dùng chỉ cần click viết lại câu đó. API `/api/generate` với type `REGENERATE_PROMPT` sẽ phân tích câu gốc và prompt cũ để viết lại một prompt tiếng Anh mới an toàn, nghệ thuật hơn, đồng thời cập nhật đúng vị trí phần tử đó trong store mà không làm ảnh hưởng đến các câu prompt khác.

---

## 7. CHI TIẾT CẢI TIẾN HỆ THỐNG & NHẬT KÝ CẬP NHẬT (PHIÊN BẢN V2.2)

Vào ngày 25/05/2026, toàn bộ hệ thống đã được nâng cấp lên **Phiên bản V2.2** với các giải pháp tự động hóa nâng cao đột phá:

### 1. Di Cư Form Hồ Sơ Nhân Vật Sang Trực Tiếp Sidebar Trái (Sidebar Co-Giãn)
- **Cải tiến:** Thay vì mở một popup modal nổi đè lên màn hình gây phân tâm, khi click vào các tag nhân vật đã phát hiện (ví dụ: `Hàn Dực`, `Liễu Yên`...) ở cột trái, hệ thống sẽ mở ra một form soạn thảo co-giãn **trực tiếp ngay bên dưới danh sách nhân vật** (tương tự như ô soạn thảo văn học của các Cảnh).
- **Cơ chế:** Biên kịch có thể click lại vào chính tag đó hoặc bấm "Hủy"/"Thu nhỏ" để đóng gọn gàng form này lại. Trạng thái chỉnh sửa tự động đồng bộ hóa thời gian thực (real-time data binding) với Zustand Store để cấp dữ liệu tạo hình cho toàn bộ prompt kịch bản ở giữa.

### 2. Tự Động Quét Thời Gian Voice TTS Làm Tham Chiếu Cho Prompt Vẽ Ảnh
- **Logic:** Khi người dùng bấm **"Gen Prompt Studio"** hoặc nhập thời lượng phân cảnh, hệ thống sẽ tự động quét và kiểm tra xem phân cảnh này đã được sinh giọng đọc TTS hay chưa (kiểm tra `store.generatedAudioPaths[assetKey]`).
- **Thời lượng:** Nếu đã có file âm thanh TTS, hệ thống sẽ **tự động lấy thời lượng thực tế của giọng đọc TTS đó** làm tham chiếu chuẩn xác để chia tỷ lệ mốc thời gian (timestamp) cho các prompt vẽ ảnh, đảm bảo sự ăn khớp hoàn hảo giữa âm thanh và hình ảnh storyboard!

### 3. Tích Hợp Đa Luồng Chạy Ngầm Sinh Ảnh Bằng Google Labs Whisk (Labs Whisk Automation Engine)
- **Đầu cuối API:** Xây dựng API `/api/generate-image/route.ts` tích hợp Puppeteer Stealth để tự động hóa hoàn toàn việc sinh ảnh chất lượng cao trên **Google Labs Whisk** (`https://labs.google/fx/tools/flow?from=whisk`).
- **Đa luồng song song (Parallel Processing):** Hệ thống hỗ trợ chạy ngầm hoàn toàn (Headless) và hỗ trợ **chạy đa luồng song song**. Khi người dùng bấm **"Gen tất cả ảnh"**, client sẽ gửi đồng thời nhiều yêu cầu API lên máy chủ. Máy chủ Next.js sẽ tự động phân phối các tác vụ này chạy song song trên các luồng Puppeteer độc lập!
- **Xoay vòng Cookies:** Để tránh bị Google giới hạn tần suất (Rate Limiting), hệ thống tự động xoay vòng danh sách cookies người dùng đã nhập (`googleStudioCookies`) cho từng chỉ số prompt vẽ ảnh (`promptIndex % cookies.length`), giúp tối đa hóa hiệu suất đa luồng!
- **Subject Reference:** Khi sinh ảnh, nếu prompt hoặc câu gốc của cảnh có nhắc đến tên nhân vật nào, hệ thống tự động quét và lấy prompt tham chiếu tạo hình của nhân vật đó ở cột trái nạp trực tiếp làm Subject Reference cho Whisk, đảm bảo tính nhất quán tạo hình nhân vật (Character Consistency) ở mức tuyệt đối!
- **Hỗ trợ mạng Proxy (1.1.1.1):** Khi có lỗi kết nối hoặc bị Google Labs chặn IP do phân vùng địa lý, giao diện hiển thị các cảnh báo thông minh hướng dẫn người dùng cài đặt và kích hoạt ứng dụng Cloudflare **Warp 1.1.1.1** để thay đổi IP, giúp quá trình sinh ảnh luôn thông suốt.
- **Storyboards Gallery:** Khi ảnh được sinh xong, tệp PNG sẽ được tải về và lưu trực tiếp trong thư mục `/public/images/` cục bộ kèm theo sao lưu sang Google Drive Desktop. Ảnh kết quả sẽ được hiển thị ngay bên dưới ô nhập prompt của từng câu một cách vô cùng chuyên nghiệp và sinh động!
- **Gen lẻ & Tạo lại ảnh:** Thêm nút **"Gen ảnh"** (nếu chưa sinh) và **"Tạo lại ảnh"** (nếu ảnh cũ bị lỗi hoặc chưa ưng ý) đằng sau mỗi câu prompt vẽ ảnh.

### 4. Nâng Cấp Bản Phát Hành Tự Động Hóa V2.2 (Sửa lỗi đa luồng, cookies tự động và dọn dẹp)
Hệ thống được cải tiến đột phá để vá toàn bộ lỗi vận hành đa luồng Puppeteer và nâng cao tính tiện ích cho người dùng:
- **Sandbox cô lập tệp tin Chrome profile cục bộ:** Tạo thư mục cache Chrome tạm thời cho mỗi worker theo ID Cảnh + ID Prompt + Timestamp. Lập tức xóa sạch thư mục tạm này ở khối `finally` ngay khi sinh ảnh xong, giúp dung lượng ổ cứng của người dùng luôn sạch sẽ 100%.
- **Khôi phục Lấy Cookie Tự động:** Thêm nút "🤖 Lấy Cookie Tự Động" vào Header. Khi bấm, hệ thống kích hoạt API `/api/get-cookie` để mở Chrome cục bộ, người dùng chỉ cần đăng nhập Google, hệ thống sẽ tự động bắt cookies và đồng bộ ngay về store.
- **Tải Warp 1.1.1.1 VPN:** Bổ sung nút bấm neon "⚡ TẢI 1.1.1.1 VPN" tại Header kết nối trực tiếp đến trang chủ Cloudflare để biên kịch tải về, giúp chạy đa luồng sinh ảnh bền bỉ không bị Google Labs chặn phân vùng hoặc IP WAF.
- **Phân tách câu đơn và mốc thời gian hoàn mỹ:** Chuyển đổi cơ chế bóc tách prompt kịch bản. Backend tách văn bản thành danh sách câu đơn được đánh số thứ tự trước, AI chỉ cần trả về cảm xúc và prompt tiếng Anh cực kỳ nhanh chóng. Server sau đó tự động ghép cặp với câu gốc và chia đều mốc thời gian (timestamp) hoàn hảo theo tổng thời lượng (ví dụ: 242 giây), triệt tiêu hoàn toàn lỗi thiếu prompt hình ảnh.
- **Mở thư mục lỗi tự động chuyển Web:** Bọc lót API mở thư mục cục bộ. Nếu không tìm thấy đường dẫn Desktop trên máy chủ, API trả về mã lỗi 404 kèm `fallbackUrl`. Frontend lập tức hiển thị bảng xác nhận thông minh chuyển tiếp người dùng sang liên kết Google Drive trực tuyến trên trình duyệt web.
- **Sinh ảnh nhân vật ngay Sidebar trái:** Tích hợp nút vẽ concept art chân dung nhân vật ngay bên trong form cấu hình nhân vật co-giãn ở Sidebar trái. Ảnh được sinh ra sẽ hiển thị với viền kính mờ cực kỳ sang trọng cùng hiệu ứng thu phóng khi di chuột (hover zoom).
- **Purge asset dọn dẹp dự án cũ:** Xây dựng API `/api/cleanup-assets`. Khi người dùng click "Làm Mới Dự Án", hệ thống sẽ tự động quét sạch toàn bộ file audio, hình ảnh và browser profile tạm của kịch bản cũ cục bộ để chuẩn bị cho kịch bản mới hoàn mỹ không bị chồng chéo.

### 5. Bản Sửa Lỗi V2.2 Hotfixes & Dashboard Enhancements
Hệ thống tiếp tục được tối ưu hóa sâu sắc dựa trên các phản hồi vận hành thực tế:
- **Khắc phục triệt để lỗi "Invalid cookie fields" của Puppeteer:** Lớp lọc cookies mới tự động làm sạch chuỗi cookies thô. Nếu Puppeteer báo lỗi định dạng tệp cookie khi gọi `setCookie` hàng loạt, hệ thống tự động kích hoạt vòng lặp bọc lót khẩn cấp để nạp từng dòng cookie đơn lẻ hợp lệ và bỏ qua cookie bị lỗi, bảo vệ tiến trình sinh ảnh ngầm an toàn tuyệt đối.
- **Nơi cấu hình lưu trữ tiện ích bên trái:** Thêm ô nhập đường dẫn Drive và nút "Mở thư mục" đồng bộ hóa trực tiếp dưới trường "TÊN TÁC PHẨM" ở Sidebar trái, giúp người dùng mở nhanh thư mục lưu trữ ngay tại pane điều khiển mà không cần mở dropdown Header.
- **Thanh Chọn Nhanh Từng Chương Đứng Yên (Sticky Navigation):** Ở đầu không gian soạn thảo kịch bản, thêm thanh điều hướng chương nhanh hiển thị nút bấm trực tiếp cho từng chương (ví dụ `Chương 1`, `Chương 2`...). Người dùng có thể lật tức thời giữa các chương truyện siêu dài mà không cần cuộn trang lên xuống vất vả.
- **Bảng Thống Kê Hình Ảnh Chương Song Song:**
  - Nâng cấp card tiến độ ở đầu trang lên giao diện 2 cột: Cột trái thể hiện Tiến độ số lượng từ viết (Word-Gate), Cột phải hiển thị Thống kê hình ảnh chương hiện tại (Đã sinh thành công bao nhiêu ảnh • Số lượng bị lỗi hoặc chưa sinh).
  - Tích hợp chỉ số tỉ lệ hình ảnh trực tiếp lên các nút chọn nhanh chương (ví dụ: `Chương 1 (3/5)`), giúp biên kịch nắm bắt tức thì tiến độ làm phim phân cảnh của toàn bộ tác phẩm chỉ với một ánh nhìn.

### 6. Bản Cập Nhật V2.3: Phân Tách Phân Cảnh Sâu & Khôi Phục Nút Sinh Ảnh Cao Cấp
Bản cập nhật này giải quyết triệt để hai vấn đề lớn liên quan đến hiệu suất phân tách kịch bản dài và khôi phục giao diện sinh ảnh:
- **Thuật Thuật Phân Tách Câu Động Cao Cấp (Dynamic Clause-Level Splitting):**
  - **Vấn đề cũ:** Với phân cảnh dài (ví dụ: 518 giây kịch bản, chứa 1.295 từ), nếu chỉ phân tách strictly theo dấu chấm câu, kịch bản chỉ được chia thành 9 câu dẫn đến chỉ sinh ra 9 prompts - không đủ để mô tả hình ảnh cho 518 giây phim.
  - **Giải pháp mới:** Tích hợp bộ tách câu thông minh ở backend (`src/app/api/generate/route.ts`). Nếu một đoạn văn vượt quá 100 ký tự và chứa dấu phẩy `,`, dấu phẩy tiếng Trung `，`, hoặc gạch ngang ` - `, hệ thống sẽ tách nhỏ đoạn văn đó thành các vế câu hình ảnh (clauses). Đồng thời sử dụng bộ tích lũy (accumulator) để đảm bảo không vế câu nào bị phân mảnh vụn vặt (< 40 ký tự), giúp sinh ra storyboard dày dặn, giàu hình ảnh (khoảng 25-45 prompts cho 518 giây), đáp ứng hoàn hảo thời lượng phân cảnh dài.
- **Khôi Phục & Làm Nổi Bật Giao Diện Điều Khiển Sinh Ảnh (Restore Premium Buttons UI):**
  - **Khôi phục nút:** Trực tiếp khôi phục và đảm bảo hiển thị hoàn mỹ các nút bấm điều khiển quan trọng gồm nút "🚀 Gen tất cả ảnh" tại thanh tiêu đề danh sách, nút "Gen ảnh" / "Tạo lại ảnh" đằng sau mỗi câu prompt vẽ ảnh.
  - **Thiết kế tối tân, độ tương phản cao:** Thay đổi phong cách thiết kế từ các nút tối ẩn của Tailwind v4 sang phong cách Emerald cao cấp (`bg-emerald-500 hover:bg-emerald-400 text-black px-2.5 py-0.5 rounded shadow-md`), đảm bảo các nút bấm nổi bật rực rỡ, không bị chìm hay ẩn vào nền tối và tạo cảm hứng làm việc chuyên nghiệp cho biên kịch.
  - **Mở khóa Đa Luồng API Key:** Cải tiến logic validation trong `handleGenerateAllImages`. Hệ thống hiện tại cho phép bấm sinh hàng loạt ảnh bằng API Key (Imagen 3) hoặc Cookie Google Studio xoay vòng, không còn bị chặn cứng nếu người dùng chưa nhập Cookie như ở phiên bản cũ.
- **Tính Năng Phóng To Ảnh Cao Cấp (Premium Lightbox Image Zoom):**
  - **Mục tiêu:** Thêm tính năng cho phép biên kịch click trực tiếp vào bất kỳ hình ảnh nào đã sinh trên UI để phóng to toàn màn hình xem chi tiết nghệ thuật điện ảnh sắc nét.
  - **Cơ chế hoạt động:** Thiết lập trạng thái `zoomImageUrl` cục bộ trong trang workspace lõi (`page.tsx`) và phân phối qua callback `onImageZoom` tới tất cả các component con gồm `Sidebar` (phóng to ảnh chân dung concept nhân vật) và `ContentTab` -> `SceneCard` (phóng to ảnh storyboard phân cảnh).
  - **Trải nghiệm đỉnh cao (UX):** Thiết kế khung chứa lightbox chiếm trọn màn hình với lớp phủ mờ tinh khiết (`fixed inset-0 z-[100] bg-black/90 backdrop-blur-md cursor-zoom-out`), hỗ trợ hiệu ứng chuyển động mở rộng cực mượt (`animate-in zoom-in-95 duration-200`) và tính năng đóng tức thì khi click bất kỳ đâu ngoài ảnh hoặc bấm nút chéo (✕) góc trên bên phải. Giao diện hình ảnh được thêm thuộc tính `cursor-zoom-in` khi di chuột để định hình hành động cho người dùng.
