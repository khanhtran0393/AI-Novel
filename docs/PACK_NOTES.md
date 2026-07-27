# Ghi chú PACK — Ai Novel (mỗi lần đóng gói)

**Mục đích:** sửa bản chính xong → pack lại **đúng thay đổi đó**, **không quên** license / update / brand / secret, **không nhầm** dev với gói khách.

| | |
|--|--|
| **Làm theo** | **§2 Quy trình 4 bước** + **§3 Phiếu tick** (mỗi lần pack) |
| **Banner terminal** | `npm run preflight:pack` (nhúng tóm tắt + gate máy) |
| **Chuẩn khóa** | `resources/commercial/PACKAGING_STANDARD.md` · `PACKAGING_STANDARD.json` |
| **Update sâu** | `docs/APP_UPDATE.md` · license one-path: `docs/LICENSE_ONE_PATH.md` |

---

## 0. Quy tắc thép (đọc 15 giây)

| Đúng | Sai / hay sót |
|------|----------------|
| Muốn thay đổi lên tay user → **`npm run pack:ship` lại** rồi test **artifact mới** | Sửa source, vẫn chạy `.exe` / `win-unpacked` **cũ** |
| Chân lý ship = gói sau pack | Coi `npm run dev` / Pro “mở” trên dev = gói khách |
| Pack **full** pipeline (`pack:ship`) | `electron-builder` tay, bỏ preflight / crown / brand |
| `pack:ship` = **NSIS** (auto-update) | Nhầm portable khi cần user tự update |
| Pack PASS + **publish feed** = user update được | Coi pack xong = user đã có bản mới |
| Test **đúng màn vừa sửa** trên gói + 5 gate cốt lõi | Chỉ tin preflight / typecheck là đủ UI |

**Dev ≠ gói khách**

| | `npm run dev` | Gói `pack:ship` |
|--|---------------|-----------------|
| Entitlement | Thường lỏng / `open` có thể | **`enforce`** |
| Secrets | `.env` đầy | Chỉ `public.env` + public keys |
| Owner / local trial | Có thể bật | **Tắt** trên package khách |
| Code | HMR, file đang mở | **Snapshot** lúc `next build` + asar |

---

## 1. Chọn lệnh — đừng nhầm

| Mục đích | Lệnh | Output |
|----------|------|--------|
| **Mặc định: Ship / QA (NSIS + auto-update)** | `npm run pack:ship` | `dist-qa-unsigned/AI-Novel-*-x64.exe` + `latest.yml` + smokes |
| Chỉ portable (không ưu tiên update) | `npm run pack:unsigned:portable` | portable trong `dist-qa-unsigned/` |
| Bán rộng + ký Authenticode | `npm run pack:commercial` (cần `CSC_*`) | `dist/` signed |
| Chỉ gate + đọc banner (không build) | `npm run preflight:pack` | PASS/FAIL + PACK NOTES |
| Sau pack (đã nằm trong `pack:ship`) | `npm run postpack:checklist -- dist-qa-unsigned` | public.env, kokoro, keys |
| User tự update (sau pack) | `npm run release:ship-update` rồi `release:github:verify` | GitHub Release + feed |

**Cấm:** `pack:commercial` fail cert rồi tắt forceCodeSigning để lách · nhét `SERVICE_ROLE` / private key vào gói · `AINOVEL_ENTITLEMENT_MODE=open` trên `public.env` khách.

---

## 2. QUY TRÌNH 4 BƯỚC (làm theo từng lần — sửa nhỏ cũng vậy)

### Bước 1 — Sửa bản chính + khóa phạm vi

1. Sửa code trên main, dev cho đến khi **bạn thấy đúng**.
2. Ghi **một dòng** (commit message / notepad): *vừa sửa gì, mở màn nào để kiểm sau pack*.  
   Ví dụ: *“License modal: bỏ dòng Cloud Supabase bật”*.
3. Xem phạm vi file (tránh quên domain nặng):

```powershell
cd "D:\My app\AI Novel"
git status
git diff --stat
```

