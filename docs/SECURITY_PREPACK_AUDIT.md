# KIỂM TOÁN BẢO MẬT TRƯỚC KHI PACK

**Ngày kiểm tra:** 2026-07-27  
**Phiên bản:** 1.0.14  
**Phạm vi:** Electron shell, local Next runtime, Flow bridge, updater, commercial/license, Crown IP, XinChao-Cut và artifact `dist-qa-unsigned`.

Kế hoạch triển khai theo ticket, file và acceptance test: [`SECURITY_HARDENING_IMPLEMENTATION_PLAN.md`](SECURITY_HARDENING_IMPLEMENTATION_PLAN.md).

## 1. Kết luận phát hành

**Trạng thái: `SECURITY_BLOCKED` — chưa phát hành artifact hiện tại cho khách.**

App đã có các lớp hardening nền tốt: Electron sandbox, context isolation, chặn DevTools/CLI inspect, DPAPI credential vault, ASAR integrity, `OnlyLoadAppFromAsar`, Ed25519 entitlement và packaged mode `enforce`. Tuy nhiên, các lớp này chỉ tăng chi phí can thiệp; chúng không tạo ra khả năng “không thể dịch ngược”.

Artifact hiện tại còn bốn nhóm chặn phát hành:

1. Flow bridge chưa xác thực đầy đủ, có thể làm lộ Flow bearer, proxy request và ghi file.
2. Updater cho phép cài installer không ký; artifact hiện tại có trạng thái `NotSigned`.
3. Cloud trial/Crown IP cho phép token replay do chưa bắt buộc ledger, revoke, HWID proof-of-possession.
4. Artifact vẫn phân phối `main.js`, source XinChao-Cut/Python và khóa/loader giải Crown seal.

Không được publish `dist-qa-unsigned`, update feed hoặc gọi bản này là bản thương mại trước khi đóng hết P0.

## 2. Bằng chứng thực nghiệm

| Gate | Kết quả | Ý nghĩa đúng |
|---|---|---|
| `npm run preflight:pack` | PASS | Cấu hình pack cơ bản hợp lệ; không chứng minh artifact an toàn |
| `node scripts/smoke-electron-security.cjs` | PASS | Các cờ Electron hardening trong source tồn tại |
| `npm run smoke:anti-tamper` | PASS | Baseline anti-tamper hiện tại hoạt động |
| `npm run smoke:re-harden` | PASS | Chu trình harden/restore không làm hỏng source |
| `npm run smoke:crown-ip` | PASS | Seal/load đúng giao thức hiện tại; không chứng minh bí mật nằm ngoài client |
| `npm audit --omit=dev --audit-level=high` | FAIL | 3 lỗ hổng production mức high: `brace-expansion`, `next`, `sharp` |
| `npm audit --audit-level=high` | FAIL | 6 high + 1 moderate trong toàn dependency tree |
| `npm run audit:package -- dist-qa-unsigned/win-unpacked` | PASS có điều kiện | Audit hiện tại chưa quét đầy đủ `extraResources`, source leak và chữ ký |
| `npm run smoke:unpacked-desktop` | FAIL | Script vẫn tìm tên executable cũ `AI Novel & Script Generator.exe`; artifact thật là `Ai Novel.exe`, nên chưa có boot proof từ gate chuẩn |
| Electron fuses trên artifact | PASS | RunAsNode/NODE_OPTIONS/CLI inspect tắt; ASAR integrity và OnlyLoadAppFromAsar bật |
| Authenticode | FAIL | `Ai Novel.exe`, installer và `XinChao-Cut.exe` đều `NotSigned` |
| Bề mặt source | FAIL | Entrypoint `main.js` tồn tại nhưng đọc được; `main.jsc` không có; hàng trăm file `.ts/.tsx/.py` nằm ngoài ASAR |

`audit:package` PASS không được dùng để ghi đè các FAIL ở dependency, chữ ký, source exposure hoặc flow/license.

## 3. Mô hình đe dọa

| Đối tượng | Mục tiêu | Biện pháp ưu tiên |
|---|---|---|
| Website/extension độc hại | Chiếm local Flow bridge, lấy bearer, tiêu credit | Mutual authentication, origin pin, request allowlist |
| Malware chạy cùng user | Đọc token/API key, thay runtime phụ, gọi local API | Opaque credential handles, signed manifest, per-launch session |
| Kẻ chiếm update feed | Phân phối installer độc hại | Authenticode + timestamp, signed manifest độc lập |
| Analyst có kỹ năng | Trích source/thuật toán/token flow | Giảm artifact, cloud authority, native signed module |
| Người chia sẻ license | Replay token trên máy khác | Ledger/revoke online, device key proof-of-possession, lease ngắn |

## 4. P0 — Bắt buộc sửa trước phát hành

### P0.1 Flow bridge phải xác thực fail-closed

**Bằng chứng source**

