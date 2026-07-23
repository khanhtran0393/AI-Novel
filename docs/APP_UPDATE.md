# Auto-update desktop — dùng thật

## Policy app

1. Mở app (packaged) → check feed (~8s)  
2. Có bản mới → **tự tải** (nền)  
3. Đóng app → **không cài** (nếu đang tải dở → cố tải nốt)  
4. **Lần mở sau** → tự cài (không hỏi)

Code: `electron/updater.js` · Env: `resources/commercial/public.env`

## `latest.yml` — một khuôn cố định (LOCKED)

Electron-builder đôi khi ghi yml lệch / thiếu `version`. **Không tin** file builder.

| | |
|--|--|
| Schema | `scripts/lib/latestYml.mjs` — `ainovel.latest.yml.v1` |
| Sinh | `npm run release:manifest` (= `generate-update-manifest --strict`) |
| Bắt buộc | `version: X.Y.Z` · `path`/`files.url` = `AI-Novel-X.Y.Z-x64.exe` · sha512 · size |
| Fail-closed | Thiếu version / ver ≠ tên exe / ver ≠ package.json → **không publish** |
| Pack | `pack:unsigned:qa` **ghi đè** latest.yml sau electron-builder |
| Publish | `release:github` / `release:ship-update` luôn regenerate `--strict` trước upload |

## Nguồn update (mặc định: GitHub Releases)

| | |
|--|--|
| Repo **public** (chỉ binary) | https://github.com/khanhtran0393/AI-Novel-release- |
| Provider | `github` |
| README release | `release-repo/README.md` → push lên repo trên |
| Publish | `npm run release:github` (cần `GH_TOKEN`) |

**Không** upload `.exe` lên Supabase Free (limit 50MB). Source code private repo khác.

App packaged: `AINOVEL_UPDATE_PROVIDER=github` + owner/repo + `CHECK_ON_LAUNCH=1`.

## Bắt buộc một lần: tăng giới hạn file Supabase

Installer ~140MB. Project hiện **chặn TUS 413 Maximum size exceeded** nếu global limit mặc định (thường 50MB).

### Dashboard

1. Mở [Supabase Dashboard](https://supabase.com/dashboard) → project `azlizrbjkqcyqnsmuccv`  
2. **Project Settings** → **Storage**  
3. **Global file size limit** → đặt **500 MB** (hoặc `524288000`) → Save  
4. (Tuỳ chọn) Storage → bucket `desktop-updates` → file size limit ≥ 500MB  

Sau đó:

```powershell
cd "D:\My app\AI Novel"
npm run release:manifest
npm run release:publish:unsigned
```

### Kiểm tra feed

```powershell
npm run release:feed:verify
# Public latest.yml phải 200:
# https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest/latest.yml
```

## Mỗi lần ship feature mới

```powershell
# 1) Bump version trong package.json (1.0.0 → 1.0.1)
# 2) Build
npm run pack:unsigned:qa
#    (có cert: npm run build:desktop + npm run release:publish)

# 3) Publish feed
npm run release:publish:unsigned
#    (có cert: npm run release:publish -- --dir dist)
```

User **không** cài lại tay: mở app → tải → đóng → mở lại → bản mới.

## Unsigned vs ký số

| | |
|--|--|
| Hiện tại | `AINOVEL_UPDATE_ALLOW_UNSIGNED=1` trong `public.env` (chưa có Authenticode) |
| Có cert | Ký build, set `AINOVEL_UPDATE_ALLOW_UNSIGNED=0`, dùng `release:publish` (bắt buộc publisher + thumbprint) |

## Lệnh nhanh

| Lệnh | Việc |
|------|------|
| `npm run release:feed:verify` | Marker feed OK? |
| `npm run release:manifest` | Sinh `latest.yml` từ exe trong `dist-qa-unsigned` |
| `npm run release:publish:unsigned` | Upload exe + yml (cần limit ≥ 500MB) |
| `npm run pack:unsigned:qa` | Build portable QA mới |

## Gate trước khi báo “user tự update được”

```powershell
npm run pack:ship                 # NSIS  (auto-update ổn định; portable = pack:unsigned:portable)
npm run release:ship-update       # latest.yml + GitHub (+ Supabase nếu < limit)
# hoặc tách:
npm run release:github:cred       # publish bằng git credential (không cần GH_TOKEN env)
npm run release:github:verify     # fail-closed: latest.yml + exe public 200
npm run smoke:commercial          # static wiring updater
```

**PASS** `release:github:verify` + installer **đã embed** dual-feed updater (github → Supabase fallback).

### Ship loop (1.0.5+)

1. Bump `package.json` version  
2. `npm run pack:ship` (NSIS unsigned)  
3. `npm run release:ship-update`  
4. User **bản cũ hỏng updater**: cài tay 1 lần từ Releases  
5. User **1.0.5+**: mở app → tự tải → **mở lại** → cài

## Troubleshooting

| Lỗi | Cách xử lý |
|-----|------------|
| TUS / HTTP **413** | Tăng Global file size limit (mục trên) |
| Dev không update | Chỉ bản **packaged** / installer |
| `latest.yml` 200 nhưng không có exe | Chưa upload được installer — sửa 413 rồi publish lại |
| Signature fail / `ERR_UPDATER_INVALID_SIGNATURE` | `AINOVEL_UPDATE_ALLOW_UNSIGNED=1` + code gán `verifyUpdateCodeSignature = async () => null` (không gán `false` — setter bỏ qua falsy). Hoặc ký Authenticode + `ALLOW_UNSIGNED=0` |
| **Không tự cập nhật (GitHub)** | `npm run release:github:verify`. Release **bắt buộc** `latest.yml` + `.exe` (không draft). Thiếu yml → updater ném `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` |
| App báo thiếu feed / không check | Packaged nạp `PROVIDER=github` + owner/repo từ `public.env`. Code cũ chỉ đọc `FEED_URL` → **cài tay một lần** bản có fix |
| Có tải nhưng không cài | Policy: **lần mở app sau** mới cài. Đóng hẳn → mở lại. **NSIS** (`pack:commercial` / build desktop) ổn định hơn **portable** (`pack:unsigned:qa`) |
| User kẹt bản cũ | Gửi link release thủ công 1 lần; sau khi lên bản có fix + feed đủ yml/exe, các lần sau tự chạy |
| package.json == version feed | `update-not-available` — phải **bump version** (1.0.4→1.0.5) rồi pack + publish |
