# Auto-Fix Control Center

Thư mục riêng để quản lý chức năng **Autonomous AI Auto-Fix Platform** cho AI Video Studio.

## Trạng thái hiện tại

- Milestone hiện tại: **M1 - Git + CI (BLOCKED)**
- CI definition: **đã thêm, chưa có run/protection evidence**
- Canonical Electron source: **đã đăng ký** — `origin/nova-logic` tại baseline `d936dc4054bfc1e38d0e01e345010d02b8f4ebf0`
- Chế độ: **observe-only**
- Tác động vào app: **không có**
- AI read/write/command/build authority: **tắt**
- Signing/release/rollout/rollback authority: **tắt**
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
- `config/policy.json`: policy dạng JSON deny-by-default; hiện chưa được runtime kết nối.
- `config/canonical-source.json`: identity, canonical branch, immutable baseline, required tracked paths và approval evidence.
- `AUTO_FIX_MASTER_SPECIFICATION.md`: hợp đồng triển khai canonical cho Auto-Fix, hiện chỉ ở trạng thái draft/observe-only.
- `policy.js`: policy loader, validator và deny-by-default authorization guard độc lập với Electron runtime.
- `scripts/policy-check.js`: CLI kiểm tra policy trước mỗi milestone/CI job.
- `test/policy.test.js`: test foundation cho policy và authority deny-by-default.
- `repository-adapter.js`: đọc path, branch, commit SHA, dirty state và source status; không thay đổi repository.
- `path-boundary.js`: kiểm tra allowlist, denied roots, sensitive names và symlink boundary.
- `redaction.js`: redaction bounded cho secret values, credential fields và local paths.
- `audit.js`: tạo audit record bounded/hash và append-only writer.
- `gates.js`: evaluator trả về `PASS`, `FAIL` hoặc `BLOCKED` cùng evidence.
- `tool-registry.js`: registry giới hạn tool read-only; không có arbitrary shell/delete/network tool.
- `scripts/readiness.js`: xuất readiness report JSON cho CI/điều hành.
- `test/control-plane.test.js`: test boundary, redaction, audit, repository detection, gates và registry.
- `package.json`: các lệnh kiểm tra độc lập của control plane.
- `CANONICAL-SOURCE-ACCEPTANCE.md`: checklist bắt buộc trước khi xác nhận source canonical/M1.
- `M1-READINESS-REPORT.md`: báo cáo readiness hiện tại và các blocker đã biết.
- `artifact-provenance.js`: tạo machine-readable artifact hashes/build metadata bounded; không ký hoặc publish.
- `SECURITY-REVIEW.md`: phạm vi và evidence register cho security review bắt buộc.
- `RELEASE-GOVERNANCE.md`: kiểm soát signing/release/rollout/rollback, không cấp authority.
- `.github/workflows/`: clean validation, unsigned Windows packaging và post-merge artifact attestation.
- `.github/BRANCH-PROTECTION.md`: runbook cấu hình ruleset; file này không tự bảo vệ branch.

Chạy toàn bộ kiểm tra:

```powershell
npm --prefix auto-fix test
npm --prefix auto-fix run check:policy
npm --prefix auto-fix run check:readiness
```

`check:readiness` kết thúc với mã `2` khi trạng thái là `BLOCKED`/`FAIL`; đó là hành vi fail-closed. Canonical-source gate có thể `PASS` riêng trong khi toàn bộ M1 vẫn `BLOCKED` hoặc `FAIL` do worktree, CI, security và governance gates.

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

## Giới hạn hiện tại

Canonical source đã được xác nhận bằng manifest và Git evidence; `resources/app` packaged payload vẫn không phải canonical source. CI workflow và governance runbook đã được thêm nhưng chưa có workflow-run/retention/required-check evidence; branch protection, approved source provenance, signing infrastructure và security review vẫn chưa hoàn tất. Việc xác nhận identity hoặc thêm CI definition không tự cấp bất kỳ authority nào.
