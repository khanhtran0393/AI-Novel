# Hướng dẫn phát hành thương mại — AI Novel

Sản phẩm chỉ có ba trạng thái: **Free · Trial · Pro**. Gói tháng, năm và trọn đời đều là Pro; chỉ khác hạn sử dụng.

## 1. Seller setup

```powershell
cd "D:\My app\AI Novel"
npm run commercial:secrets
```

Private key Ed25519 và seller secrets được tạo ngoài repo tại `%LOCALAPPDATA%\AI Novel Seller`. Public key được chép vào `resources/license/public-keys/` để app khách verify offline. Sao lưu seller directory vào password manager/offline media.

## 2. Backend và app khách

Backend seller giữ:

- `AINOVEL_ENTITLEMENT_PRIVATE_KEY` hoặc `_PRIVATE_KEY_FILE`;
- `AINOVEL_ENTITLEMENT_ADMIN_KEY`;
- payment/Telegram webhook secret;
- `SUPABASE_SERVICE_ROLE_KEY` nếu dùng cloud.

App khách chỉ nhận:

```env
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_LICENSE_API_URL=https://ai-novel-flax.vercel.app
AINOVEL_TRIAL_ENABLED=1
AINOVEL_UPDATE_FEED_URL=https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest
AINOVEL_UPDATE_CHECK_ON_LAUNCH=1
AINOVEL_ALLOW_LOCAL_TRIAL=0
```

**Updater:** app packaged tự check (`CHECK_ON_LAUNCH=1`) → **tự tải sẵn** (kể cả cố tải nốt khi thoát nếu chưa xong) → **không cài lúc đóng** → **lần mở app sau** mới cài (không hỏi). Feed: Supabase Storage `desktop-updates/latest`. Flag: `%APPDATA%/…/update-pending.json`. Dev mode không auto-update.

Tạo customer config:

```powershell
npm run commercial:setup-env -- --license-api <HTTPS_LICENSE_API> --update-feed <HTTPS_UPDATE_FEED> --force
```

## 3. Cấp Pro

```powershell
npm run license:issue -- --token --hwid <HWID> --plan pro --expDays 30
npm run license:issue -- --token --hwid <HWID> --plan pro --expDays 365
npm run license:issue -- --plan pro --count 1 --seats 3 --note "team-3"
```

Chuyển/thu hồi seat: `npm run license:transfer`. Bridge Telegram chạy trên seller backend và nhận private key dạng base64; desktop không nhận Telegram bot token hay private signer.

## 4. Kiểm tra và build ký số

```powershell
$env:WIN_CSC_PUBLISHER_NAME = '<EXACT_CERTIFICATE_COMMON_NAME>'
$env:WIN_CSC_CERTIFICATE_SHA1 = '<40_HEX_CERTIFICATE_THUMBPRINT>'
$env:CSC_LINK = 'D:\certs\ainovel.pfx'
$env:CSC_KEY_PASSWORD = '<FROM_SECRET_MANAGER>'

npm run prepare:publish
npm run release:verify
npm run build:desktop
```

Đây là chuỗi tạo/kiểm tra candidate local; production không được chạy `release:publish` bằng tay. Push tag `v<package.version>` để workflow ký, QA bản cài, thử update thật và chờ reviewer `production` trước khi publish.

Không phát hành `pack:unsigned:qa`; đó chỉ là artifact QA nội bộ. Bản bán phải ký Authenticode và updater phải dùng cùng publisher.

Trong GitHub, tách `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD` vào environment `signing`, đặt publisher/thumbprint ở repository variables, và giữ `AINOVEL_ENTITLEMENT_ADMIN_KEY` + `SUPABASE_SERVICE_ROLE_KEY` trong environment `production` có required reviewer. Workflow phải kiểm tra Free, Trial/tamper, tạo + kích hoạt Pro QA có row Supabase, xác minh heartbeat cloud và Pro gate trên candidate đã cài, xóa đúng các row QA trong `always()`, rồi chạy update thật qua feed HTTPS tạm trước khi publish.

## 5. Máy trắng bắt buộc

Trên Windows sạch:

1. Cài installer và xác nhận publisher đúng.
2. Free không mở route Pro.
3. Trial được cấp từ license API, hết hạn đúng và không dùng lại cùng HWID.
4. Pro gắn đúng HWID; sai HWID/tamper token bị từ chối.
5. API key/cookie/session vẫn hoạt động sau restart nhưng không xuất hiện trong localStorage, project export hay backup plaintext.
6. Update tải qua HTTPS, xác minh chữ ký rồi mới cài.
7. Cài CapCut Desktop và CPython x64 + `cryptography==48.0.0`, rồi chạy `npm run smoke:capcut-live`; log phải có MP3 thật, số byte và SHA-256.
8. Uninstall/reinstall, crash recovery, Flow/TTS và support link hoạt động.

## 6. Cổng cấm phát hành

Không mở bán nếu:

- `release:verify` fail;
- còn `BLOCKED` trong `THIRD_PARTY_MANIFEST.md`;
- thiếu chứng thư ký số, update feed hoặc license API thật;
- seller secrets lọt vào customer package;
- chưa có chính sách refund/support/privacy và chưa kiểm tra trên máy trắng.