| Diff chạm (gợi ý) | Sau pack nên thêm |
|-------------------|-------------------|
| `features/license`, entitlement, commercial | Mở Bản quyền + `npm run smoke:commercial` (hoặc revoke tay 1 HWID) |
| TTS / vina / kokoro | 1 preview TTS; `npm run smoke:vina` nếu đụng catalog |
| `electron/`, updater, `public.env` update | Checklist update + (nếu publish) `release:github:verify` |
| Brand / icon / splash | Nhìn taskbar + splash 5s |
| Nhiều file / không chắc | `npm run verify:agent-done` |

---

### Bước 2 — Trước pack (~60 giây)

```powershell
npm run preflight:pack
```

- **FAIL** → sửa theo log, **chưa** pack.
- **PASS** → đọc lướt banner (LICENSE · update · cấm nhầm lệnh).

Checklist tay (bổ sung preflight & security gate):

- [ ] Biết mình vừa sửa gì (Bước 1).
- [ ] **Dependency Audit Gate**: `npm audit --omit=dev --audit-level=high` exit code 0 (không còn lỗ hổng High/Critical).
- [ ] **Flow Bridge Auth Gate**: CSPRNG secret (`crypto.randomBytes(32)`), WS origin/secret validation, proxy allowlist (`labs.google`, `aisandbox-pa`), binary sink canonical path.
- [ ] **Cloud Trial & Crown IP Auth**: Require user auth + device HWID verification (`claims.hwid` vs `bodyHwid`).
- [ ] **Ship cho user / cần auto-update?** → **bump** `package.json` `version` + block trong `resources/commercial/release-notes.json` (preflight **fail** nếu thiếu notes cho version hiện tại).
- [ ] Chỉ QA nội bộ, **không** đẩy feed → có thể không bump; **không** nhầm version với feed public đang live.
- [ ] `resources/commercial/public.env`: `enforce`, `AINOVEL_UPDATE_ALLOW_UNSIGNED=0`, không secret, update dual-feed (`PROVIDER=github`, `FEED_URL`, `CHECK_ON_LAUNCH=1`).
- [ ] Không còn `package.json.pack-backup` kẹt từ pack dở.
- [ ] (Sẽ publish) GitHub login / `GH_TOKEN` sẵn — **không** nhét token vào gói.
- [ ] (Bán signed) `CSC_*` sẵn → dùng `pack:commercial`, không `pack:ship`.

---

### Bước 3 — Pack full (đừng rút gọn)

```powershell
npm run pack:ship
```

Pipeline (đã wire — **không** bỏ bước):

```text
preflight:pack
  → prepare:la-studio-kokoro
  → brand:icons + brand:sync
  → with-crown-sealed-build (Next + crown seal)
  → build:capcut-runtime
  → xinchao:build:verified (parity + frontend/backend tests + Tauri exe)
  → electron-builder (NSIS → dist-qa-unsigned)
       beforePack: brand + shell re-harden
       afterPack:  rcedit → crown → fuses
  → generate latest.yml --strict
  → audit:package
  → smoke: anti-tamper · labyrinth · re-harden · crown-ip · defense-pack
  → postpack:checklist
```

- **Mọi smoke/checklist PASS** → artifact chứa code **lúc build**.
- **FAIL** → sửa theo log, pack lại — **không** phát installer dở.
- Artifact dùng ngay:
  - Nhanh: `dist-qa-unsigned\win-unpacked\Ai Novel.exe`
  - Cài: `dist-qa-unsigned\AI-Novel-<version>-x64.exe` (**file mới nhất** theo giờ)

**Cấm** dùng installer / win-unpacked **cũ** để “xác nhận” sửa vừa làm.

---

### Bước 4 — Sau pack: đúng chỗ sửa + không lệch chỗ khác

#### 4A — Đúng thay đổi của bạn (bắt buộc)

Mở **gói mới** → đúng màn / flow đã ghi ở Bước 1 → mắt thường xác nhận.

Preflight **không** kiểm UI từng dòng chữ. Bỏ bước này = hay “pack lại vẫn sai”.

#### 4B — Năm điểm cốt lõi (~3–5 phút, mọi lần ship)

