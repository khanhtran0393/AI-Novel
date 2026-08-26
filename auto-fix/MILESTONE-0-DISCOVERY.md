# Milestone 0 - Discovery / Architecture

**Status: PASS (discovery only)**

> M0 chỉ khảo sát và lập kế hoạch. Không có production behavior nào được thay đổi.

## 1. Repository snapshot

- Workspace: `D:\AI Video Studio`
- Git metadata: không tìm thấy thư mục `.git`.
- Đây là Windows packaged output, không phải source repository đầy đủ.
- Các artifact đã thấy: `AI Video Studio.exe`, `build-output\AI-Video-Studio-0.1.34-*.exe`.
- App payload đang có tại `D:\AI Video Studio\resources\app`.

## 2. Technology and build system

- Desktop framework: Electron.
- Electron version: `33.4.11`.
- Node.js kiểm tra tại workspace: `v24.15.0`.
- npm kiểm tra tại workspace: `11.12.1`.
- Module style: CommonJS (`require`).
- Runtime package: `resources\app\package.json`, app version `0.1.34`.
- Build package: `build-project\package.json`.
- Packager: `electron-builder 26.15.3`.
- Build targets: Windows x64 `portable` và `nsis`.
- Packaging: `asar: true`; native binaries được unpack riêng.

## 3. Existing tests and checks

Các lệnh hiện có trong `resources\app\package.json`:

- `npm run check:syntax` -> **PASS**, 97 JavaScript files.
- `npm run check:ipc` -> **PASS**, inventory 86 IPC channels và 15 progress events.
- `npm run check:parity` -> **PASS**, 7 protected/plain pairs.
- `npm run test:foundation` -> **PASS**, foundation tests.

Chưa phát hiện unit/integration framework riêng như Jest, Vitest, Playwright hoặc pytest trong package app. Test hiện tại là Node scripts dùng `assert` và static checks.

## 4. Current error handling

Entry point cần ưu tiên về sau:

- `D:\AI Video Studio\resources\app\main.plain.js`
- `D:\AI Video Studio\resources\app\main.js` (protected/obfuscated pair)
- `D:\AI Video Studio\resources\app\preload.js`

Hiện tại `main.plain.js`:

- đăng ký `process.on('uncaughtException')` và `process.on('unhandledRejection')`;
- hiển thị friendly dialog cho một số lỗi file (`ENOSPC`, `EACCES`, `EPERM`, `EROFS`);
- ghi lỗi còn lại ra `console.error`;
- chưa có CrashReport schema, fingerprint/deduplication, bounded event ring buffer, sanitizer, local offline queue hoặc HTTPS crash upload.

## 5. Current updater and packaging integration

- `electron-updater` đã là dependency.
- `main.plain.js` đang gọi `autoUpdater.checkForUpdates()`, hỗ trợ download/install IPC.
- `preload.js` expose `appVersion`, update status, download và install.
- `resources\app\app-update.yml` hiện diện.
- `build-project\electron-builder.yml` có NSIS/portable output.
- Cảnh báo quan trọng: `win.verifyUpdateCodeSignature` hiện là `false`.
- Chưa thấy flow đầy đủ cho hash/signature verification, separate updater process, post-update health check hoặc automatic rollback theo specification.

## 6. Integration points proposed

### Client plane

1. Error reporter trong main process, đặt sau khi có source repository đầy đủ; không nuốt lỗi hiện hữu.
2. Event recorder dạng bounded ring buffer ở lớp IPC/use-case, chỉ ghi event metadata tối thiểu.
3. Environment fingerprint dùng OS/build/arch/runtime/dependency/config fingerprint; không đọc arbitrary files.
4. Local queue đặt trong `app.getPath('userData')`, dùng atomic storage và retry/backoff.
5. Health check tách khỏi executable update flow; updater process không tự overwrite executable đang chạy.

### Control plane

Chưa tồn tại trong packaged app. Cần source/backend riêng cho Crash Collector, sanitizer, dedupe, BugCase, queue, agent supervisor, release/update metadata, flags, kill switch và monitoring.

### Execution plane

Cần hạ tầng riêng, không chạy AI sandbox trên máy production/client: isolated worktree, reproduction environment/VM, CI runner, clean-machine test, security scanner và controlled signing service.

## 7. Security-sensitive modules

- `resources\app\flow-chrome.js` và `flow-cft.plain.js`: điều khiển Chrome, token/cookie/session và process spawning.
- `resources\app\storage\settings-store.js`: lưu cấu hình/key trong userData (`nova-settings.json`).
- `resources\app\main.plain.js`: Electron main process, IPC registration, native process integration và updater.
- `resources\app\preload.js`: bridge từ renderer sang IPC; phải giữ allowlist, không expose shell tùy ý.
- `resources\app\native-tools.js`, `voice-native.js`, `watermark-native.js`, `cli-bridge-native.js`: native executable/Python/child-process boundaries.
- `resources\app\mcp-server\`: cần review riêng trước mọi AI/tool integration.
- `build-project\electron-builder.yml`: artifact, installer, unpack rules và signing/update policy.

Các module trên mặc định là **HIGH risk**; AI không được tự sửa/release.

## 8. Unknowns / blockers

1. Thiếu source repository và Git history; chưa thể tạo protected branch/worktree/CI đúng spec.
2. Chưa biết backend/server, database, auth provider và nơi phát hành release thực tế.
3. Chưa có crash API endpoint, retention policy, consent/privacy policy hoặc incident notification.
4. Chưa có test VM/clean machine/golden profiles.
5. Chưa có signing certificate/service và key-isolation design.
6. `main.js`/các protected files có obfuscation; không nên chỉnh trực tiếp.
7. Chưa xác định canonical source build path so với packaged `resources\app`.
8. Chưa có baseline metrics cho crash/startup/update/rollback.

## 9. M0 architecture decision

Không đưa Auto-Fix code vào `resources\app` ở M0. Quản lý chức năng ở thư mục độc lập `D:\AI Video Studio\auto-fix`; các milestone sau chỉ kết nối qua interface rõ ràng sau khi source/Git và security design đã được bổ sung.

## 10. Next implementation prerequisite

Trước M1 cần cung cấp hoặc khôi phục source repository có Git, xác định canonical build command và CI host. M1 chỉ làm Git + CI/test/build artifact; chưa bật crash upload hay AI write/release authority.
