# Seller Admin & commercial ops (1 trang)

## App đủ bán chưa?

**Có** — Free / Trial / Pro + Telegram + Ed25519 + Supabase revoke.  
**Installer production:** cần Authenticode (cert Windows) — xem `COMMERCIAL_GO_LIVE.md`.

## Admin UI

| URL | Việc |
|-----|------|
| Local | `http://127.0.0.1:3000/admin` |
| Prod | `https://ai-novel-flax.vercel.app/admin` |

1. Dán `AINOVEL_ENTITLEMENT_ADMIN_KEY` (chỉ máy seller / session).
2. **Load licenses** — lọc plan / status / HWID.
3. **Revoke** — tắt Pro trên máy khách (sau heartbeat).
4. **Cấp key nhanh** — nhập HWID + gói → copy token `AINOVEL2.…` gửi khách.
5. **Orders** — confirm pending + issue (khi dùng cloud orders).

API:

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/cloud/license/list?plan=&status=&q=` | `x-ainovel-admin-key` |
| POST | `/api/cloud/license/revoke` `{ licenseId }` | admin key |
| POST | `/api/cloud/license/issue` `{ planId, hwid }` | admin key |
| GET | `/api/cloud/orders` | admin key |

## Luồng bán hàng (chuẩn)

1. Khách: Logo → Bản quyền → copy HWID → CK VietQR → «Đã thanh toán».
2. Admin: Telegram **Cấp Key** (bridge) **hoặc** `/admin` Issue Pro token.
3. Khách dán **1 dòng** bắt đầu `AINOVEL2.` → Kích hoạt → badge **PRO**.
4. Key cũ `eyJ…` (HMAC) = vứt; cấp lại.

## Bot Telegram — menu + nút (không cần gõ lệnh)

Bot: `@AINovel_license_bot` · runtime: bridge Vercel **hoặc** poller seller desktop.

| UI | Việc |
|----|------|
| **Menu (góc trái khung nhập)** | Danh sách lệnh Bot API `setMyCommands` |
| **Nút trong tin nhắn** (inline only) | 🔑 Cấp key · 🔎 Tra cứu · 📋 List · 🚫 Thu hồi · 📦 Gói · 🩺 Status · ❓ Help |
| **Dán HWID thuần** | Wizard chọn gói → cấp `AINOVEL2` |
| Nút **✅ Cấp Key** (payment-notify) | Cấp theo gói khách đã chọn |

**Không** dùng reply keyboard dưới khung chat (đã `remove_keyboard`).

Lệnh slash vẫn dùng được: `/activate` `/lookup` `/list` `/revoke` `/plans` `/status` `/help`.

**Nếu nút “không chạy”:**
1. Redeploy bridge: `npm run telegram:deploy-bridge` (code mới + `setMyCommands`).
2. `AINOVEL_TELEGRAM_CHAT_ID` = **user id** (chat private với bot) và/hoặc group id — nhiều id cách nhau bằng dấu phẩy.
3. Gõ `/start` trong chat admin để hiện lại bàn phím + menu.

`plan` = `month` \| `year` \| `lifetime`.

## Trust layers (chống server/key giả + crack thường)

| Lớp | Việc |
|-----|------|
| **Ed25519** | Token `AINOVEL2` ký private seller; app chỉ có public key |
| **Host pin** | License API chỉ host allowlist (`ai-novel-flax.vercel.app` + `AINOVEL_LICENSE_API_HOSTS` bundled) |
| **TLS pin (optional)** | `AINOVEL_LICENSE_TLS_PINS` SPKI — `node scripts/print-license-tls-pin.mjs` |
| **Fail-closed keyring** | Packaged thiếu `public-keys` → không Pro / activate 503 |
| **Anti-tamper** | Pin kid+SPKI keyring; chặn thay public key; packaged cấm open/owner/secret leak; canary verify |

Customer `.env.commercial` **không** được mở rộng HOSTS/PINS (main.js strip + chỉ bundle).  
Attack map: `docs/ATTACK_SURFACE.md`.

## Secrets (không được lộ)

| Secret | Nơi |
|--------|-----|
| Ed25519 private | `%LOCALAPPDATA%\AI Novel Seller` + bridge `PRIVATE_KEY_B64` |
| Admin key | Vercel + `.env.local` seller |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel only |
| Telegram bot + webhook secret | Bridge Vercel |

Backup: copy cả thư mục `AI Novel Seller` ra USB/offline.  
`npm run commercial:backup-seller` (nếu có) hoặc zip thủ công.

## Revoke / hoàn tiền

1. `/admin` → tìm HWID → **Revoke**.  
2. Hoặc Supabase Table `licenses` → `status=revoked`.  
3. App khách: focus lại / heartbeat → Free.

## Trial → Pro

Activate paid token **tự promote** row trial → pro (không kẹt badge TRIAL).  
Nếu vẫn TRIAL: reload app + dán lại key `AINOVEL2.`.

## Checklist mở bán

- [ ] Bridge Telegram → token `AINOVEL2.`
- [ ] Activate → badge PRO
- [ ] Free chặn video (enforce packaged)
- [ ] `/admin` list + revoke OK
- [ ] Backup private key
- [ ] (Ship rộng) Authenticode cert

## Lệnh hữu ích

```powershell
$env:AINOVEL_LICENSE_API_URL='https://<license-api>'
$env:AINOVEL_ENTITLEMENT_ADMIN_KEY='<admin-key>'
npm run license:issue -- --hwid <HWID> --expDays 36500
npm run smoke:commercial
npm run commercial:go-live-status
npm run telegram:deploy-bridge
```
