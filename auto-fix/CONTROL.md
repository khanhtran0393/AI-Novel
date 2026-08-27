# Auto-Fix Control Policy

Tài liệu này là điểm kiểm soát trung tâm cho chức năng Auto-Fix. Mọi quyền tự động phải được mở theo nguyên tắc **deny by default**.

## Current control state

| Control | State | Ghi chú |
|---|---|---|
| Auto-Fix runtime | OFF | Chưa có integration runtime |
| Telemetry upload | OFF | Chưa có server Crash Collector |
| AI diagnosis | OFF | Chưa có Agent Orchestrator |
| AI file write | OFF | Không cho sửa source/production |
| AI command execution | OFF | Không có arbitrary shell |
| AI commit | OFF | Chưa có Git workspace hợp lệ |
| Build authority | OFF | Chưa có execution plane riêng |
| Signing authority | OFF | Signing key không được đưa cho AI |
| Release authority | OFF | Bắt buộc human/policy gate sau này |
| Auto-update authority | EXISTING APP ONLY | App hiện có `electron-updater`; chưa đạt spec |
| Rollback authority | OFF | Chưa có health verification/rollback flow |

## Required gates before enabling any authority

### Data gate

- Sanitize và minimize crash report trước khi lưu/gửi.
- Redact password, access token, API key, cookie, private key và local path nhạy cảm.
- Có retention, deletion, access control và audit policy.

### Workspace gate

- Repository source đầy đủ và có Git.
- Protected `main`/release branch.
- Branch/worktree riêng dạng `ai-fix/<bug-id>`.
- Path boundary chỉ cho phép approved workspace; cấm OS/system directory và secret store.

### Agent gate

- Chỉ gọi controlled tools có schema/authorization.
- Không expose arbitrary shell, delete command hoặc network tùy ý.
- Có timeout, CPU/memory/disk/token budget và iteration limit.
- Mọi tool call, argument, result và file change phải audit.

### Fix gate

- Reproduction phải PASS nếu khả thi.
- Có root-cause evidence và confidence có cấu trúc.
- Patch nhỏ, localized, không cleanup ngoài phạm vi.
- Targeted test, reproduction test, regression suite, integration và build đều PASS.
- Security scan và risk policy PASS.

### Release gate

- Artifact hash và signature được xác minh bằng controlled signing environment.
- Clean-machine, smoke, update và health check PASS.
- Canary theo staged rollout; so sánh với stable baseline.
- Có kill switch, feature flag và rollback trước khi mở rộng rollout.
- HIGH risk (auth, encryption, signing, updater, licensing, security) phải human approval.

## Escalation conditions

Luôn chuyển sang human review khi:

- reproduction thất bại lặp lại hoặc evidence không đủ;
- confidence thấp, test không kết luận được hoặc hết repair iterations;
- patch chạm subsystem nhạy cảm/rủi ro cao;
- CI/build/signing/release/update/rollback thất bại;
- telemetry production vượt threshold;
- policy không rõ hoặc có dấu hiệu prompt/tool abuse.

## Authority transition

Không sửa các giá trị này để bật production một cách thủ công. Việc mở quyền phải đi qua một milestone đã PASS, review policy và audit record tương ứng. `config/policy.json` hiện được control-plane foundation đọc/validate độc lập, nhưng chưa được kết nối vào runtime Electron và không cấp bất kỳ authority nào.

## Control-plane implementation

Các module an toàn hiện có trong `auto-fix/` chỉ quan sát và đánh giá:

- `repository-adapter.js`: Git metadata read-only;
- `path-boundary.js`: allowlist/denylist và symlink boundary;
- `redaction.js`: loại bỏ secret/local path khỏi evidence;
- `audit.js`: audit record bounded, append-only;
- `gates.js`: `PASS`/`FAIL`/`BLOCKED`;
- `tool-registry.js`: closed registry, không có shell/delete/network passthrough;
- `scripts/readiness.js`: JSON readiness report.

Mọi gate thiếu evidence đều trả `BLOCKED`; worktree dirty hoặc policy sai trả `FAIL`. Không được xem report `PASS` của policy là bằng chứng canonical source, CI hoặc build readiness.