1. App **mở được** (splash → workspace), không thoát ngay.
2. Badge **FREE / TRIAL / PRO** hợp lý — không Pro ảo kiểu dev `open`.
3. **Free** vẫn chặn việc Pro (video / export / tool Pro tùy matrix).
4. Online: commercial / license status không 500; (nếu Pro) revoke row HWID → **FREE**.
5. `postpack:checklist` đã PASS trong `pack:ship` (public.env enforce, keys, kokoro…).

Không cần regression full app mỗi lần đổi 1 dòng UI.

#### 4C — Smoke thêm theo domain (nếu Bước 1 đánh dấu)

```powershell
npm run smoke:commercial          # license / entitlement
npm run smoke:vina                # TTS vina
npm run verify:agent-done         # gate theo diff (agent / phạm vi rộng)
```

#### 4D — User ngoài máy bạn phải có bản mới?

```powershell
# Đã bump version + pack:ship PASS
npm run release:ship-update
# hoặc: npm run release:github:cred
npm run release:github:verify     # phải PASS (latest.yml có version + exe 200)
```

| | |
|--|--|
| Pack PASS, **chưa** publish | Chỉ máy bạn có bản mới |
| `latest.yml` thiếu `version:` | **Cấm** publish — regenerate `--strict` |
| Version gói = version feed public | User **không** thấy update → cần bump rồi pack lại |

Chi tiết schema: **§9** bên dưới · `docs/APP_UPDATE.md`.

---

## 3. Phiếu tick — copy mỗi lần pack

```text
[ ] 1. Sửa xong trên main; git diff biết phạm vi; ghi 1 dòng “kiểm màn nào”
[ ] 2. (Ship update cho user?) bump package.json version + release-notes.json
[ ] 3. npm run preflight:pack                    → PASS
[ ] 4. npm run pack:ship                         → PASS
[ ] 5. Mở win-unpacked / exe MỚI — đúng chỗ vừa sửa (4A)
[ ] 6. Năm điểm cốt lõi boot / badge / Free gate / status / checklist (4B)
[ ] 7. (Domain nặng?) smoke tương ứng (4C)
[ ] 8. (User update?) release:ship-update + release:github:verify PASS (4D)
[ ] 9. Chỉ giữ 1 artifact mới (tránh nhầm exe cũ cùng bàn)
```

---

## 4. Lệnh nhanh copy-paste

```powershell
cd "D:\My app\AI Novel"

# --- Bước 1 ---
git status
git diff --stat
# (Ship update) bump version trong package.json + release-notes.json

# --- Bước 2 ---
npm run preflight:pack

# --- Bước 3 ---
npm run pack:ship

# --- Bước 4 ---
# Mở: dist-qa-unsigned\win-unpacked\  (hoặc AI-Novel-*-x64.exe mới)
# type dist-qa-unsigned\latest.yml   → dòng đầu: version: X.Y.Z

# (User tự update)
npm run release:ship-update
npm run release:github:verify

# Bán signed (khi có cert)
# $env:CSC_LINK=...; $env:CSC_KEY_PASSWORD=...
# npm run pack:commercial
```

---

## 5. LICENSE — sổ cái Supabase (SOLE TRUTH) LOCKED

| Sự thật | Ý nghĩa |
|---------|---------|
| Authority | Bảng Supabase **`licenses`** theo **HWID máy** |
| Xóa id / revoke / expired | App **Free** (online), kể cả token `AINOVEL2…` crypto còn OK |
| Token local | Chỉ **vé** (`localStorage.ainovel.entitlementToken`) — không self-heal Pro |
| LICENSE_API (Vercel) | **Bắt buộc** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (secret cloud, **không** trong gói) |
| Package khách | `enforce` + public keys only — **cấm** service_role / private / open / owner |

**Test tay (trước phát hành rộng):** Activate Pro → **xóa/revoke row** Supabase → restart/focus online → badge **FREE** + API Pro **403**.

Docs: `docs/LICENSE_ONE_PATH.md`.

---

## 6. Defense defaults (đừng nới khi pack khách)

