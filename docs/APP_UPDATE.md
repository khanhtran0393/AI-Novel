# Auto-update desktop — dùng thật

## Policy app

1. Mở app (packaged) → check feed (~8s)  
2. Có bản mới → **tự tải** (nền)  
3. Đóng app → **không cài** (nếu đang tải dở → cố tải nốt)  
4. **Lần mở sau** → tự cài (không hỏi)

Code: `electron/updater.js` · Env: `resources/commercial/public.env`

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

## Troubleshooting

| Lỗi | Cách xử lý |
|-----|------------|
| TUS / HTTP **413** | Tăng Global file size limit (mục trên) |
| Dev không update | Chỉ bản **packaged** / installer |
| `latest.yml` 200 nhưng không có exe | Chưa upload được installer — sửa 413 rồi publish lại |
| Signature fail | Bật `AINOVEL_UPDATE_ALLOW_UNSIGNED=1` hoặc ký Authenticode |
