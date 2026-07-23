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

## 5. Update / auto-update (LOCKED)

| | |
|--|--|
| Provider | GitHub Releases (**preferred**) + Supabase generic **fallback** (dual-feed) |
| Repo public | `khanhtran0393/AI-Novel-release-` |
| Policy | Check → **tự tải** → **không** cài lúc đóng → cài **lần mở sau** (không hỏi) |
| Pack target | **NSIS** (`pack:ship`) — portable không ưu tiên cho auto-update |
| `public.env` | `PROVIDER=github` · owner/repo · `FEED_URL` bật · `CHECK_ON_LAUNCH=1` · `ALLOW_UNSIGNED=1` |
| Release assets | **Bắt buộc** `AI-Novel-*-x64.exe` + **`latest.yml`** (+ blockmap) |
| **`latest.yml`** | **Một khuôn** (`scripts/lib/latestYml.mjs`): luôn `version: X.Y.Z` + path = `AI-Novel-X.Y.Z-x64.exe` + sha512 + size. Pack/publish **ghi đè** yml builder (`--strict`). **Cấm** ship yml thiếu version |
| Sau pack | `npm run release:ship-update` hoặc `release:github:cred` → `release:github:verify` **PASS** |
| Token | **Cấm** GH_TOKEN trong package; publish bằng env / git credential |
| Bump version | Trước mỗi ship update — trùng version feed = không có gì để update |
| User bản updater hỏng | Cài tay **1 lần** installer mới; sau đó mới auto |

Chi tiết: `docs/PACK_NOTES.md` **§2–§3 (quy trình)** · **§9 (latest.yml)** · `docs/APP_UPDATE.md`.

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
| ASAR integrity fuse | **On mặc định** (fuse **sau** rcedit icon). Boot fail → `AINOVEL_ASAR_INTEGRITY=0` |
| Offline grace | **24h** / first-run **6h** / strict IP **3h** / seat **10m** |
| Deny telemetry local | `deny-events.jsonl` (reason only, no token) |
| Free/trial machine store | **Outside** portable folder (`%USER_DATA%/.ainovel-license` + HKCU secondary) — wipe+re-extract must **not** reset free quota / local trial; packaged trial = cloud HWID only |
| Crown IP seal (toolbox formulas) | **On** (with-crown-sealed-build) |
| Source maps browser production | **Off** |
| Post-pack | `npm run postpack:checklist` + smoke:defense-pack |

### 5b. License ledger = Supabase only (LOCKED — đọc trước mọi pack)

**Nguồn sự thật duy nhất:** bảng Supabase `licenses` theo **HWID máy** (sổ cái), không phải chữ ký token trên máy khách.

| Tình huống | App khách |
|------------|-----------|
| Seller cấp row `active` + user dán token | Pro / Trial |
| **Xóa id / row** trên Supabase (hoặc revoke / hết hạn) | **Free** — kể cả token `AINOVEL2…` vẫn verify crypto |
| Token local còn trong `localStorage` | Bị clear khi status/heartbeat thấy ledger = none |
| Offline sau khi đã verify online OK | Grace heartbeat (mặc định **24h**) — **không** grant mới nếu ledger đã xóa khi online |

**Trước pack bắt buộc kiểm tra:**

