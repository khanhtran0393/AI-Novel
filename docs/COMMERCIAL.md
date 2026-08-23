# AI Novel — Mở miễn phí toàn bộ tính năng (Open / Free-for-all)

> **Trạng thái hiện tại (LOCKED):** App đã chuyển sang chế độ **mở miễn phí (open)** — **mọi user dùng mọi tính năng miễn phí**, không còn gate Free/Trial/Pro chặn quyền truy cập.
>
> - `getEntitlementMode()` luôn trả `'open'` (mọi runtime, kể cả Electron packaged).
> - `resolvePlanTier()` luôn trả `'pro'`; `FEATURE_MATRIX` không còn hàng `serverGated`.
> - Mọi gate server (`assertProAccess`, `requireFeature`, `assertAndConsumeFreeQuota`, …) là **no-op / always-grant**.
> - UI luôn hiển thị badge **PRO** và credits 999.999.999.

## Mô hình cũ (đã tắt) — Free / Trial / Pro

Mô hình thương mại cũ là **License + BYOK + Free / Trial / Pro**; tháng, năm và trọn đời chỉ là thời hạn của cùng gói Pro. Toàn bộ logic cũ vẫn còn trong mã (để tham chiếu / có thể bật lại) nhưng **không còn gate bất kỳ tính năng nào**:

| Tier (cũ) | Quyền cũ | Badge cũ |
|---|---|---|
| Free | Viết ≤600 từ/chương, ≤5 chương, 20 lượt/ngày, outline/prompt/ảnh BYOK/TTS Edge-Piper | FREE + credits |
| Trial | Gen video, CapCut, ship, TTS premium · 3 ngày / 1 HWID · 50 lượt/ngày · ≤3000 từ/chương · ≤20 chương | TRIAL |
| Pro | Video, CapCut, ship, pipeline, multi-channel, toolbox, Flow multi-account — không meter | PRO |

## Thực tế hiện tại (open)

| Hạng mục | Hành vi |
|----------|---------|
| Tier trả về | Luôn `'pro'` (client + server) |
| Mode entitlement | Luôn `'open'` (kể cả Electron packaged — `main.js` force `open`) |
| Server gate | `assertProAccess` / `assertFeatureAccess` / `requireFeature` / `requireTier` → always-grant |
| Free quota | `freeLimitsApply` → `{applies:false, tier:'pro'}`; `assertAndConsumeFreeQuota` → null |
| Word/chương cap | Không áp (50.000 từ/chương · 500 chương kỹ thuật, không gate) |
| UI | Badge **PRO** cố định · credits 999.999.999 · không popup mua/trial |
| License | Vẫn giữ cơ chế ký Ed25519 / HWID / Supabase để tương thích + audit — **không** chặn quyền |
| Labyrinth / mirage | Giữ nguyên — chống bypass/tamper; **không phải** gate commercial, không phá |

## Tại sao giữ License/HWID/Supabase/Labyrinth?

- **Tương thích snapshot & token cũ**: dữ liệu `is_vip`/token cũ vẫn đọc được, không crash.
- **One-path license** (`docs/LICENSE_ONE_PATH.md`): chính sách vé/ledger/crown vẫn là chuẩn nếu sau này bật lại bán hàng.
- **Labyrinth / mirage** (`src/lib/commercial/labyrinth/*`): cơ chế chống bypass bẻ khóa, độc lập với việc có bán hay không — tamper vẫn bị dẫn vào handler decoy. **Cấm** gỡ.
- **Audit & legal**: còn đủ dấu vết nếu cần chuyển sang mô hình trả phí sau.

## Bật lại mô hình trả phí (nếu sau này cần)

1. `src/lib/entitlement.ts`: bỏ dòng `return 'open'` cứng → trả theo env `AINOVEL_ENTITLEMENT_MODE`.
2. `src/lib/commercial/featureMatrix.ts`: `resolvePlanTier` → theo flags/token thật; phục hồi `SERVER_GATED_FEATURES`.
3. `main.js` + `temp-asar-patch/main.js`: đổi `'open'` → `'enforce'` (hoặc xóa dòng force).
4. `useEntitlementSync.ts`: bỏ force Pro/credits.
5. Rebuild `main.jsc` bằng `node scripts/build-bytenode-main.cjs`.
6. Chạy lại chuỗi smoke + `npm run verify:agent-done`.

## Bảo mật / trust boundary (giữ nguyên)

- App khách chỉ đóng gói public key và endpoint HTTPS công khai.
- Private key, admin key, payment/Telegram secret và Supabase service-role chỉ nằm ở seller/backend.
- API seller/admin trả 404 trong Electron packaged.
- Credential người dùng vẫn tách khỏi Zustand/localStorage, mã hóa `safeStorage` (Windows DPAPI).

## Release gate

```powershell
npm run prepare:publish
npm run release:verify
npm run build:desktop
```

Tài liệu vận hành liên quan: `COMMERCIAL_ADMIN.md` · `COMMERCIAL_OPS.md` · `COMMERCIAL_RELEASE.md` · `SHIP_GUIDE.md` · `THIRD_PARTY_MANIFEST.md`.
