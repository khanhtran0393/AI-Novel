# Commercial release runbook — AI Novel

## 1. Tạo khóa seller một lần

```powershell
npm run commercial:secrets
```

Lệnh tạo cặp Ed25519. Private key và `.env.seller` mặc định nằm ngoài repo tại `%LOCALAPPDATA%\AI Novel Seller`; public key được chép vào `resources/license/public-keys/` để đóng gói. Sao lưu thư mục seller offline và không chép nó sang máy khách.

## 2. Cấu hình production

Backend seller cần private key, admin key, payment/webhook secret và Telegram/Supabase secret. App khách chỉ cần:

```env
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_LICENSE_API_URL=https://ai-novel-flax.vercel.app
AINOVEL_UPDATE_FEED_URL=https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest
AINOVEL_UPDATE_CHECK_ON_LAUNCH=1
AINOVEL_ALLOW_LOCAL_TRIAL=0
```

Tạo file customer bằng `npm run commercial:setup-env -- --license-api <HTTPS> --update-feed <HTTPS> --force`.

## 3. Cấp Pro

```powershell
npm run license:issue -- --token --hwid <BUYER_HWID> --plan pro --expDays 365
```

Tháng, năm và trọn đời đều phát hành claims `plan: pro`; chỉ khác ngày hết hạn.

## 4. Ký và đóng gói

```powershell
$env:WIN_CSC_PUBLISHER_NAME = 'Exact certificate Common Name'
$env:WIN_CSC_CERTIFICATE_SHA1 = '<40_HEX_CERTIFICATE_THUMBPRINT>'
$env:CSC_LINK = 'D:\certs\ainovel.pfx'
$env:CSC_KEY_PASSWORD = '<from secret manager>'
npm run build:desktop
npm run audit:package -- dist/win-unpacked
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installed-desktop.ps1 -InstallerPath dist\AI-Novel-1.0.0-x64.exe
```

`release:publish` không phải đường phát hành production tại máy local. Sau khi kiểm tra local, push tag `v<package.version>`; chỉ workflow được bảo vệ mới được cấp service-role và publish.

Không phát hành unsigned. `release:publish` kiểm tra SHA-512, kích thước, Authenticode, publisher, certificate thumbprint và timestamp. Artifact theo version là bất biến: bản đã tồn tại chỉ được tái sử dụng khi byte/hash giống hệt, không được ghi đè. Script tải lại artifact public để kiểm tra kích thước/hash trước khi upload `latest.yml` sau cùng.

Feed Supabase đã provision. Kiểm tra bằng `npm run release:feed:verify`. Chỉ chạy `npm run release:feed:provision` khi chủ động tạo lại bucket.

Workflow `.github/workflows/release-desktop.yml` chỉ chạy khi push tag `v<package.version>` và chia làm hai cổng. Environment `signing` giữ secrets `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`; repository variables giữ `WIN_CSC_PUBLISHER_NAME`, `WIN_CSC_CERTIFICATE_SHA1`. Job đầu build, audit package, xác minh manifest/chữ ký và kiểm tra Free trên app đã đóng gói nhưng không tạo dữ liệu cloud. Reviewer `production` duyệt các kiểm tra người dùng/tài khoản; sau phê duyệt, workflow chạy Trial/tamper thật, tạo một license Pro QA có row Supabase từ license API, gọi activation + verify + heartbeat cloud + Pro gate trên chính app đã cài, rồi xóa chính xác row Trial và Pro QA trong bước `always()`. Sau đó workflow dựng feed HTTPS tạm, bắt updater tải–xác minh–cài–mở candidate và xóa feed tạm thành công rồi mới publish. Environment `production` giữ `AINOVEL_ENTITLEMENT_ADMIN_KEY` và `SUPABASE_SERVICE_ROLE_KEY`; không đặt các secret này ở environment `signing`.

## 5. Không phát hành nếu

- `release:verify` chưa pass;
- license/update URL chưa phải HTTPS thật;
- private/admin/payment/service-role xuất hiện trong app khách;
- còn `BLOCKED` trong `THIRD_PARTY_MANIFEST.md`;
- chưa smoke trên máy Windows trắng cho Free, Trial, Pro, update và uninstall.

## 6. Go-live một trang

Xem **[`COMMERCIAL_GO_LIVE.md`](./COMMERCIAL_GO_LIVE.md)** — checklist cert + tag + máy trắng.

```powershell
npm run commercial:go-live-status
npm run commercial:complete
```

## 7. Hoàn thiện local (không cert) — đã có script

```powershell
# Cổng phần mềm (không cần Authenticode)
npm run commercial:complete
# hoặc từng bước:
npm run prepare:publish
npm run release:feed:verify
npm run pack:unsigned:qa
npm run smoke:unpacked-desktop
npm run audit:package -- dist-qa-unsigned/win-unpacked
```

**Sự thật empirically (2026-07-19):**
- `prepare:publish` PASS
- Feed HTTPS + marker PASS
- Unsigned QA pack + Free gate 403 PASS
- Issue Ed25519 → activate Pro trên app đóng gói PASS
- `release:verify --strict` **FAIL** chỉ vì thiếu `CSC_LINK` / `WIN_CSC_PUBLISHER_NAME` / `WIN_CSC_CERTIFICATE_SHA1`

**Bước còn lại để ship khách thật:** cấu hình cert → `npm run build:desktop` hoặc push tag `v1.0.0` (workflow `release-desktop.yml`).
