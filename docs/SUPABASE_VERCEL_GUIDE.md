# Supabase + Vercel commercial guide

Kiến trúc: desktop local-first, license **Ed25519 + HWID**, Supabase làm authority online cho order/license/revoke. Sản phẩm chỉ có Free, Trial và Pro.

## Secret boundary

Chỉ Vercel/seller giữ `AINOVEL_ENTITLEMENT_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, admin/payment/Telegram secrets. Desktop chỉ có public key Ed25519 và anon key nếu cần.

## Database

Chạy toàn bộ file theo thứ tự trong `supabase/migrations/`. Migration `002_unify_paid_plan_pro.sql` đổi dữ liệu lịch sử `vip` thành `pro` và siết constraint còn `trial|pro`.

```powershell
npm run db:migrate:supabase
npm run cloud:bootstrap
```

RLS cho phép khách đọc dữ liệu của chính họ; mọi write license phải qua service role backend. Không đưa service role vào biến `NEXT_PUBLIC_*`.

## License flow

1. Order `month|year|lifetime` được xác nhận thanh toán.
2. Backend ghi license `trial|pro`, gắn HWID/seat và hạn.
3. Backend ký token `AINOVEL2` bằng private key Ed25519.
4. Desktop verify offline bằng public key và heartbeat online để nhận revoke/expiry.
5. Không có row active cho HWID thì về Free, kể cả token cũ còn chữ ký hợp lệ.

## Vercel seller env

```env
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_ENTITLEMENT_PRIVATE_KEY=<BASE64_PKCS8_OR_ESCAPED_PEM>
AINOVEL_ENTITLEMENT_ADMIN_KEY=<SECRET>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<SERVER_ONLY>
AINOVEL_TELEGRAM_BOT_TOKEN=<SERVER_ONLY>
AINOVEL_TELEGRAM_CHAT_ID=<SERVER_ONLY>
AINOVEL_TELEGRAM_WEBHOOK_SECRET=<SERVER_ONLY>
```

Bridge Telegram riêng dùng `AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64`. Deploy bằng `npm run telegram:deploy-bridge`.

## Production checks

- RLS active, anon không insert/update license;
- service role chỉ tồn tại trên backend;
- token sai HWID, sai signature, hết hạn hoặc revoked đều fail;
- mọi paid duration trả tier `pro`, UI không trả `vip`;
- backup/monitor/revoke và audit log có SOP vận hành.
