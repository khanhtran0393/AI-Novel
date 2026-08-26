# Auto-Fix Roadmap

Lộ trình này bám theo Master Specification và được điều chỉnh theo app Electron hiện tại. Chỉ thực hiện **một milestone mỗi lần**.

## M0 - Discovery / Architecture — DONE

- Đã khảo sát Electron, package/build, test, updater, error handling và security boundaries.
- Đã tạo thư mục quản lý riêng.
- Chưa sửa production app.

## M1 - Git + CI — BLOCKED

Điều kiện: source repository đầy đủ và Git remote/CI host.

- protected main/release branch;
- CI lint/static/unit/integration/build;
- artifact generation;
- không cấp AI write/release authority.

## M2 - Client Error Reporter

- global error capture không làm app crash thêm;
- bounded event ring buffer;
- environment fingerprint;
- explicit redaction;
- offline queue, retry/backoff, local dedupe;
- HTTPS upload sau khi có server contract.

## M3 - Crash Server

- authenticated API;
- schema validation, rate limit, abuse protection;
- sanitization server-side;
- database và retention/deletion/access audit;
- fingerprint/deduplication.

## M4 - Bug Intelligence

- CrashReport, EnvironmentProfile, EventSequence, BugCase, RepairAttempt;
- affected version/environment distribution;
- knowledge entry và fix history.

## M5 - Agent Tool Layer

- controlled tools có input/output schema;
- path sandbox, command allowlist, network/resource restrictions;
- authorization, audit log;
- không có arbitrary shell/delete/secrets.

## M6 - AI Debug Agent

- load bug context, history, logs và source qua tools;
- diagnosis/reproduction/patch proposal có confidence;
- write/release authority vẫn disabled lúc đầu;
- escalation khi evidence không đủ.

## M7 - Reproduction Lab

- user-like, clean, golden và compatibility profiles;
- replay event sequence;
- snapshot/restore;
- không clone dữ liệu cá nhân tùy ý.

## M8 - Auto Patch Loop

- branch/worktree `ai-fix/<bug-id>`;
- minimal patch, targeted test, tối đa 5 iterations mặc định;
- reproduction + regression + risk gate;
- không sửa production branch.

## M9 - Regression Engine

- regression/reproduction test cho mỗi bug đã xác nhận;
- lưu vĩnh viễn trong suite;
- chạy historical regression suite.

## M10 - Build / Release

- clean-machine và smoke test;
- artifact hash, SBOM/security scan;
- signing qua service tách biệt;
- release candidate metadata.

## M11 - Updater

- metadata check, secure download;
- hash/signature verification;
- separate updater process;
- health check và rollback.

## M12 - Canary / Monitoring

- staged rollout `5% -> 25% -> 50% -> 100%`;
- crash/error/startup/update/performance metrics;
- threshold stop, feature flag, kill switch, rollback.

## M13 - Autonomous Mode

Chỉ bật sau khi M1-M12 ổn định và có đánh giá production:

- low-risk auto release;
- high-risk human approval;
- autonomous repair/regression/feedback loop;
- cost/token/iteration budget;
- audit và emergency disable.

## Required report for every milestone

```text
MILESTONE:
STATUS: PASS / FAIL / BLOCKED

IMPLEMENTED:
- ...

FILES CHANGED:
- ...

TESTS RUN:
- ...

TEST RESULTS:
- ...

BUILD RESULTS:
- ...

SECURITY NOTES:
- ...

KNOWN LIMITATIONS:
- ...

NEXT MILESTONE:
- ...
```
