# AI Novel — Commercial readiness (Free · Trial · Pro)

Mô hình thương mại duy nhất là **License + BYOK + Free / Trial / Pro**. Tháng, năm và trọn đời chỉ là thời hạn của cùng gói Pro, không phải tier riêng.

> **One-path (bắt buộc trước khi sửa license):** [`LICENSE_ONE_PATH.md`](./LICENSE_ONE_PATH.md) · `src/lib/commercial/licenseOnePath.ts`  
> Private = **chỉ ký** · Token = **vé** (không phải chìa AES) · IP đắt = **cloud** · Status field `onePath`.

## Quyền và hiển thị

| Tier | Quyền | Badge |
|---|---|---|
| Free | Viết (≤600 từ/chương, ≤2 chương, 3 lượt/ngày), outline/prompt/ảnh BYOK/TTS Edge-Piper (mỗi mục 3 lượt/ngày) | FREE + credits |
| Trial | Quyền Trial theo ma trận, giới hạn thời gian và HWID | TRIAL |
| Pro | Video, CapCut, ship, pipeline, multi-channel, toolbox, Flow multi-account | PRO |

**Free caps (server):** `src/lib/commercial/freeLimitsPolicy.ts` + vault `data/licenses/free-usage.json` (`freeQuota.ts`). Chỉ áp khi `tier === 'free'` (enforce). **Không** đếm lượt Pro (LICENSE_ONE_PATH).

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

## Credential local

API key, cookie và session của người dùng được tách khỏi Zustand/localStorage, mã hóa bằng Electron `safeStorage` (Windows DPAPI) tại userData. Snapshot, project export và durable backup không chứa secret.

## Luồng cấp license

1. Khách lấy HWID trong modal Bản quyền.
2. Seller/backend phát hành token Pro hoặc mã `AINOVEL-…` bằng private key Ed25519.
3. App gửi mã tới license API qua HTTPS; token nhận về được kiểm tra bằng public key đóng gói.
4. Supabase là authority online cho trạng thái active/revoked; token vẫn có chữ ký để kiểm tra offline theo chính sách ứng dụng.

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
