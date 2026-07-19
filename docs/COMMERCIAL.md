# AI Novel — Commercial readiness (P0 · P1 · P2)

Mô hình chốt: **License + BYOK + Free / Trial / Pro / VIP**.

## Dọn rác trước ship (đã làm)

- Gỡ **demo seed mạt thế** (`buildDemoProjectPatch`) — onboarding chỉ checklist
- Gỡ `LicenseActivationCard` chết (license chỉ ở logo modal)
- Xóa vault smoke / `tmp-*` / brand archive ảnh test
- Smoke commercial **cách ly** vault → `scratch/commercial-smoke-vault` (không bẩn `data/licenses`)
- UI Free không bị `MODE=open` ép Pro (chỉ `AINOVEL_OWNER_UNLIMITED=1`)

---

## Checklist 10 bước “sẵn bán”

| # | Bước | Status trong repo |
|---|------|-------------------|
| 1 | Chốt model License + BYOK + Free/Pro | ✅ `src/lib/commercial/featureMatrix.ts` |
| 2 | Secret production + `ENTITLEMENT_MODE=enforce` | ✅ `entitlement.ts` + packaged `main.js` |
| 3 | Gỡ force owner Pro trên commercial | ✅ persist/rehydrate không ép Pro; sync theo mode |
| 4 | Payment webhook → code/token | ✅ `POST /api/entitlement/webhook` |
| 5 | UI kích hoạt Pro (token + AINOVEL code + Trial) | ✅ `LicenseActivationCard` |
| 6 | Gray/disable Pro features | ✅ CapCut, Ship, Toolbox + server `assertProAccess` |
| 7 | Build desktop + white-machine | ✅ `build:desktop` / `pack:portable` + runbook |
| 8 | Code sign installer | ⬜ Ops: set `CSC_LINK` / cert (xem COMMERCIAL_RELEASE) |
| 9 | ToS / Privacy / third-party / Flow disclaimer | ✅ `docs/LEGAL_*.md` |
| 10 | Docs cài + support + trial | ✅ `docs/INSTALL_SUPPORT.md` + trial API |

---

## P0 — Bắt buộc trước khi bán

1. **Free/Pro matrix** — `FEATURE_MATRIX` / `PRICING_PLANS`
2. **Entitlement enforce** — HMAC + HWID + fail-closed weak secret
3. **Activation** — token HMAC hoặc mã `AINOVEL-XXXX-XXXX-XXXX`
4. **Trial 3 ngày / 1 HWID** — `POST /api/entitlement/trial`
5. **Payment webhook** — `AINOVEL_PAYMENT_WEBHOOK_SECRET`
6. **Không bake secret** — `%APPDATA%/…/.env.commercial`
7. **UI sync** — `useEntitlementSync` + badge FREE/PRO/VIP

## P1 — Sớm

- Pricing trong Cài đặt → Bản quyền → Bảng giá
- License admin: `POST /api/entitlement/codes` + `npm run license:issue`
- Update channel env (`AINOVEL_UPDATE_*`) — feed optional
- Onboarding banner (đã có `OnboardingBanner`)
- Credential Health panel

## P2 — Sau

- electron-updater feed thật
- Code signing Authenticode
- Nuitka toolbox
- Multi-seat license server

---

## Luồng khách

```
Cài installer
  → Free: viết + prompt + TTS cơ bản + ảnh BYOK
  → (tuỳ) Trial 3 ngày
  → Mua → seller webhook/issue code
  → Cài đặt → Bản quyền: redeem AINOVEL-… hoặc dán token
  → Pro: video, CapCut, ship, toolbox…
```

## Lệnh

```bash
npm run smoke:commercial
npm run license:issue -- --plan pro --count 1
npm run prepare:publish
npm run build:desktop
```

Chi tiết build: [`COMMERCIAL_RELEASE.md`](./COMMERCIAL_RELEASE.md).