- WebSocket nhận socket trước khi xác thực và gửi `callbackSecret`: `src/lib/flow-bridge/bridgeServer.ts:2714`.
- Client giả có thể yêu cầu `inject_flow_key`: `bridgeServer.ts:1850`.
- CORS `*`: `bridgeServer.ts:2181`, `bridgeServer.ts:2267`.
- Proxy tài khoản nhận URL/method/header/body tùy ý: `bridgeServer.ts:2376`, `accountProxy.ts:53`.
- `receive-binary` nhận secret rỗng và `x-dest-path`: `bridgeServer.ts:2309`.
- Secret hiện dựa trên `Date.now()`: `bridgeServer.ts:155`.

**Yêu cầu sửa**

1. Sinh secret mỗi lần chạy bằng `crypto.randomBytes(32)`.
2. Xác thực WS trước khi thêm socket vào registry; pin đúng extension ID và kiểm tra `Origin`.
3. Không gửi Flow bearer hoặc callback secret cho socket chưa xác thực.
4. Mọi HTTP endpoint ngoài health phải dùng bearer/HMAC nội bộ và so sánh timing-safe.
5. Bỏ CORS `*`; chỉ cho origin app/extension cụ thể.
6. `proxy-as-account` chỉ cho host/path/method Google Flow đã allowlist.
7. `receive-binary` chỉ ghi dưới output root sau khi resolve/canonicalize; cấm path tùy ý, thêm giới hạn kích thước và rate.

### P0.2 Bản khách và update phải được ký

**Bằng chứng source/artifact**

- `resources/commercial/public.env` đang cho phép unsigned update.
- `electron/updater.js:535` vô hiệu hóa verifier khi `AINOVEL_UPDATE_ALLOW_UNSIGNED=1`.
- Installer, app executable và child executable hiện có trạng thái `NotSigned`.

**Yêu cầu sửa**

1. Bản khách ép `AINOVEL_UPDATE_ALLOW_UNSIGNED=0`.
2. `pack:commercial` bắt buộc `forceCodeSigning=true`, timestamp và kiểm tra đúng publisher.
3. Chạy `Get-AuthenticodeSignature` sau pack; thiếu/khác subject/timestamp phải fail.
4. QA unsigned phải tắt updater và không bao giờ được publish feed.
5. Khi chưa có certificate, dùng manifest update ký Ed25519 bằng khóa phát hành offline và xác minh version/hash/size trước khi spawn installer. Đây chỉ là phương án chuyển tiếp, không thay Authenticode cho bản bán.

### P0.3 Cloud trial/Crown IP phải kiểm tra authority thật

**Bằng chứng source**

- Trial nhận HWID do client tự khai: `src/app/api/cloud/license/trial/route.ts:23`.
- `cloudIpAuth` xác minh token với `requireHwidMatch:false`: `src/lib/commercial/ip/cloudIpAuth.ts:52`.
- Crown routes chưa bắt buộc truy vấn ledger/revoke và proof-of-possession.

**Yêu cầu sửa**

1. Trial cloud yêu cầu người dùng đã xác thực, rate limit và abuse ledger.
2. Crown API phải kiểm tra token hash/ID trong ledger, trạng thái active, expiry và revoke ở mỗi request nhạy cảm.
3. Dùng device keypair lưu bằng DPAPI/TPM; request ký nonce + timestamp + body digest.
4. Access token cloud sống ngắn; refresh/lease bị revoke tập trung.
5. Không coi chuỗi HWID trong body là device attestation.

### P0.4 Dependency production không được còn high

Hiện `npm audit --omit=dev --audit-level=high` fail với `brace-expansion`, `next` và `sharp`.

**Yêu cầu sửa**

1. Nâng Next.js lên bản vá an toàn tương thích và chạy regression Next/Electron.
2. Nâng `sharp`/libvips và xác minh image pipeline bằng media thật.
3. Khóa dependency tree mới, chạy `npm audit`, typecheck, E2E và desktop smoke.
4. Gate phát hành: production high/critical phải bằng 0 hoặc có exception bằng văn bản với owner, thời hạn và biện pháp giảm thiểu.

## 5. P1 — Giảm bề mặt dịch ngược và chiếm runtime

### P1.1 Chỉ ship runtime tối thiểu

Artifact đang chứa plaintext `main.js`, toàn cây `tools/xinchao-cut`, Python source, test/dev file và dữ liệu `.work`.

- Tạo allowlist runtime: executable/native runtime, frontend `dist`, asset và license bắt buộc.
- Không ship `src`, `src-tauri`, tests, docs, `.work`, database, config dev hoặc `.env.*`.
- Python approved modules phải build thành runtime phân phối riêng; xóa `.py` thường khỏi staging.
- Audit artifact phải fail khi thấy `.ts`, `.tsx`, source `.py`, source map, test, docs hoặc secret ngoài allowlist.

Bytenode chỉ là lớp làm khó phân tích. Nếu dùng:

- compile bằng đúng Electron/V8;
- lỗi build phải làm pack fail;
- loader và `.jsc` phải thật sự nằm trong ASAR;
- bản thương mại không fallback plaintext `main.js`;
- desktop boot smoke phải khởi chạy chính artifact vừa build.

Không được ghi “Bytenode khóa 100% dịch ngược”.

### P1.2 Ký và kiểm tra toàn bộ runtime phụ

- Tạo manifest SHA-256 ký số cho mọi file ngoài ASAR.
- Kiểm tra manifest trước khi spawn XinChao/Python/FFmpeg/extension runtime.
- Ký `XinChao-Cut.exe` và mọi executable con; sai hash/chữ ký phải fail-closed.
- Không phân phối khóa bí mật giải seal cùng payload cần bảo vệ.

Crown seal hiện chỉ là obfuscation vì loader và vật liệu dẫn xuất khóa đều nằm phía client. Công thức có giá trị cao nên chuyển sang cloud authority hoặc native module ký số với API hẹp.

### P1.3 Không trả plaintext credential cho renderer

- Thay API “get all credentials” bằng opaque credential handle.
- Main process tự gắn secret khi gọi provider; renderer không đọc plaintext.
- Thu hẹp `ainovelWork.fetch` theo host/path/method/header/body allowlist.
- Mọi IPC nhạy cảm kiểm tra `event.senderFrame === event.sender.mainFrame` và exact origin.

### P1.4 Fuse và process ownership phải fail-closed

- Pin `@electron/fuses` trực tiếp.
- Commercial pack phải fail nếu ASAR integrity hoặc `OnlyLoadAppFromAsar` không bật.
- Không tự fallback tắt fuse khi post-pack lỗi.
- Packaged build ép `AI_NOVEL_ADOPT_SERVER=0`; chỉ nạp server do app tự spawn.
- Dùng port ngẫu nhiên và health challenge nonce/HMAC thay vì tin mọi service trên `127.0.0.1:3000`.

## 6. P2 — Hardening sau khi đóng P0/P1

1. Thêm per-launch HttpOnly/SameSite session cho local Next API; kiểm tra `Origin` và `Sec-Fetch-Site` trên route thay đổi trạng thái.
2. Siết CSP production: bỏ `unsafe-inline` bằng nonce và giới hạn `connect-src`/`img-src` theo provider thật.
3. Pin SPKI production và thiết kế quy trình xoay pin có overlap; hiện pin rỗng chỉ còn WebPKI.
4. Áp dụng navigation/window-open/permission guards cho cửa sổ XinChao.
5. Thay heartbeat plaintext bằng server-signed offline lease, lưu DPAPI dự phòng và phát hiện clock rollback.
6. Thêm SBOM, secret scan trên staging cuối, provenance build và kiểm tra child binary.
7. Giảm fuse `GrantFileProtocolExtraPrivileges` sau khi smoke file/media chứng minh không cần.
8. Ghi security telemetry không chứa secret: update signature fail, manifest mismatch, ledger/revoke reject, Flow auth reject.

## 7. Security stop-gate bắt buộc

Chỉ được gọi artifact là `COMMERCIAL_READY` khi tất cả điều kiện sau cùng PASS:

- [ ] P0.1–P0.4 đã đóng và có regression test.
- [ ] `npm audit --omit=dev --audit-level=high` exit 0.
- [ ] `npm run preflight:pack` exit 0.
- [ ] Electron/anti-tamper/Crown smokes exit 0.
- [ ] Artifact audit quét cả ASAR và `extraResources`, không còn source ngoài allowlist.
- [ ] Package main tồn tại và desktop boot smoke chạy chính executable vừa tạo.
- [ ] Fuses thực tế đúng policy và không có fallback giảm bảo vệ.
- [ ] App, installer và child executables có Authenticode hợp lệ + timestamp.
- [ ] Unsigned updater bị tắt; feed production chỉ nhận artifact đã ký.
- [ ] Flow bridge auth/authorization integration test dùng runtime thật PASS.
- [ ] Cloud license replay/revoke/HWID proof-of-possession tests PASS.
- [ ] Test media thật xác minh TTS/image/video/CapCut không bị hỏng sau hardening.

## 8. Giới hạn tuyên bố

Không có bảo vệ client-side nào bảo đảm “không thể crack/dịch ngược 100%”. Mục tiêu thực tế của AI Novel là:

1. giữ secret và authority quan trọng ngoài client;
2. giảm tối đa source/runtime được phân phối;
3. phát hiện và chặn payload bị sửa trước khi chạy;
4. làm token khó replay và có thể revoke;
5. làm chuỗi update có nguồn gốc xác thực;
6. tăng chi phí phân tích mà không phá tính ổn định của app.

Mọi tài liệu, UI và báo cáo phát hành phải dùng các mức `PASS`, `FAIL`, `BLOCKED`, kèm bằng chứng command/artifact; không dùng “100%”, “hoàn hảo” hoặc “không thể dịch ngược”.
