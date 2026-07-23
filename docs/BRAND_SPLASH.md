# Brand splash (logo khi khởi động) — **yêu cầu pack LOCKED**

> Tài liệu máy đọc / ship-check: `resources/commercial/PACKAGING_STANDARD.md` §1–2.  
> Smoke: `npm run smoke:brand-splash` · sync: `npm run brand:sync` · icons: `npm run brand:icons`.

## Hành vi (bắt buộc trên bản đóng gói)

Khi mở app (dev hoặc package):

1. Cửa sổ Electron **`transparent: true`** + `backgroundColor: #00000000`.
2. Splash = **chỉ logo nổi** trên desktop (HTML nền trong suốt — **cấm** panel, **cấm** nền đen full, **cấm** spinner thay logo).
3. Logo nhúng **base64** trong data-URL (`electron/splashBrand.js`) — không phụ thuộc path relative trong ASAR.
4. Giữ splash **tối thiểu 5 giây** (mặc định `AINOVEL_SPLASH_MS=5000`).
5. Chỉ vào `/workspace` khi **đủ 5s** *và* Next server sẵn sàng (workspace HTML nền đặc).
6. Server chậm hơn 5s → logo vẫn nổi đến khi server xong.

Override:

```bat
set AINOVEL_SPLASH_MS=5000
```

`0` = không chờ min (chỉ khi server ready) — **chỉ dev debug**, không dùng cho ship.

---

## File brand **bắt buộc trước / khi pack**

| Path | Vai trò | Fail pack nếu thiếu? |
|------|---------|----------------------|
| `build/icon-source-logo.jpg` | Nguồn `npm run brand:icons` (JPG có nền đen OK) | Có (brand:icons) |
| `build/icon.ico` / `build/icon.png` | Taskbar + `win.icon` + rcedit .exe — **alpha trong suốt** (punch nền đen) | Có (ship-check / beforePack) |
| `electron/icon.ico` / `electron/icon.png` | `BrowserWindow` icon runtime (alpha) | Có (brand:sync) |
| `electron/splash-logo.png` | Logo boot ưu tiên (alpha, không ô vuông đen) | Có sau `brand:icons` |
| `electron/splash-logo.jpg` | Fallback logo boot (có thể còn nền đen) | Có (beforePack hard-fail) |
| `electron/splashBrand.js` | Embed logo + gate 5s | Có (beforePack hard-fail) |
| `electron/splash.html` | Fallback loadFile (transparent) | Có (ship-check) |
| `main.js` | `require('./electron/splashBrand')`, `transparent: true`, gate | Có (smoke + not stuck minify) |
| `scripts/lib/sync-brand-assets.cjs` | Đồng bộ brand → electron/ | Có (beforePack) |
| `docs/BRAND_SPLASH.md` | Spec (file này) | Nên có trong repo |

`package.json` → `build.files` **phải** gồm `electron/**/*` (đã có).

---

## Chuỗi đóng gói (LOCKED)

Mọi lệnh ship **bắt buộc** brand trước builder:

```powershell
# 1) Sinh icon + copy splash-logo vào electron/
npm run brand:icons

# 2) Đồng bộ lại electron/ (idempotent)
npm run brand:sync

# 3) Smoke gate + logo embed
npm run smoke:brand-splash

# 4a) QA portable unsigned
npm run pack:unsigned:qa

# 4b) hoặc commercial NSIS
npm run pack:commercial
```

Script đã nhúng sẵn:

| Script | Brand step |
|--------|------------|
| `pack:unsigned:qa` | `brand:icons` + `brand:sync` **trước** build/builder |
| `pack:commercial` | `brand:icons` + `brand:sync` **trước** build/builder |
| `electron-before-pack.cjs` | `syncBrandAssets` + **throw** nếu thiếu logo / `splashBrand.js` |
| `electron-after-pack.cjs` | rcedit `build/icon.ico` → `.exe` + verify brand trong ASAR |
| `ship-check` / `audit:release-source` | File brand trong required list |

### beforePack (không bỏ qua)

1. `syncBrandAssets(ROOT)`  
2. Hard-fail nếu không có `electron/splash-logo.jpg|png` và không có `electron/icon.png`  
3. Hard-fail nếu thiếu `electron/splashBrand.js`  
4. (Sau đó) re-harden shell — **afterPack phải restore** `main.js` source

### afterPack

1. Rcedit embed `build/icon.ico` vào exe (taskbar)  
2. Log verify `electron/splashBrand.js`, `splash-logo.*`, `icon.ico` trong ASAR  
3. Restore shell sources (tránh kẹt `main.js` minify)

---

## Checklist 30 giây trước khi báo pack xong

- [ ] `npm run brand:icons` + `brand:sync` OK  
- [ ] `npm run smoke:brand-splash` → `ok: true`, `defaultMs: 5000`  
- [ ] `main.js` **không** bắt đầu bằng `/* ainovel-re-harden esbuild`  
- [ ] `main.js` có `transparent: true` + `splashBrand`  
- [ ] `electron/splash-logo.jpg` + `splashBrand.js` tồn tại  
- [ ] Mở artifact: logo **nổi trong suốt** ≥5s rồi vào workspace  
- [ ] Taskbar / Explorer icon = brand (không Electron default)

---

## Debug

| Triệu chứng | Xử lý |
|-------------|--------|
| Spinner / không logo | `npm run brand:icons` — thiếu `splash-logo` |
| Logo trên nền đen full | Sai bản cũ opaque — pack lại với `splashBrand` transparent |
| Taskbar icon cũ | afterPack rcedit / gỡ pin taskbar / cài bản mới |
| `main.js` 1 dòng minify | `restoreShellFromBackup` hoặc checkout + pack lại |
| Log | `[Window] transparent-splash …` / `[Splash] holding floating logo…` |
