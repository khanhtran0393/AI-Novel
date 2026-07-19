# AI Novel — Commercial readiness (Free · Trial · Pro)

Mô hình thương mại duy nhất là **License + BYOK + Free / Trial / Pro**. Tháng, năm và trọn đời chỉ là thời hạn của cùng gói Pro, không phải tier riêng.

## Quyền và hiển thị

| Tier | Quyền | Badge |
|---|---|---|
| Free | Viết, outline, prompt, ảnh BYOK, TTS Edge cơ bản | FREE + credits |
| Trial | Quyền Trial theo ma trận, giới hạn thời gian và HWID | TRIAL |
| Pro | Video, CapCut, ship, pipeline, multi-channel, toolbox, Flow multi-account | PRO |

`is_vip` chỉ đọc snapshot/token cũ và được chuẩn hóa thành Pro. Token mới, API và UI không phát hành tier VIP.

## Trust boundary

- Token: `AINOVEL2.<kid>.<payload>.<signature>`, ký Ed25519 và gắn HWID.
- App khách chỉ đóng gói public key và endpoint HTTPS công khai.
- Private key, admin key, payment/Telegram secret và Supabase service-role chỉ nằm ở seller/backend.
- API seller/admin trả 404 trong Electron packaged.
- Electron packaged mặc định `AINOVEL_ENTITLEMENT_MODE=enforce`; trial thật do cloud cấp.

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
