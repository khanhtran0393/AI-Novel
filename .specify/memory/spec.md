# Feature Specification: UI Features from Constitution (AGENTS.md)

**Feature Branch**: `feature-agents-ui-compliance`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "đọc agent. áp tính năng vào specify, thực thi các tính năng đó. sửa code cho phù hợp."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nút Mở Thư Mục Lưu Trữ (Priority: P1)

Là một người dùng, tôi muốn có nút "Mở thư mục lưu" trên thanh Header để nhanh chóng mở thư mục chứa các file đầu ra (ảnh, âm thanh, video) trên máy tính của tôi.

**Why this priority**: Cần thiết để người dùng dễ dàng truy cập file xuất ra cục bộ mà không phải tìm kiếm thủ công, giúp tối ưu trải nghiệm sử dụng phần mềm.

**Independent Test**: Can be fully tested by clicking the "Mở thư mục lưu" button and verifying that the Windows File Explorer opens the project directory.

**Acceptance Scenarios**:

1. **Given** đang mở AI Novel, **When** bấm vào nút "Mở thư mục lưu" trên Header, **Then** hệ thống gọi lệnh `explorer.exe` mở thư mục hiện tại.
2. **Given** hệ thống gặp lỗi khi mở thư mục, **When** bấm nút, **Then** hệ thống hiện thông báo lỗi hoặc Fallback mở URL Google Drive (nếu có cấu hình).

---

### User Story 2 - Thanh Điều Hướng Siêu Tốc & Sticky Navigation (Priority: P1)

Là một người dùng, tôi muốn có một Thanh Điều Hướng Siêu Tốc ghim cố định ở đỉnh Content Panel để chuyển cảnh nhanh và xem tiến độ sinh ảnh.

**Why this priority**: Kịch bản có thể rất dài, cần công cụ di chuyển mượt mà giữa các Scene (phân cảnh).

**Independent Test**: Can be fully tested by scrolling down a long chapter and clicking the Sticky Navigation buttons to jump to specific scenes.

**Acceptance Scenarios**:

1. **Given** chương có nhiều phân cảnh (scenes), **When** người dùng cuộn xuống, **Then** Thanh Điều Hướng vẫn được ghim ở đỉnh (sticky top-0).
2. **Given** Thanh Điều Hướng hiển thị, **When** bấm vào nút "Cảnh 3 (3/5)", **Then** trang tự động cuộn (scrollIntoView) tới phân cảnh đó.

---

### User Story 3 - Thanh Máu (Word-Gate Progress Bar) (Priority: P2)

Là một tác giả, tôi muốn có một Thanh Máu (dải đèn Neon) trực quan hiển thị số từ hiện tại so với chỉ tiêu số từ (ví dụ 4250 từ) để theo dõi độ dài của kịch bản.

**Why this priority**: Đảm bảo AI tạo ra đủ độ dài yêu cầu, ngăn chặn AI "làm biếng" nhảy cóc thời gian.

**Independent Test**: Can be fully tested by generating text and observing the progress bar update its percentage and change color when the goal is reached.

**Acceptance Scenarios**:

1. **Given** văn bản đang được sinh ra, **When** số từ tăng lên, **Then** Thanh Máu cập nhật tỷ lệ % và chiều dài thanh tiến độ.
2. **Given** văn bản đạt trên mức chỉ tiêu, **When** kiểm tra thanh tiến độ, **Then** thanh chuyển sang màu xanh lá (hoặc màu đầy đủ neon).

---

### User Story 4 - Nút Đỏ Cảnh Báo "Viết Lại Kịch Bản" (Priority: P3)

Là một người dùng, tôi muốn nút "Viết lại kịch bản từ đầu" ở Sidebar có màu đỏ/cảnh báo rõ ràng và đẩy tham số `overwrite=true` để tránh vô tình bấm nhầm xóa sạch kịch bản.

**Why this priority**: Bảo vệ dữ liệu người dùng khỏi thao tác sai.

**Independent Test**: Can be fully tested by observing the button's style and checking if it prompts a strict warning before triggering the overwrite logic.

**Acceptance Scenarios**:

1. **Given** thanh Sidebar hiển thị, **When** nhìn vào nút "Viết lại kịch bản", **Then** nút có thiết kế cảnh báo đỏ.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Header `Header.tsx` MUST include a "Mở thư mục lưu" button that uses an IPC/API call to open the local folder (e.g. `/api/open-folder`).
- **FR-002**: System MUST have an API route (e.g. `app/api/open-folder/route.ts`) executing `child_process.exec('explorer.exe .')` on Windows.
- **FR-003**: Content Panel (`ContentTab.tsx` or `page.tsx`) MUST feature a Sticky Navigation bar displaying scenes and jump-to functionality.
- **FR-004**: Content Panel MUST display a Word-Gate Progress Bar (Thanh Máu) that tracks the word count of the current chapter against a fixed target (e.g. 4000 or 4250 words).
- **FR-005**: Sidebar `Sidebar.tsx` MUST style the "Viết lại kịch bản từ đầu" button with warning/red colors to signify destructive `overwrite=true` action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can click "Mở thư mục lưu" and see the local folder open within 2 seconds.
- **SC-002**: Users can click Sticky Navigation buttons to jump to scenes smoothly.
- **SC-003**: Word count progress bar updates dynamically as `streamText` or `currentChapter.noi_dung` grows.
- **SC-004**: "Viết lại kịch bản" visually warns the user of data destruction.

## Assumptions

- Users are running the Next.js app locally on Windows (since the spec explicitly calls for `explorer.exe`).
- The Target Word Count (Chỉ tiêu số từ) is roughly 4000 words per chapter.
