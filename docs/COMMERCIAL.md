# AI Novel — Commercial readiness (Free · Trial · Pro · VIP)

Mô hình chốt: **License + BYOK + Free / Trial / Pro / VIP**.

> Giải phẫu agent: [`AGENTS.md`](../AGENTS.md) §3 · Thép: [`IRON_LAWS.md`](./IRON_LAWS.md) A6 · Runbook: [`COMMERCIAL_RELEASE.md`](./COMMERCIAL_RELEASE.md) · Pricing: [`PRICING.md`](./PRICING.md)

---

## Sự thật UI / store (2026-07-19)

| Nơi | Hành vi |
|-----|---------|
| Badge Header | **VIP → TRIAL → PRO → FREE** |
| Logo app | Mở `features/license/LicenseModal` (Bản quyền) — **không** phụ thuộc Cài đặt |
| Store | `is_vip`, `is_pro`, `is_trial`, `credits` |
| Trial sync | `setVipStatus(false, true, true)` — badge **TRIAL** |
| Paid Pro | `setVipStatus(false, true, false)` — badge **PRO** |
| VIP / owner | `setVipStatus(true, true, false)` — badge **VIP** |
| HMAC trial | claims `is_trial` + `plan: 'trial'` (cloud không còn gộp PRO) |
| Boot sync | `hooks/useEntitlementSync.ts` (mount + focus) |
| UI gate | `useProAccess.can(feature)` đúng matrix |
| Server | `assertTierAtLeast` / `assertFeatureAccess`; pipeline = **pro only** |
| Credits | Trial **trừ** balance; Pro/VIP unlimited |

Token client: `localStorage.ainovel.entitlementToken` → header `x-ainovel-entitlement`.

---

## Ma trận sản phẩm (tóm tắt)

Nguồn: `src/lib/commercial/featureMatrix.ts`

| Feature | minTier | Server gate |
|---------|---------|-------------|
| Viết / outline / gen prompt / gen ảnh BYOK / TTS Edge-Piper / portable | free | không |
| TTS premium / multi-voice | trial | không (UI) |
| Gen video / CapCut / ship pack | trial | **có** (`assertProAccess` = trial+) |
| Integrations pipeline | pro | **có** (`assertFeatureAccess` — trial **bị chặn**) |
| Multi-channel / Toolbox / Flow multi-account | pro | UI `can()` (kênh 2+, toolbox, profile 2+) |

Trial mặc định: **3 ngày / 1 HWID** (`data/licenses/trials.json`, `AINOVEL_TRIAL_DAYS`).

---

## Entitlement mode

| Môi trường | Mode |
|------------|------|
| Dev / web | `AINOVEL_ENTITLEMENT_MODE` mặc định **`open`** |
| Electron **packaged** | Nếu unset → **`enforce`** (`main.js`) |
| Secrets packaged | `%APPDATA%/…/.env.commercial` — **không** bake secret vào installer |

`assertProAccess` (enforce): HMAC token + HWID match **hoặc** `trialGrantsPro()`. Secret yếu → fail-closed.

Server gates: `generate-video`, `export-capcut`, `ship-pack`, `integrations/pipeline`.

---

## API

| Endpoint | Việc |
|----------|------|
| `GET /api/commercial/status` | tier, trial, claims, matrix, pricing, update |
| `POST /api/entitlement/issue` | Cấp token (admin key) |
| `POST /api/entitlement/activate` | Token HMAC hoặc mã `AINOVEL-…` |
| `POST /api/entitlement/trial` | Bật trial 1 lần / HWID |
| `POST /api/entitlement/verify` | Verify token |
| `GET/POST /api/entitlement/hwid` | HWID máy |
| `POST /api/entitlement/webhook` | Payment → code/token |
| `POST /api/entitlement/codes` | Admin issue codes |
| `POST /api/entitlement/payment-notify` | Báo admin (Telegram / Zalo flow) |

Seller: `npm run license:issue` · vault `data/licenses/`.

### Cloud hybrid (optional Supabase)

| Path | Việc |
|------|------|
| `src/lib/supabase/*` | Client browser + service_role server; no-op nếu thiếu env |
| `src/lib/cloud/licenseBridge.ts` | Issue/verify HMAC, order confirm, trial, revoke, audit |
| `/api/cloud/*` | status, orders, orders/confirm, license issue/verify/trial/revoke |
| `/admin` | Admin UI khi deploy |
| `supabase/migrations/001_commercial_rls.sql` | profiles, devices, orders, licenses, audit |

**Hybrid rule:** thiếu Supabase → local vault + Zalo/HMAC vẫn đủ bán desktop.

Guide: [`SUPABASE_VERCEL_GUIDE.md`](./SUPABASE_VERCEL_GUIDE.md).

---

## Checklist 10 bước “sẵn bán”

| # | Bước | Status trong repo |
|---|------|-------------------|
| 1 | Model License + BYOK + Free/Trial/Pro/VIP | ✅ `featureMatrix.ts` |
| 2 | Secret production + enforce packaged | ✅ `entitlement.ts` + `main.js` |
| 3 | Không force owner Pro trên rehydrate commercial | ✅ persist + sync |
| 4 | Payment webhook → code/token | ✅ webhook route |
| 5 | UI kích hoạt (logo modal + trial + pricing) | ✅ `features/license/*` |
| 6 | Gray Pro features + server assert | ✅ CapCut/Ship/Toolbox + assertProAccess |
| 7 | Badge TRIAL ≠ PRO trả phí | ✅ Header + `is_trial` |
| 8 | Build desktop / portable | ✅ `build:desktop` / `pack:portable` |
| 9 | Code sign installer | ⬜ Ops: `CSC_LINK` |
| 10 | Legal + install support | ✅ `LEGAL_*.md`, `INSTALL_SUPPORT.md` |

---

## P0 — Bắt buộc trước khi bán

1. Free/Pro matrix — `FEATURE_MATRIX` / `PRICING_PLANS`
2. Entitlement enforce — HMAC + HWID + fail-closed
3. Activation — token hoặc `AINOVEL-XXXX-XXXX-XXXX`
4. Trial 3 ngày / 1 HWID
5. Payment webhook secret
6. Không bake secret
7. UI sync + badge FREE / **TRIAL** / PRO / VIP

## P1 — Sớm

- Pricing trong modal Bản quyền
- `npm run license:issue` + codes API
- Update channel env (`AINOVEL_UPDATE_*`)
- Onboarding banner + Credential Health

## P2 — Sau

- electron-updater feed thật
- Code signing Authenticode
- Nuitka toolbox
- Multi-seat license server

---

## Luồng khách

```
Cài installer (enforce)
  → Free: viết + prompt + TTS cơ bản + ảnh BYOK
  → (tuỳ) Trial 3 ngày → badge TRIAL, mở video/CapCut/ship tạm
  → Mua → seller webhook / issue code
  → Logo app → Bản quyền: redeem AINOVEL-… hoặc dán token
  → Pro/VIP: badge PRO hoặc VIP; full matrix theo gói
```

---

## Lệnh

```bash
npm run smoke:commercial
npm run license:issue -- --plan pro --count 1
npm run prepare:publish
npm run build:desktop
```

Chi tiết build: [`COMMERCIAL_RELEASE.md`](./COMMERCIAL_RELEASE.md).

---

## Dọn rác đã làm (lịch sử)

- Gỡ demo seed mạt thế onboarding
- Smoke commercial cách ly vault → `scratch/commercial-smoke-vault`
- MODE=open không ép Pro trừ owner unlimited / elevates có chủ đích
- Trial badge tách khỏi PRO (2026-07-19)
