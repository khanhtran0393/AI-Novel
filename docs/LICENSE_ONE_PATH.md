# License One-Path — AI Novel

**Nguồn chân lý** cho mọi agent / seller: **một đường license**, không `f(token)`, không private trên client.

Code: `src/lib/commercial/licenseOnePath.ts` · Status JSON: `onePath` trên `GET /api/commercial/status`.

---

## 1. Ba tầng (bắt buộc nhớ)

| Tầng | Tên | Việc | Không làm |
|------|-----|------|-----------|
| **A** | Vé (ticket) | Private **ký** `AINOVEL2…`; app **verify** public + HWID + exp | Private trên app; token = AES key |
| **B** | Sổ cái (ledger) | Supabase active/revoked/plan; heartbeat | Counter client làm authority; **quota request/ngày** (đã **loại** khỏi sản phẩm) |
| **C** | IP đắt (crown) | Cloud `/api/cloud/ip/*` (execution) | `key = hash(token)` / cắt 6–5–7 ký tự token / private client |

```text
Private (seller) ──ký──► Token (vé)
                           │
App: public verify ────────┤
                           ▼
                    Sổ cái (Supabase + heartbeat)
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     Gate API (video…)           Crown IP (cloud)
     requireFeature /            seedance / psych …
     assertPremiumHard
```

**Backdoor đã chặn:** `/api/vina-voice/synthesize|clone|runtime/synthesize|engine/start|warm` → `tts_premium` (không lách `/api/generate-tts`).

---

## 2. Luồng khách (duy nhất)

1. Logo → **Bản quyền** (`LicenseModal`).
2. Copy **HWID**.
3. **Trial** (cloud ưu tiên) hoặc dán **`AINOVEL2…`** / mã `AINOVEL-…`.
4. `POST /api/entitlement/activate` → token → `localStorage.ainovel.entitlementToken`.
5. Mọi API gửi `x-ainovel-entitlement`.
6. Badge: `GET /api/commercial/status` → `useEntitlementSync` (TRIAL → PRO → FREE).

**Cấm** đường thứ hai: card settings tự set `is_pro`, HMAC `eyJ…` cũ, derive module key từ token.

---

## 3. Private key (cấu trúc thật)

| | |
|--|--|
| Sinh | `npm run commercial:secrets` → Ed25519 |
| Private | `%LOCALAPPDATA%\AI Novel Seller\entitlement-private.pem` |
| Public packaged | `resources/license/public-keys/<kid>.pem` |
| Vai trò | **Chỉ ký** token |
| Token wire | `AINOVEL2.<kid>.<body>.<sig>` |

`kid` = `sha256(SPKI)[0:16]` — **không** phải secret.

---

## 4. Cấm / được (code-enforced list)

**Cấm** (`FORBIDDEN_UNLOCK_PATTERNS`):

- `derive_aes_from_token_text`
- `substring_token_as_module_key`
- `private_key_on_client`
- `request_count_inside_private_key`
- `client_only_request_counter_as_authority`

**Được** (`APPROVED_CONTENT_UNLOCK`):

- `cloud_ip_execution` — bridge Seedance/psych…
- `server_ttl_content_key` — future, random server secret
- `local_free_or_non_ip` — Free write/prompt/image
- `server_gate_only` — chỉ assert, không decrypt

Bridge gọi: `assertApprovedContentUnlock('cloud_ip_execution')`.

---

## 5. Entry points (không đẻ path mới)

| Việc | Path |
|------|------|
| UI | `features/license/LicenseModal.tsx` |
| Activate | `/api/entitlement/activate` |
| Status / badge | `/api/commercial/status` + `useEntitlementSync` |
| Gate route | `apiGate.requireFeature` / `assertPremiumAccessHard` |
| Matrix | `featureMatrix.ts` |
| Cloud IP | `/api/cloud/ip/*` + `src/lib/commercial/ip/*` |
| Policy module | `licenseOnePath.ts` |

Muốn thêm path → **cập nhật file này + `licenseOnePath.ts`**, không lén file commercial thứ 11.

---

## 6. Dev vs packaged

| | Dev/web | Packaged khách |
|--|---------|----------------|
| Mode | `open` (mặc định) hoặc `enforce` | **Luôn enforce** |
| Owner unlimited | `AINOVEL_OWNER_UNLIMITED=1` only | Cấm |
| Local trial vault | Có thể | Tắt mặc định |
| Crown IP | Local OK khi dev | Cloud-first (pin host) |

---

## 7. Ngoài phạm vi (đã chốt — không làm)

| Ý | Trạng thái | Lý do |
|---|------------|--------|
| **Quota request/ngày trên Supabase** | **REJECTED** | Pro trong hạn license = dùng theo gói; sổ cái chỉ active/revoked/plan/seat — không đếm lượt/ngày |
| `f(token)` / cắt ký tự token làm chìa module | **REJECTED** | Token = vé; holder token = có input chìa |
| Private key trên client / làm AES | **REJECTED** | Game over nếu lộ |
| Count + date nhét private key | **REJECTED** | Phá cặp Ed25519 / vô nghĩa |

---

## 8. Smoke

```powershell
npm run smoke:license-one-path
npm run smoke:commercial
npm run smoke:ip-catalog
```

---

## 9. Liên quan

- [`COMMERCIAL.md`](./COMMERCIAL.md) — tổng quan bán hàng  
- [`DEFENSE_LAYERS.md`](./DEFENSE_LAYERS.md) — giáp  
- [`ATTACK_SURFACE.md`](./ATTACK_SURFACE.md) — góc RE  
- [`COMMERCIAL_ADMIN.md`](./COMMERCIAL_ADMIN.md) — revoke / admin  
