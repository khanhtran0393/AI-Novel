# Commercial ops — Free · Trial · Pro

## Seller boundary

- Sinh khóa: `npm run commercial:secrets`.
- Private key và secrets ở `%LOCALAPPDATA%\AI Novel Seller` hoặc secret manager/backend.
- Public key ở `resources/license/public-keys/` và được phép đóng gói.
- App khách tuyệt đối không có private key, admin key, webhook secret hoặc Supabase service role.

## Cấp license

```powershell
$env:AINOVEL_LICENSE_API_URL='https://<license-api>'
$env:AINOVEL_ENTITLEMENT_ADMIN_KEY='<admin-key>'
npm run license:issue -- --hwid <HWID> --expDays 30
npm run license:issue -- --hwid <HWID> --expDays 365
```

CLI gọi API one-path; API chỉ trả token sau khi `licenses.token_hash`,
`exp_at` và HWID đã được ghi thành công lên Supabase. Batch code dùng
`POST /api/entitlement/codes`; mỗi mã chỉ dành cho 1 HWID.

Pro trọn đời vẫn là `plan: pro`, dùng hạn dài theo chính sách seller.

## Telegram / cloud

Bridge Telegram dùng `AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64` trên Vercel; desktop không biết private key. Deploy bằng `npm run telegram:deploy-bridge`. Supabase migration chuẩn hóa mọi bản ghi lịch sử `vip` thành `pro`.

**Kích hoạt tay:** admin dán HWID khách (Zalo/chat) vào bot → chọn gói → copy `AINOVEL2.…` gửi khách.  
Lệnh: `/activate <hwid> [month|year|lifetime]`, `/lookup`, `/list`, `/revoke`, `/help` — chi tiết `COMMERCIAL_ADMIN.md`.

## Chuỗi phát hành

```powershell
npm run prepare:publish
npm run release:verify
npm run build:desktop
npm run commercial:white-machine
```

Các lệnh trên chỉ tạo và kiểm tra candidate local. Production **chỉ** publish bằng workflow tag `v<package.version>`; không chạy `release:publish` thủ công. Workflow cài app, kiểm tra Free/Trial/tamper, thử updater thật trên feed HTTPS tạm và chờ reviewer của environment `production` trước khi đẩy feed chính.

`release:verify` yêu cầu certificate Windows, publisher, HTTPS license API/update feed, enforce mode và quyền phân phối đầy đủ cho mọi binary/model/font.

Update feed public: `https://azlizrbjkqcyqnsmuccv.supabase.co/storage/v1/object/public/desktop-updates/latest`. `release:publish` chặn bản unsigned, sai publisher hoặc thiếu timestamp và chỉ publish metadata sau khi artifact đã tải lên thành công.

Production chỉ phát hành NSIS. Publisher và SHA-1 thumbprint chứng thư phải khớp chính xác; portable chỉ được dùng cho QA unsigned nội bộ và không bao giờ được upload vào update feed.

GitHub Actions dùng secrets của environment `signing` cho PFX/mật khẩu, repository variables cho publisher/thumbprint và environment `production` cho service-role publish. `production` phải bật required reviewer. Trial QA cloud được xóa ngay sau smoke; candidate chỉ được publish sau khi audit runtime, kiểm tra Free/Trial/tamper trên bản cài và hoàn tất tải–xác minh chữ ký–cài update thật từ feed HTTPS tạm.
