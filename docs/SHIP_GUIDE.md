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

**Updater:** app packaged tự check (`CHECK_ON_LAUNCH=1`) → **tự tải sẵn** (kể cả cố tải nốt khi thoát nếu chưa xong) → **không cài lúc đóng** → **lần mở app sau** cài **im lặng** (`quitAndInstall(true)` → NSIS `/S`, không Setup UI) → sau relaunch chỉ **thông báo changelog**. Feed: Supabase Storage / GitHub Releases. Flag: `%APPDATA%/…/update-pending.json`. Dev mode không auto-update.

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

## 3b. Ghi chú TRƯỚC KHI PACK (LOCKED — chống sót/nhầm)

**Đọc một file đủ:** [`docs/PACK_NOTES.md`](PACK_NOTES.md) — **§2 quy trình 4 bước** + **§3 phiếu tick**  
(chuẩn máy: `resources/commercial/PACKAGING_STANDARD.md` · preflight in banner mỗi lần pack)

### Sole truth license

1. **Sổ cái:** Pro/Trial chỉ khi Supabase `licenses` còn row **`active`** cho **HWID máy đó**.
2. **Xóa id trên Supabase** (hoặc revoke / expired) → app **Free**, dù token Ed25519 crypto còn OK.
3. Token `localStorage.ainovel.entitlementToken` chỉ là **vé** — không self-heal Pro.
4. LICENSE_API (Vercel) **phải** có `SUPABASE_SERVICE_ROLE_KEY`.
5. Package khách: `enforce` + public keys; **cấm** service_role / private / open / owner.
6. Sau pack: Pro → xóa row → online → badge **FREE** + API 403.

### Đừng nhầm lệnh

| Lệnh | Dùng khi |
|------|----------|
| `npm run pack:ship` | NSIS unsigned ship (auto-update) → `dist-qa-unsigned/` · sau pack: `release:ship-update` |
| `npm run pack:commercial` | Bán signed — **cần** `CSC_*` → `dist/` |
| `npm run preflight:pack` | Chỉ in ghi chú + gate (không build) |

**Cấm:** coi `dev`/`MODE=open` = gói khách; chạy `electron-builder` tay bỏ preflight/crown/brand.

### Defense defaults (đã siết)

Offline **24h** · first-run **6h** · strict IP **3h** · seat **10m** · ASAR integrity **ON** (fuse sau rcedit).

### Free/Trial machine store (chống xóa portable)

Free quota + local trial vault **ngoài** folder app (`%APPDATA%\Ai Novel\.ainovel-license\` + HKCU). Xóa portable + giải nén lại **không** reset lượt Free / trial (cùng HWID). Chi tiết: `PACK_NOTES.md` **§7**. Packaged: **cấm** `ALLOW_LOCAL_TRIAL`; trial cloud = Supabase HWID.

### Lệnh

```powershell
npm run preflight:pack          # đọc banner PACK NOTES
npm run pack:ship               # build + audit + smokes + checklist
npm run postpack:checklist -- dist-qa-unsigned
```

## 4. Kiểm tra và build ký số

### Brand splash (LOCKED — mọi pack)

Trước builder **bắt buộc**:

```powershell
npm run brand:icons
npm run brand:sync
npm run smoke:brand-splash
```

Yêu cầu ship:

- Splash = **logo nổi trên cửa sổ trong suốt** (không nền đen, không spinner thay logo).
- Tối thiểu **5 giây** rồi mới vào workspace (`AINOVEL_SPLASH_MS`).
- File: `electron/splash-logo.jpg`, `electron/splashBrand.js`, `build/icon.ico`.
- Spec: `docs/BRAND_SPLASH.md` · chuẩn pack: `resources/commercial/PACKAGING_STANDARD.md` §1–2.

`pack:unsigned:qa` / `pack:commercial` đã gọi `brand:icons` + `brand:sync`.  
`beforePack` hard-fail nếu thiếu logo / không wire `transparent` splash.

### Build ký số

```powershell
$env:WIN_CSC_PUBLISHER_NAME = '<EXACT_CERTIFICATE_COMMON_NAME>'
$env:WIN_CSC_CERTIFICATE_SHA1 = '<40_HEX_CERTIFICATE_THUMBPRINT>'
$env:CSC_LINK = 'D:\certs\ainovel.pfx'
$env:CSC_KEY_PASSWORD = '<FROM_SECRET_MANAGER>'

npm run prepare:publish
npm run release:verify
npm run brand:icons
npm run brand:sync
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