| Tham số | Mặc định | Env override (public.env optional) |
|---------|----------|-------------------------------------|
| Offline grace sau online-OK | **24h** | `AINOVEL_HEARTBEAT_GRACE_SEC` |
| First-run offline | **6h** | `AINOVEL_HEARTBEAT_FIRST_RUN_SEC` |
| Strict Pro IP | **3h** | `AINOVEL_STRICT_ONLINE_GRACE_SEC` |
| Seat share window | **10m** | `AINOVEL_SEAT_PRESENCE_WINDOW_SEC` |
| ASAR integrity fuse | **ON** (fuse **sau** rcedit) | `AINOVEL_ASAR_INTEGRITY=0` nếu boot fail |
| Deny log | `~/.ainovel-license/deny-events.jsonl` | reason + hwid8, **không** token |

**Cấm khi pack khách:** `AINOVEL_ENTITLEMENT_MODE=open` · `AINOVEL_OWNER_UNLIMITED=1` · `AINOVEL_ALLOW_LOCAL_TRIAL=1` · nhét `SERVICE_ROLE` / private PEM vào installer/asar · ghi free-usage/trial **trong** folder app.

Docs: `docs/DEFENSE_LAYERS.md` · `docs/ATTACK_SURFACE.md`.

---

## 7. Free / Trial machine store (chống xóa portable reset) LOCKED

| Sự thật | Ý nghĩa |
|---------|---------|
| Code | `src/lib/commercial/licenseMachineStore.ts` + `freeQuota.ts` + `trial.ts` |
| Electron path | `%APPDATA%\Ai Novel\.ainovel-license\` |
| Fallback | `~\.ainovel-license\` |
| Windows secondary | `HKCU\Software\AiNovel\MachineStore` |
| Xóa portable + giải nén lại | **Không** reset free quota / trial (cùng Windows user + HWID) |
| Packaged trial | Local trial **tắt**; trial thật = **cloud / Supabase HWID** |

**Test (cùng máy):** Free hết lượt → xóa folder portable → chạy lại → **vẫn hết lượt**.

Smoke: `npx tsx scripts/smoke-machine-store-wipe.mts` · `npx tsx scripts/smoke-free-limits.mts`.

---

## 8. Pipeline kỹ thuật (đã wire — tham chiếu)

Giống Bước 3. **Đừng** chạy `electron-builder` tay bỏ preflight / crown / brand.

Re-harden: shell minify **luôn** snapshot workspace hiện tại — **cấm** ship updater cũ từ backup stale.

---

## 9. Auto-update + `latest.yml` (LOCKED)

**User tự cập nhật chỉ khi: pack NSIS + publish feed.** Pack một mình ≠ ship update xong.

| Hạng mục | Sự thật |
|----------|---------|
| Code | `electron/updater.js` — dual-feed **GitHub → Supabase** |
| Policy | Mở app → check → **tự tải** → **lần mở sau** cài (không hỏi; không cài lúc đóng) |
| Target | **NSIS** (`pack:ship`) — portable kém `quitAndInstall` |
| `public.env` | `PROVIDER=github` + owner/repo + `FEED_URL` + `CHECK_ON_LAUNCH=1` + `ALLOW_UNSIGNED=1` |
| Feed | Repo release: mỗi tag **exe** + **`latest.yml`** (+ blockmap khuyến nghị) |
| Unsigned | `ALLOW_UNSIGNED=1` → `verifyUpdateCodeSignature = async () => null` (**cấm** gán `false`) |
| Token | **Cấm** `GH_TOKEN` trong package |

### `latest.yml` — khuôn cố định

| | |
|--|--|
| Schema | `scripts/lib/latestYml.mjs` |
| Pack | `pack:ship` **tự** generate `--strict` sau builder |
| Publish | luôn regenerate `--strict` trước upload |

```yaml
version: X.Y.Z
files:
  - url: AI-Novel-X.Y.Z-x64.exe
    sha512: <base64>
    size: <bytes>
