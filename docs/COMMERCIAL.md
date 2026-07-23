# AI Novel — Commercial readiness (Free · Trial · Pro)

Mô hình thương mại duy nhất là **License + BYOK + Free / Trial / Pro**. Tháng, năm và trọn đời chỉ là thời hạn của cùng gói Pro, không phải tier riêng.

> **One-path (bắt buộc trước khi sửa license):** [`LICENSE_ONE_PATH.md`](./LICENSE_ONE_PATH.md) · `src/lib/commercial/licenseOnePath.ts`  
> Private = **chỉ ký** · Token = **vé** (không phải chìa AES) · IP đắt = **cloud** · Status field `onePath`.

## Quyền và hiển thị

| Tier | Quyền | Badge |
|---|---|---|
| Free | Viết (≤600 từ/chương, ≤2 chương, 3 lượt/ngày), outline/prompt/ảnh BYOK/TTS Edge-Piper (mỗi mục 3 lượt/ngày) | FREE + credits |
| Trial | **Như Pro** · 7 ngày / 1 HWID · 5 lượt/ngày mỗi mục (viết·outline·prompt·ảnh·TTS Edge/Piper) · ≤**3000** từ/chương · ≤10 chương | TRIAL |
| Pro | Video, CapCut, ship, pipeline, multi-channel, toolbox, Flow multi-account — không meter lượt | PRO |

**Free + Trial caps (server):** `src/lib/commercial/freeLimitsPolicy.ts` (`FREE_LIMITS` · `TRIAL_LIMITS`) + machine vault ngoài folder portable (`licenseMachineStore.ts` → `%USER_DATA%/.ainovel-license/` hoặc `~/.ainovel-license/`: `free-usage.json`, `trials.json`) + stamp phụ Windows HKCU. **Cấm** tin vault trong folder app (xóa+giải nén lại không reset). Áp khi `tier === 'free' | 'trial'`. **Không** đếm lượt Pro (LICENSE_ONE_PATH).

`is_vip` chỉ đọc snapshot/token cũ và được chuẩn hóa thành Pro. Token mới, API và UI không phát hành tier VIP.

## Trust boundary

- Token: `AINOVEL2.<kid>.<payload>.<signature>`, ký Ed25519 và gắn HWID (v2 MachineGuid preferred; verify dual-accept v1).
- App khách chỉ đóng gói public key và endpoint HTTPS công khai.
- Private key, admin key, payment/Telegram secret và Supabase service-role chỉ nằm ở seller/backend.
- API seller/admin trả 404 trong Electron packaged.
- Electron packaged **force** `AINOVEL_ENTITLEMENT_MODE=enforce` (env / `.env.commercial` **không** mở được Pro).
- Server gate: video, CapCut, ship, integrations, toolbox NAV, TTS premium, multi-channel, Flow multi-account — xem [`DEFENSE_LAYERS.md`](./DEFENSE_LAYERS.md).
- UI `is_pro` / credits chỉ cosmetic; authorization = token + `assertFeatureAccess` / `assertProAccess`.

Backend production hiện dùng `https://ai-novel-flax.vercel.app` với Supabase là authority và Ed25519 để verify offline.

**`licenses.user_id` = mã thiết bị (HWID)** của app user (desktop), không phải uuid `auth.users`. Cùng chuẩn hóa lowercase với cột `hwid`. Migration: `supabase/migrations/003_licenses_user_id_device.sql` · backfill: `npx tsx scripts/backfill-license-user-id-device.mts`.

## Credential local

API key, cookie và session của người dùng được tách khỏi Zustand/localStorage, mã hóa bằng Electron `safeStorage` (Windows DPAPI) tại userData. Snapshot, project export và durable backup không chứa secret.

## Luồng cấp license

1. Khách lấy HWID trong modal Bản quyền.
2. Seller/backend **ghi row `licenses` active** trên Supabase + phát hành token Pro hoặc mã `AINOVEL-…` (Ed25519).
3. App gửi mã tới license API qua HTTPS; activate **chỉ bind** token vào row đã có — **không** tự INSERT khi thiếu ledger.
4. **Supabase = sole truth:** không có row active (xóa / revoked / expired) = Free (ban hoặc hết hạn). Token local không self-heal Pro khi ledger trống.

## Bản public core sạch

Installer thương mại không chứa thành phần development-only chưa có đầy đủ quyền phân phối: FFmpeg/Piper local, Vina Voice ONNX, MediaCrawler, audio tham chiếu và font gốc chưa xác minh. FableCut được giữ cùng MIT/OFL notices. Thiếu thành phần phải hard-fail rõ ràng, không fallback provider/engine.

## Release gate

```powershell
npm run prepare:publish
npm run release:verify
npm run build:desktop
```

`release:verify` fail-closed nếu thiếu feed update HTTPS thật, license API HTTPS, chứng thư/publisher Windows hoặc còn blocker trong manifest. License API đã có; auto-update chỉ bật sau khi phát hành installer ký số lên feed thật.

Tài liệu vận hành: `COMMERCIAL_ADMIN.md` (admin HWID/revoke) · `COMMERCIAL_OPS.md` · `COMMERCIAL_RELEASE.md` · `SHIP_GUIDE.md` · `THIRD_PARTY_MANIFEST.md`.
