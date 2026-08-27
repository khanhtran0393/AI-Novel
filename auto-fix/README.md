# Auto-Fix Control Center

Thư mục riêng để quản lý chức năng **Autonomous AI Auto-Fix Platform** cho AI Video Studio.

## Trạng thái hiện tại

- Milestone hiện tại: **M0 - Discovery / Architecture**
- Chế độ: **observe-only**
- Tác động vào app: **không có**
- AI write authority: **tắt**
- Release authority: **tắt**
- Auto-update/rollback runtime mới: **chưa kết nối**

Đây là lớp quản lý độc lập. Ở trạng thái hiện tại, app không tự đọc hoặc thực thi các file trong thư mục này.

## Quy tắc an toàn

1. Không sửa `main.js`, `main.plain.js`, `preload.js` hoặc module đang chạy chỉ để bật Auto-Fix.
2. Không cho AI quyền shell tùy ý, quyền xóa file, quyền truy cập secret hoặc code-signing key.
3. Mọi thay đổi tương lai phải đi theo từng milestone, có test, kiểm tra bảo mật, tài liệu và báo cáo PASS/FAIL.
4. AI chỉ làm việc trong workspace/branch cô lập; không sửa production branch trực tiếp.
5. Không gửi password, token, cookie, private key, tài liệu cá nhân hoặc filesystem tùy ý lên server/AI.
6. Không tự release khi reproduction, regression, build, security và risk gate chưa đạt.

## Nội dung thư mục

- `CONTROL.md`: bảng điều khiển policy và các quyền đang khóa.
- `MILESTONE-0-DISCOVERY.md`: kết quả khảo sát repository/app thực tế.
- `ROADMAP.md`: lộ trình triển khai tuần tự theo specification.
- `config/policy.json`: policy dạng JSON để dùng làm nguồn cấu hình sau này; hiện chưa được runtime kết nối.
- `AUTO_FIX_MASTER_SPECIFICATION.md`: hợp đồng triển khai canonical cho Auto-Fix, hiện chỉ ở trạng thái draft/observe-only.
- `policy.js`: policy loader, validator và deny-by-default authorization guard độc lập với Electron runtime.
- `scripts/policy-check.js`: CLI kiểm tra policy trước mỗi milestone/CI job.
- `test/policy.test.js`: test foundation cho policy và authority deny-by-default.

## Kiểm tra foundation

Chạy từ `D:\AI Video Studio`:

```powershell
node auto-fix/scripts/policy-check.js
node auto-fix/test/policy.test.js
```

Các lệnh trên chỉ đọc policy và kiểm tra control plane. Chúng không bật runtime, không sửa source, không chạy shell/native process và không kết nối vào app packaged.

## Cách sử dụng khi phát triển

1. Đọc `CONTROL.md` trước khi thực hiện bất kỳ milestone nào.
2. Chỉ làm đúng milestone được giao; không triển khai toàn bộ hệ thống cùng lúc.
3. Sau mỗi milestone cập nhật discovery/roadmap/policy nếu cần.
4. Chạy các test hiện có của app và test mới của Auto-Fix.
5. Ghi rõ file thay đổi, kết quả test/build/security và limitation.
6. Chỉ chuyển milestone khi trạng thái là PASS hoặc có quyết định BLOCKED rõ ràng.

## Giới hạn phát hiện được

Thư mục gốc hiện là bản Windows đã đóng gói, không có `.git` và không chứa source repository đầy đủ. Source JavaScript nằm trong `resources/app`; vì vậy M0 chỉ lập kế hoạch và không thay đổi production behavior. Cần source repository có Git để triển khai CI, branch/worktree và các milestone viết code một cách kiểm soát.
