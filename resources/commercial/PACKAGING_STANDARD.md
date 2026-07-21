# Tiêu chuẩn đóng gói — **Ai Novel**

File này **đóng gói cùng app** (`resources/commercial/`).  
JSON máy đọc: `PACKAGING_STANDARD.json`.

**Mọi lần đóng gói** phải thỏa toàn bộ mục dưới. Lệnh chuẩn: `npm run pack:ship`.

---

## 1. Thương hiệu (LOCKED)

| Hạng mục | Giá trị bắt buộc |
|----------|------------------|
| **Tên app** | **Ai Novel** |
| productName (electron-builder) | `Ai Novel` |
| shortcut / menu Start | `Ai Novel` |
| Window title | `Ai Novel` |
| **Logo nguồn** | `build/icon-source-logo.jpg` (nút vàng / máy bay +) |
| Splash assets | `electron/splash-logo.jpg` + `electron/splashBrand.js` + `electron/splash.html` |
| Icon taskbar / Alt-Tab / .exe | `build/icon.ico` + `build/icon.png` (+ `electron/icon.*`) |

```powershell
npm run brand:icons
npm run brand:sync
npm run smoke:brand-splash
```

Spec chi tiết: [`docs/BRAND_SPLASH.md`](../../docs/BRAND_SPLASH.md).

---

## 2. Khởi động — logo nổi trong suốt (LOCKED)

| Được | Cấm |
|------|-----|
| Cửa sổ **`transparent: true`**, nền HTML **trong suốt** | Nền đen/full panel che desktop |
| **Chỉ logo brand nổi** (base64 data-URL) | Spinner ring / loading ring **thay** logo |
| Giữ splash **≥ 5 giây** (`AINOVEL_SPLASH_MS`, mặc định 5000) | Nhảy `/workspace` ngay khi server sẵn (<5s) |
| Splash **trước** `next.prepare()`; vào app khi đủ 5s **và** server ready | Soft-success / fake splash |

Code: `main.js` + `electron/splashBrand.js`.  
Pack: `beforePack` sync brand + hard-fail thiếu logo; `afterPack` rcedit icon + verify ASAR.

Lệnh pack **bắt buộc** prefix brand:

- `npm run pack:unsigned:qa` → đã gồm `brand:icons` + `brand:sync`
- `npm run pack:commercial` → đã gồm `brand:icons` + `brand:sync`

---

## 3. Ký số / cài đặt (LOCKED)

| Hạng mục | Quy tắc |
|----------|---------|
| **Không ký số vẫn cài được** | **Bắt buộc** — `forceCodeSigning: false` |
| Chạy unsigned | Được phép |
| Authenticode | Khuyến nghị ship rộng — **không** chặn cài |
| `AINOVEL_UPDATE_ALLOW_UNSIGNED` | `1` khi ship unsigned |

---

## 4. Telegram «Đã thanh toán» (LOCKED)

| | |
|--|--|
| Bot token / chat id | **Chỉ** trên Vercel license API — **cấm** nhét vào installer |
| App đóng gói | `POST /api/entitlement/payment-notify` → **proxy** `AINOVEL_LICENSE_API_URL` |
| Dev (unpacked) | Gọi Telegram local nếu có `AINOVEL_TELEGRAM_*` trong `.env.local` |

Vercel env bắt buộc: `AINOVEL_TELEGRAM_BOT_TOKEN` + `AINOVEL_TELEGRAM_CHAT_ID`.

---

## 5. Update (LOCKED)

| | |
|--|--|
| Provider | GitHub Releases |
| Repo public | `khanhtran0393/AI-Novel-release-` |
| Policy | Check → tự tải → cài **lần mở sau** |
| Token | **Cấm** GH_TOKEN trong package |

---

## 5. Bảo mật package (LOCKED — mỗi bản ship)

| Hạng mục | Bắt buộc |
|----------|----------|
| Entitlement mode | `enforce` (packaged) |
| Trial local escape | `AINOVEL_ALLOW_LOCAL_TRIAL=0` |
| OWNER_UNLIMITED / MODE=open | **Cấm** trên package khách |
| Private key / admin / service_role | **Cấm** trong asar/installer |
| License | Chỉ public keys `resources/license/public-keys` |
| Credential user | Electron safeStorage (DPAPI) |
| `npm run audit:package` | **PASS** |
| Shell re-harden (main/preload/electron) | **On** khi pack |
| Electron fuses (RunAsNode off, inspect off) | **On** |
| ASAR integrity fuse | **Off mặc định** (tránh boot fail sau rcedit icon). Bật: `AINOVEL_ASAR_INTEGRITY=1` |
| Crown IP seal (toolbox formulas) | **On** (with-crown-sealed-build) |
| Source maps browser production | **Off** |

---

## 6. Chống crack / bẫy (LOCKED — ship phải giữ)

Docs: `docs/DEFENSE_LAYERS.md` · `docs/LABYRINTH.md` · `docs/LICENSE_ONE_PATH.md`

| Lớp | Yêu cầu khi đóng gói |
|-----|----------------------|
| L0 Feature matrix | Free không gen_video / CapCut / ship… |
| L1 Ed25519 | Token `AINOVEL2.*` + public keyring |
| L2 API hard gate | `requireFeature` / `assertProAccess` trên route premium |
| L3 Packaged enforce | Multi-signal force enforce |
| L4 Electron sandbox | DevTools **off** packaged; contextIsolation; no nodeIntegration |
| L5 HWID | Multi-version dual-accept |
| L6 Heartbeat | Online revoke khi packaged + mạng |
| L7 Audit / smokes | audit package + anti-tamper + labyrinth smokes xanh trước ship rộng |
| L8 RE friction | Shell minify pack-time; crown seal; gateway compile best-effort |
| L9 Labyrinth | Bypass probe + mirage + wrong-path khi nghi tamper |

**Không hứa “không crack được”** — bắt buộc giữ stack trên; cấm gỡ labyrinth/anti-tamper khi pack.

Smoke khuyến nghị trước ship:

```powershell
npm run smoke:anti-tamper
npm run smoke:labyrinth
npm run smoke:re-harden
npm run smoke:crown-ip
```

---

## 7. Lệnh đóng gói đầy đủ

```powershell
# Ship chuẩn (brand + harden + crown + portable, không cert)
npm run pack:ship

# Sau pack: audit
npm run audit:package -- dist-qa-unsigned/win-unpacked

# Có cert (optional)
# set CSC_* … rồi: npm run pack:commercial
```

Output: `dist-qa-unsigned/AI-Novel-<version>-x64.exe`

Publish update:

```powershell
npm run release:manifest
# Upload exe + latest.yml → GitHub AI-Novel-release- tag vX.Y.Z
# hoặc: $env:GH_TOKEN=...; npm run release:github
```

---

## 8. Checklist 60 giây (trước mỗi pack)

- [ ] Tên **Ai Novel**
- [ ] Logo + `brand:icons`
- [ ] Splash logo, không spinner
- [ ] Taskbar icon = logo
- [ ] Version `package.json` đúng
- [ ] `ALLOW_UNSIGNED=1` (hoặc 0 nếu chỉ ship signed)
- [ ] Update GitHub owner/repo đúng
- [ ] Không secret trong package
- [ ] Crown seal + re-harden trong pipeline pack
- [ ] `audit:package` PASS
- [ ] (Khuyến nghị) anti-tamper + labyrinth smoke PASS

---

*Chuẩn thống nhất Ai Novel — brand + cài unsigned + defense/labyrinth + update GitHub.*
