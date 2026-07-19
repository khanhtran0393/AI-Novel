# Commercial release runbook — AI Novel

## 1. Pre-flight (dev machine)

```bash
npm run typecheck
npm run smoke:core
npm run smoke:pipeline
npm run verify:core
npm run smoke:commercial
npx playwright test --project=api-and-contracts
```

All must PASS before tagging.

## 2. Production secrets

1. Copy `.env.example` → `.env` (local) or `%APPDATA%/ai-novel-script-generator/.env.commercial` (packaged).
2. Set:

```env
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_ENTITLEMENT_SECRET=<crypto random ≥24>
AINOVEL_ENTITLEMENT_ADMIN_KEY=<another random ≥16>
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Never** ship the default dev secret. Enforce mode **refuses** weak/default secrets.

## 3. License flow (seller → buyer)

1. Buyer mở **Bản quyền** bằng cách **nhấp logo app** (header), copy **HWID**.  
   Trial / dán token / mã `AINOVEL-…` cũng ở modal này. Badge header: FREE → TRIAL → PRO → VIP.
2. Seller issues token (server must be enforce + secrets):

```bash
curl -X POST http://localhost:3000/api/entitlement/issue \
  -H "Content-Type: application/json" \
  -d "{\"adminKey\":\"YOUR_ADMIN_KEY\",\"is_pro\":true,\"is_vip\":false,\"hwid\":\"BUYER_HWID\",\"expSeconds\":2592000}"
```

3. Buyer pastes **token** → **Kích hoạt**.
4. App stores token in `localStorage.ainovel.entitlementToken` and sends `x-ainovel-entitlement` on API calls.

Pro routes (when enforce): `ship-pack`, `export-capcut`, `generate-video`, `integrations/pipeline`.

## 4. Build desktop

```bash
npm run build:desktop
# or portable
npm run pack:portable
```

Packaged Electron sets `AINOVEL_ENTITLEMENT_MODE=enforce` by default and loads `%APPDATA%/.../.env.commercial` if present.

## 5. White-machine smoke

1. Install on clean PC.
2. Place `.env.commercial` in userData (or set env before launch).
3. Activate license with HWID-bound token.
4. Run one chapter: write → TTS → prompt → image (optional) → ship.
5. Confirm Pro APIs reject without token (403).

## 6. Do not publish if

- `smoke:commercial` fails
- Mode is `open` on production build
- Secret is empty/default
- Admin key missing (cannot issue licenses)
- Payment/issue process not defined for your sales channel

## 7. Payment webhook

```bash
curl -X POST http://localhost:3000/api/entitlement/webhook \
  -H "Content-Type: application/json" \
  -H "x-ainovel-webhook-secret: YOUR_WEBHOOK_SECRET" \
  -d "{\"provider\":\"generic\",\"orderId\":\"ord_1\",\"email\":\"buyer@x.com\",\"plan\":\"pro\",\"issueMode\":\"code\"}"
```

Returns `codes: ["AINOVEL-…"]` for customer redeem in **Cài đặt → Bản quyền**.

## 8. Code signing (Windows) — P2 ops

```bash
# Example env for electron-builder
set CSC_LINK=path\to\cert.pfx
set CSC_KEY_PASSWORD=...
npm run build:desktop
```

Without signing, SmartScreen may warn “Unknown publisher”.

## 9. Legal pack (ship with product page)

- `docs/LEGAL_TOS.md`
- `docs/LEGAL_PRIVACY.md`
- `docs/LEGAL_THIRD_PARTY.md`
- `docs/LEGAL_FLOW_DISCLAIMER.md`
- `docs/INSTALL_SUPPORT.md`
- `docs/PRICING.md`
- Master: `docs/COMMERCIAL.md`

## 10. Seller CLI

```bash
npm run license:issue -- --plan pro --count 3
npm run license:issue -- --token --hwid <BUYER_HWID> --plan pro --expDays 365
```
