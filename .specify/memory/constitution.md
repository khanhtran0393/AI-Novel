<!--
Sync Impact Report
- Version change: 0.0.0 -> 1.0.0
- Modified principles: Initialized core principles based on user prompt and AGENTS.md
- Added sections: Core Principles, Technology Constraints, Development Workflow
- Removed sections: N/A
- Templates requiring updates: None (Initial run)
-->

# AI Novel Constitution

## Core Principles

### I. Stack Công Nghệ Lõi (Core Tech Stack)
Bắt buộc sử dụng bộ khung:
- **Framework**: Next.js 14 (App Router) với TypeScript.
- **State Management**: Zustand tích hợp middleware `persist` (Lưu LocalStorage). Mọi component đọc dữ liệu Zustand BẮT BUỘC phải có cờ `isHydrated` (chỉ render sau khi `useEffect` đã mount) để tránh lỗi Hydration Mismatch của Next.js SSR.
- **Styling**: TailwindCSS v4. Cấm sử dụng các thiết kế chói lóa rẻ tiền, sử dụng phong cách Glassmorphism cao cấp.

### II. Cấu Trúc Mã Nguồn (Code Architecture)
Tách bạch rõ ràng logic và giao diện:
- Logic xử lý (Actions, Hooks) đặt tại `src/app/workspace/use[X]Actions.ts` (ví dụ: `useWriteChapter.ts`) hoặc thư mục `modules/`.
- Giao diện UI phải được phân mảnh và tái sử dụng, đặt tại thư mục `components/` (ví dụ: `SceneCard.tsx`, `Sidebar.tsx`, `Header.tsx`).

### III. Vòng Lặp Kiểm Chứng Thực Chiến (Empirical Validation)
Mọi đoạn code sinh ra BẮT BUỘC phải được chạy thử và kiểm chứng bằng Output log thực tế (chạy lệnh hoặc test giao diện) trước khi phản hồi hoàn thành. Không bao giờ được bàn giao mã lỗi cho người dùng tự sửa. Agent phải lặp lại việc sửa lỗi cho đến khi thành công 100%.

### IV. Thẩm Mỹ & Trải Nghiệm Giao Diện (UI/UX)
Áp dụng Tỷ lệ Vàng 3:7 (Sidebar Trái : Vùng làm việc Phải). Giao diện mang thẩm mỹ Cyberpunk/Sci-Fi cao cấp. Các hiệu ứng cuộn, hover phải được đảm bảo (Scrollable modal). Tuyệt đối cấm sử dụng Modal nổi che khuất toàn màn hình làm đứt gãy mạch sáng tác.

## Môi Trường Khép Kín (Closed Environment & Tooling)

- **Trình Duyệt Tự Động**: Dự án sử dụng `puppeteer-extra-plugin-stealth` để làm tự động hóa. Bắt buộc giữ khai báo `serverExternalPackages` trong `next.config.ts`.
- **Cache Offline**: Tối đa hóa việc dùng Cache Storage API hoặc lưu file `.mp3`, `.wav` cục bộ để nghe lại với Zero-Latency. Cấm tải/gọi lại API bên ngoài (TTS) nếu đã có file local.

## Quy Trình Vận Hành (Development Workflow)

1. Tích hợp Spec-Driven Development cho mọi tính năng mới (Specify -> Plan -> Tasks -> Implement).
2. Khi can thiệp sửa chữa hệ thống lõi hoặc UI, BẮT BUỘC dùng lệnh `view_file` quét code hiện tại, định vị hàm cần sửa bằng grep trước khi chèn code bằng `replace_file_content`. Cấm xóa/chèn bừa bãi.
3. Liên tục ghi nhớ thói quen của dự án, tự động hóa quy trình lặp và đóng gói script vào kho vũ khí.

## Governance

Bản Hiến pháp này là luật định tối cao (The Omnipotent Mandate), kết hợp với tệp `AGENTS.md`. Tất cả các AI Agent, Subagent tham gia dự án buộc phải tuân thủ vô điều kiện.

**Version**: 1.0.0 | **Ratified**: 2026-07-05 | **Last Amended**: 2026-07-05