1. Vercel / LICENSE_API có `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (ledger online).
2. `AINOVEL_LICENSE_API_URL` trỏ host pin (`ai-novel-flax.vercel.app` hoặc allowlist).
3. Customer package: `AINOVEL_ENTITLEMENT_MODE=enforce`, **không** `SERVICE_ROLE` trong installer.
4. Smoke: xóa/revoke row HWID test → app online → badge **FREE** + API Pro 403.

**Ghi chú chống sót/nhầm (bắt buộc đọc):** [`docs/PACK_NOTES.md`](../../docs/PACK_NOTES.md) — quy trình 4 bước §2 + phiếu tick §3  
Preflight in full banner mỗi lần: `npm run preflight:pack`.

Docs: `docs/LICENSE_ONE_PATH.md` · code: `licenseHeartbeat.probeOnlineVerify` · `resolveRequestAccessAsync`.

### 5c. Đừng nhầm lệnh / đừng sót bước

| Đúng | Sai / hay nhầm |
|------|----------------|
| `npm run pack:ship` = portable QA unsigned | Coi portable = bản bán signed |
| `npm run pack:commercial` = signed retail (cần CSC) | Bỏ cert rồi force unsigned “cho nhanh” khi bán |
| Preflight → crown → brand → builder → audit → smokes | `electron-builder` tay bỏ gate |
| `public.env` chỉ public | Nhét SERVICE_ROLE / private vào package |
| Ledger Supabase = Pro/Free | Tin token crypto local = Pro vĩnh viễn |
| Grace 24h/6h/3h · seat 10m | Nới grace “cho dễ test” trên bản khách |
| Fuse ASAR sau rcedit | Bật integrity rồi rcedit lại (boot fail) |

Sau pack:

```powershell
npm run postpack:checklist -- dist-qa-unsigned
npm run smoke:defense-pack
```

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
| L5b Machine store | Free/trial vault ngoài portable + HKCU — cấm reset bằng xóa app |
| L6 Heartbeat | Online revoke khi packaged + mạng |
| L7 Audit / smokes | audit package + anti-tamper + labyrinth smokes xanh trước ship rộng |
| L8 RE friction | Shell minify pack-time; crown seal; gateway compile best-effort |
| L9 Labyrinth | Bypass probe + mirage + wrong-path khi nghi tamper |

**Không hứa “không crack được”** — bắt buộc giữ stack trên; cấm gỡ labyrinth/anti-tamper khi pack.

Smoke khuyến nghị / đã wire trong `pack:ship`:

```powershell
npm run smoke:anti-tamper
npm run smoke:labyrinth
npm run smoke:re-harden
npm run smoke:crown-ip
npm run smoke:defense-pack
npm run postpack:checklist -- dist-qa-unsigned
```

---

## 7. Lệnh đóng gói đầy đủ

```powershell
# 0) Đọc ghi chú chống sót
#    docs/PACK_NOTES.md  ·  npm run preflight:pack

# Ship chuẩn (brand + harden + crown + portable, không cert)
npm run pack:ship

# Sau pack (đã gồm trong pack:ship; chạy lại nếu cần)
npm run postpack:checklist -- dist-qa-unsigned

# Có cert (bán rộng)
# set CSC_* … rồi: npm run pack:commercial
# npm run postpack:checklist -- dist
```

Output ship unsigned (NSIS): `dist-qa-unsigned/AI-Novel-<version>-x64.exe` + `latest.yml`  
Output signed: `dist/` (NSIS) — **không** nhầm với `dist-qa-unsigned`.

Publish update (**bắt buộc** nếu muốn user tự cập nhật):

```powershell
# Bump package.json version trước pack
npm run pack:ship
npm run release:ship-update
# hoặc: npm run release:github:cred
npm run release:github:verify   # PASS = latest.yml + exe public 200
```

---

## 8. Checklist 60 giây (trước mỗi pack)

- [ ] Tên **Ai Novel**
- [ ] Logo + `brand:icons`
- [ ] Splash logo, không spinner
- [ ] Taskbar icon = logo
- [ ] Version `package.json` đúng (**bump** nếu ship update)
- [ ] `ALLOW_UNSIGNED=1` (hoặc 0 nếu chỉ ship signed)
- [ ] Update: GitHub owner/repo + `FEED_URL` dual-feed + `CHECK_ON_LAUNCH=1`
- [ ] **`latest.yml`:** sau pack có `version:` = package.json; path = `AI-Novel-{ver}-x64.exe`
- [ ] Không secret trong package
- [ ] Crown seal + re-harden trong pipeline pack
- [ ] `audit:package` PASS
- [ ] (Khuyến nghị) anti-tamper + labyrinth smoke PASS
- [ ] Sau pack: publish feed (`release:ship-update`) + `release:github:verify` PASS

---

*Chuẩn thống nhất Ai Novel — brand + cài unsigned + defense/labyrinth + update GitHub.*
