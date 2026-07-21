# Checklist máy trắng — 5 phút (bản thương mại + logo brand)

> Bản pack sạch (unsigned QA portable):  
> `dist-qa-unsigned\AI-Novel-1.0.0-x64.exe`  
> (hoặc `dist-qa-unsigned\win-unpacked\` để chạy không cài)

## Brand / logo (bắt buộc nhìn thấy)

| # | Kiểm tra | Kỳ vọng |
|---|----------|---------|
| L1 | **Splash khởi động** | Logo brand **nổi trên nền desktop** (cửa sổ trong suốt, không khung tròn/spinner/cửa sổ đen full); biến mất khi workspace sẵn sàng |
| L2 | **Header workspace** | Cùng logo brand (góc trái) — **không** chữ badge `up to PRO` trên logo |
| L3 | **Icon file .exe / taskbar** | Icon vàng orb/plane (build/icon.ico) — không icon Electron mặc định |
| L4 | Free promo | Logo **pulse** nhẹ khi FREE; Trial/Pro có chip `TRIAL`/`PRO` nhỏ, **không** `UP TO PRO` |

Logo nguồn pack: `public/brand/logo.png` (+ `electron/splash-logo.jpg`, `build/icon.ico`).

---

## Bạn đưa cho khách **chỉ**

| File | Ghi chú |
|------|---------|
| `AI-Novel-1.0.0-x64.exe` (portable) **hoặc** installer NSIS từ `dist/` | Một file cài / chạy |
| (Tuỳ) PDF hướng dẫn kích hoạt Pro | Không nhét trong zip cùng source |

**Không** zip cả thư mục `D:\My app\AI Novel`, không `accounts_data`, không `.env`, không AppData.

---

## Trên máy dev: mô phỏng máy trắng (bắt buộc)

App packaged đọc project từ:

```
%APPDATA%\ai-novel-script-generator\
```

Cùng máy dev = vẫn thấy dự án cũ. Làm **một** trong hai:

### Cách A — Đổi tên AppData tạm

```powershell
# Đóng app trước
Rename-Item "$env:APPDATA\ai-novel-script-generator" "ai-novel-script-generator.bak-$(Get-Date -Format yyyyMMddHHmm)" -ErrorAction SilentlyContinue
```

### Cách B — Máy / user Windows khác

Copy **chỉ** file `.exe` sang máy khác hoặc user mới.

### Cách C — Portable smoke (nhanh)

```powershell
# Chạy unpacked nếu có
& ".\dist-qa-unsigned\win-unpacked\AI Novel & Script Generator.exe"
```

---

## Checklist 5 phút sau khi mở app sạch

| # | Kiểm tra | Kỳ vọng |
|---|----------|---------|
| 1 | Splash logo 3D | Đúng brand (L1), không spinner |
| 2 | Màn hình dự án | **Dự án mới** / trống — không truyện cũ của bạn |
| 3 | Cài đặt API keys | **Trống** — không Gemini/Flow key của bạn |
| 4 | Badge gói | FREE (hoặc TRIAL sau khi bấm trial) — không Pro free |
| 5 | Header logo | Đúng brand, không `up to PRO` (L2) |
| 6 | Thư mục cài / portable | **Không** có `resources\scratch\novel_store_backup.json` full project dev |
| 7 | Mở file JSON | App **không** tự load `Documents\AINovel\…` hay folder source monorepo |
| 8 | Online + kích hoạt | Token/mã Pro của **máy khách** (HWID mới) |
| 9 | 1 tool Pro (vd video / CapCut / ship) | Cần Pro + key user (BYOK) + mạng nếu cloud IP |
| 10 | DurableStore idle | Không spam log `Saved score=…` mỗi giây khi không sửa gì |

---

## Đường dẫn runtime (packaged) — đúng thiết kế

| Mục đích | Path |
|----------|------|
| Code / binary / crown / python_core | Thư mục cài (portable: cạnh `.exe` → `resources\`) |
| Brand splash | `resources\app.asar` → `electron/splash.html` + `splash-logo.jpg` |
| Dự án, vault key, backup | **Chỉ** `%APPDATA%\ai-novel-script-generator\` |
| Cấu hình public (URL license) | `resources\commercial\public.env` |

`process.chdir(resources)` khi packaged → NAV/Python relative path đúng theo app cài, không theo folder dev.

---

## Sau test: khôi phục AppData dev (tuỳ chọn)

```powershell
# Xóa profile test sạch (nếu không cần)
# Remove-Item "$env:APPDATA\ai-novel-script-generator" -Recurse -Force
# Khôi phục backup:
# Rename-Item "$env:APPDATA\ai-novel-script-generator.bak-..." "ai-novel-script-generator"
```

---

## Build lại bản sạch (unsigned QA)

```powershell
cd "D:\My app\AI Novel"

# 1) Brand LOCKED — logo nổi trong suốt ≥5s (docs/BRAND_SPLASH.md)
npm run brand:icons
npm run brand:sync
npm run smoke:brand-splash

# 2) Pack portable sạch (không code-sign) — script gọi brand:* lại
npm run pack:unsigned:qa

# 3) Audit artifact
npm run audit:package -- dist-qa-unsigned/win-unpacked

# File khách:
#   dist-qa-unsigned\AI-Novel-1.0.0-x64.exe
#   dist-qa-unsigned\win-unpacked\
```

### Signed / production (khi đủ cert + secrets)

```powershell
npm run brand:icons
npm run brand:sync
npm run build:desktop
# Output: dist\AI-Novel-1.0.0-x64.exe (NSIS)
```

---

## Checklist seller (gắn commercial)

Chạy in terminal:

```powershell
npm run commercial:white-machine
```

Chi tiết dài: `docs/SHIP_GUIDE.md`, `docs/COMMERCIAL_GO_LIVE.md`.