path: AI-Novel-X.Y.Z-x64.exe
sha512: <base64>
releaseDate: 'ISO-8601'
```

**Thép:** luôn có `version:` · ver = `package.json` · path/url = `AI-Novel-{ver}-x64.exe` · có sha512 + size · **cấm** upload yml builder thiếu version.

| Lỗi | Ý nghĩa |
|-----|---------|
| Thiếu `latest.yml` trên release | User không update được |
| Thiếu `version:` | Manifest hỏng — regenerate `--strict` |
| Version package == feed | *update-not-available* — cần **bump** rồi pack lại |
| User bản updater hỏng | Cài tay **1 lần** installer mới; sau đó mới auto |

Smoke: `npm run smoke:latest-yml` · `npm run smoke:auto-update`.

---

## 10. Ngoài code (pack “xong” chưa đủ nếu bỏ)

| Việc | Ghi chú |
|------|---------|
| **Publish feed** | GitHub: exe + `latest.yml` (có `version:`) |
| Authenticode | Cert thật + `pack:commercial` |
| SERVICE_ROLE Vercel | Secret cloud — preflight chỉ probe HTTP |
| Revoke live 1 HWID | Trước phát hành rộng |
| Supabase Storage ≥ 500MB | Chỉ nếu upload full exe dual-feed (tránh 413) |
| Asarmor full / obfuscate cả `src/` | Deferred / không kỳ vọng |

---

## 11. SECURITY STOP-GATE TRƯỚC KHI ĐÓNG GÓI

Kiểm toán đầy đủ: [`SECURITY_PREPACK_AUDIT.md`](SECURITY_PREPACK_AUDIT.md).

Kế hoạch triển khai theo ticket: [`SECURITY_HARDENING_IMPLEMENTATION_PLAN.md`](SECURITY_HARDENING_IMPLEMENTATION_PLAN.md).

Các cơ chế hiện có như Ed25519, HWID, DPAPI, Crown seal, host guard, Electron fuses và ASAR integrity là **defense-in-depth**. Chúng tăng chi phí can thiệp nhưng không được mô tả là chống dịch ngược hoặc chống crack 100%.

### 11.1. Điều kiện chặn phát hành

Không publish artifact/update feed và không gọi là bản thương mại nếu còn một mục FAIL:

- `npm audit --omit=dev --audit-level=high` chưa exit 0.
- Flow bridge chưa có xác thực WS/HTTP, origin pin và proxy/path allowlist.
- Cloud license/Crown IP chưa kiểm tra ledger, revoke và device proof-of-possession.
- App, installer hoặc child executable chưa có Authenticode hợp lệ và timestamp.
- Unsigned updater vẫn được phép chạy.
- Artifact còn source `.ts`, `.tsx`, `.py`, source map, test/dev file ngoài allowlist.
- Package main không tồn tại hoặc desktop boot smoke chưa chạy chính artifact vừa build.
- ASAR integrity / `OnlyLoadAppFromAsar` không bật hoặc hook fuse fallback giảm bảo vệ.

### 11.2. Cách diễn giải các lớp bảo vệ

| Lớp bảo vệ | Điều được phép kết luận | Không được kết luận |
| :--- | :--- | :--- |
| Ed25519 + HWID | Token hợp lệ và có ràng buộc theo policy đã kiểm thử | Không thể replay/chia sẻ nếu cloud chưa kiểm tra ledger/PoP |
| DPAPI credential vault | Secret lưu trên đĩa được mã hóa theo user Windows | Renderer/runtime bị chiếm không thể lấy secret |
| Crown seal / Bytenode | Tăng chi phí đọc và chỉnh source | Không thể giải mã hoặc dịch ngược |
| ASAR integrity + fuses | Chặn một số kiểu sửa ASAR/inspect Electron | Bảo vệ mọi `extraResources` hoặc child process |
| Host guard | Hạn chế gọi runtime Python ngoài host theo policy | Bảo vệ source Python nếu source vẫn được ship |
| Artifact scanner | Chứng minh đúng phạm vi scanner đã quét | Không còn mọi secret/lỗ hổng nếu scanner bỏ qua extraResources |

### 11.3. Gate tối thiểu sau khi sửa

`preflight:pack` + dependency audit + Electron/anti-tamper smokes + artifact audit toàn staging + fuse inspection + Authenticode verification + real desktop boot + Flow auth test + cloud revoke/replay test + media thật phải cùng PASS.

---

*Cập nhật khi đổi grace / fuse / ledger / update feed / quy trình pack: sửa file này + banner `scripts/preflight-pack.mjs` + `PACKAGING_STANDARD.md` cùng lúc.*
