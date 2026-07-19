# Hướng dẫn ship thương mại — từng bước

Làm **theo thứ tự 1 → 12**. Đánh dấu `[x]` khi xong mỗi bước.

---

## Bước 0 — Chuẩn bị máy seller (máy bạn)

### Cần có
- Windows 10/11 x64
- Node.js 20+ (`node -v`)
- Repo AI Novel đã `npm install` xong
- Tài khoản Zalo admin: **0868715114**
- (Tuỳ chọn) Bot Telegram + chat nhận tin

### Kiểm tra repo sạch
Mở PowerShell tại thư mục project:

```powershell
cd "D:\My app\AI Novel"
git status
npm run smoke:commercial
```

Kỳ vọng: `PASS smoke-commercial` / `PASS smoke-commercial-ts`.

---

## Bước 1 — Tạo secret production (bắt buộc)

### 1.1 Sinh 2 chuỗi random

```powershell
node -e "console.log('SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ADMIN=' + require('crypto').randomBytes(24).toString('hex'))"
node -e "console.log('WEBHOOK=' + require('crypto').randomBytes(24).toString('hex'))"
```

Copy 3 dòng ra **password manager** / file offline. **Không commit git.**

### 1.2 Ghi nhớ vai trò

| Biến | Ai dùng | Mục đích |
|------|---------|----------|
| `AINOVEL_ENTITLEMENT_SECRET` | App + seller | Ký / verify license HMAC |
| `AINOVEL_ENTITLEMENT_ADMIN_KEY` | **Chỉ seller** | Issue mã / API admin |
| `AINOVEL_PAYMENT_WEBHOOK_SECRET` | Webhook (tuỳ) | API thanh toán tự động |
| `AINOVEL_TELEGRAM_BOT_TOKEN` | App server | Nút «Đã thanh toán» |
| `AINOVEL_TELEGRAM_CHAT_ID` | App server | Chat nhận báo CK |

---

## Bước 2 — File `.env` máy dev (bạn code)

Tạo / sửa file `.env` **trong root project** (đã gitignore):

```env
# Dev: open để code thoải mái | Ship: xem bước 3
AINOVEL_ENTITLEMENT_MODE=open

# Có thể để trống khi open; khi test enforce thì dán SECRET thật
AINOVEL_ENTITLEMENT_SECRET=
AINOVEL_ENTITLEMENT_ADMIN_KEY=

AINOVEL_TRIAL_ENABLED=1
AINOVEL_TRIAL_DAYS=3

# KHÔNG bật trên bản bán cho khách
# AINOVEL_OWNER_UNLIMITED=1
```

Khởi động lại app dev sau khi sửa `.env`.

---

## Bước 3 — File `.env.commercial` cho bản đóng gói (bắt buộc)

### 3.1 Tạo file trên máy seller (sau khi cài app, hoặc trước khi test)

Đường dẫn chuẩn Electron:

```
%APPDATA%\ai-novel-script-generator\.env.commercial
```

PowerShell tạo nhanh:

```powershell
$dir = Join-Path $env:APPDATA "ai-novel-script-generator"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$envFile = Join-Path $dir ".env.commercial"

# DÁN secret bạn đã sinh ở Bước 1 vào dưới (thay REPLACE_ME)
@"
AINOVEL_ENTITLEMENT_MODE=enforce
AINOVEL_ENTITLEMENT_SECRET=REPLACE_ME_SECRET_32BYTES_HEX
AINOVEL_ENTITLEMENT_ADMIN_KEY=REPLACE_ME_ADMIN_KEY
AINOVEL_TRIAL_ENABLED=1
AINOVEL_TRIAL_DAYS=3
AINOVEL_TELEGRAM_BOT_TOKEN=
AINOVEL_TELEGRAM_CHAT_ID=
AINOVEL_PAYMENT_WEBHOOK_SECRET=
"@ | Set-Content -Path $envFile -Encoding utf8

notepad $envFile
```

### 3.2 Quy tắc thép
- `MODE=enforce` trên mọi bản bán
- Secret **≥ 24** ký tự, không dùng chuỗi kiểu `change-me`
- **Không** `AINOVEL_OWNER_UNLIMITED=1` trên máy khách
- Admin key **không** đưa cho khách

---

## Bước 4 — Telegram (nút «Đã thanh toán»)

### 4.1 Tạo bot
1. Mở Telegram → tìm `@BotFather`
2. `/newbot` → đặt tên → nhận **token** dạng `123456:ABC...`
3. Tạo group «AI Novel Orders» (hoặc dùng chat riêng với bot)
4. Thêm bot vào group, gửi 1 tin bất kỳ

### 4.2 Lấy chat_id

Cách đơn giản:
1. Gửi tin trong group: `/start` hoặc mention bot
2. Mở trình duyệt (đã login Telegram Web không bắt buộc):

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Tìm `"chat":{"id": -100xxxxxxxxxx` → đó là `CHAT_ID` (group thường là số âm).

### 4.3 Ghi vào `.env.commercial`

```env
AINOVEL_TELEGRAM_BOT_TOKEN=123456:ABC...
AINOVEL_TELEGRAM_CHAT_ID=-100xxxxxxxxxx
```

### 4.4 Test
1. Chạy app (dev hoặc desktop)
2. Logo → Bản quyền → chọn gói → **Đã thanh toán — báo Admin**
3. Kiểm tra group Telegram có tin: gói, HWID, nội dung CK

Nếu lỗi 503: chưa cấu hình token/chat — app sẽ gợi ý Zalo (vẫn OK nếu bạn chỉ dùng Zalo).

---

## Bước 5 — Chạy preflight code (bắt buộc)

```powershell
cd "D:\My app\AI Novel"
npm run prepare:publish
```

Gồm: typecheck + smoke core + pipeline + commercial + verify core.  
**Phải PASS hết.** Lỗi đỏ → sửa xong mới build.

Tối thiểu nếu gấp:

```powershell
npm run typecheck
npm run smoke:commercial
```

---

## Bước 6 — Build installer Windows

```powershell
cd "D:\My app\AI Novel"
npm run build:desktop
```

Hoặc portable:

```powershell
npm run pack:portable
```

### Kết quả
Thư mục `dist\`:
- `AI-Novel-1.0.0-x64.exe` (NSIS installer) hoặc portable

### Lưu ý
- Build lần đầu lâu (Next + electron-builder)
- Cần đủ dung lượng ổ đĩa
- Antivirus có thể quét — chờ xong

---

## Bước 7 — (Khuyến nghị) Code signing

Không ký → khách thấy **SmartScreen / Unknown publisher**.

```powershell
# Có file .pfx + mật khẩu
$env:CSC_LINK = "D:\certs\ainovel.pfx"
$env:CSC_KEY_PASSWORD = "mat-khau-pfx"
npm run build:desktop
```

Không có cert: vẫn bán được, nhưng hướng dẫn khách bấm «More info → Run anyway».

---

## Bước 8 — Test máy trắng (bắt buộc)

### 8.1 Máy / VM sạch
- Không clone repo, không cài Node
- Windows x64

### 8.2 Cài app
1. Copy installer từ `dist\`
2. Cài / chạy portable
3. Tạo `.env.commercial` (Bước 3) **trên máy đó** trước hoặc ngay sau lần mở đầu

### 8.3 Kịch bản Free
1. Mở app → logo **pulse** + badge **up to PRO**
2. Header có **FREE**
3. Viết / setup genre được (cần API key Gemini trong Cài đặt — BYOK)
4. CapCut / Ship / Toolbox → chặn Pro (toast rõ)

### 8.4 Trial 3 ngày
1. Logo → Bản quyền → **Dùng thử Trial 3 ngày**
2. Badge **TRIAL** / Pro-equivalent
3. Thử 1 tính năng Pro (nếu có media)
4. Máy đã trial rồi → không trial lại

### 8.5 Thanh toán giả lập + cấp key
1. Chọn gói (vd Trọn đời)
2. Copy **HWID**
3. Copy **nội dung CK** (CAP TRON DOI + HWID)
4. (Tuỳ) bấm **Đã thanh toán** → Telegram
5. Trên **máy seller** (có secret + admin):

```powershell
cd "D:\My app\AI Novel"
# Dán SECRET giống .env.commercial của bản app
$env:AINOVEL_ENTITLEMENT_MODE = "enforce"
$env:AINOVEL_ENTITLEMENT_SECRET = "SECRET_GIONG_FILE_COMMERCIAL"
$env:AINOVEL_ENTITLEMENT_ADMIN_KEY = "ADMIN_KEY_CUA_BAN"

# Cách A — mã AINOVEL (khách redeem)
npm run license:issue -- --plan vip --count 1 --note "khach-test"

# Cách B — token gắn HWID
npm run license:issue -- --token --hwid HWID_KHACH_COPY_DAY --plan vip --expDays 18250
```

6. Gửi **mã AINOVEL-…** hoặc **token** cho khách (Zalo)
7. Khách dán → **Kích hoạt ngay** → PRO/VIP
8. CapCut / Ship mở được

### 8.6 Fail-closed
- Xóa key local trong modal → về Free
- Token HWID máy khác → reject

---

## Bước 9 — Quy trình bán hàng hàng ngày (seller)

### Khi khách muốn mua
1. Khách mở logo → copy **HWID**
2. Khách chọn gói → quét QR / CK đúng **số tiền + nội dung**
3. Khách gửi **bill + HWID** Zalo **0868.715.114**  
   (hoặc bấm «Đã thanh toán» nếu Telegram đã cấu hình)
4. Seller đối soát bill
5. Seller issue key (Bước 8.5)
6. Gửi key + hướng dẫn dán kích hoạt
7. Ghi log: ngày / gói / HWID / mã đã cấp (Excel/Notion)

### Template Zalo gửi khách

```
Cảm ơn bạn đã thanh toán gói [THÁNG/NĂM/TRỌN ĐỜI].

1. Mở AI Novel → nhấp logo (góc trái)
2. Dán mã sau vào ô License Key:
   AINOVEL-XXXX-XXXX-XXXX
3. Bấm «Kích hoạt ngay»

Mã gắn máy (HWID). Máy khác cần liên hệ hỗ trợ chuyển license.
Support: Zalo 0868.715.114
```

---

## Bước 10 — Legal & trang bán

### File đã có trong repo
- `docs/LEGAL_TOS.md`
- `docs/LEGAL_PRIVACY.md`
- `docs/LEGAL_THIRD_PARTY.md`
- `docs/LEGAL_FLOW_DISCLAIMER.md`
- `docs/PRICING.md`
- `docs/INSTALL_SUPPORT.md`

### Việc bạn làm
1. Đưa nội dung (hoặc PDF) lên web / fanpage / Google Drive public
2. Trong tin nhắn bán: link **Điều khoản** + **Hướng dẫn cài**
3. Ghi rõ: khách **tự mang API key** (Gemini/OpenAI…); app không tặng quota cloud
4. Flow automation: dùng tài khoản Google của khách, rủi ro theo disclaimer

---

## Bước 11 — Phát hành bản build

1. Đặt version trong `package.json` (vd `1.0.0` → `1.0.1` khi patch)
2. `npm run prepare:publish` → `npm run build:desktop`
3. Upload installer lên kênh phân phối (Drive / website / Zalo)
4. Checksum (tuỳ):

```powershell
Get-FileHash ".\dist\AI-Novel-*.exe" -Algorithm SHA256
```

5. Ghi changelog ngắn cho khách

---

## Bước 12 — Checklist cuối (in và tick)

```
[ ] Secret + Admin key đã backup offline
[ ] .env.commercial enforce trên máy test sạch
[ ] Telegram (hoặc chỉ Zalo) đã test
[ ] prepare:publish PASS
[ ] build:desktop ra file dist\
[ ] Máy trắng: Free pulse OK
[ ] Máy trắng: Trial 3 ngày OK
[ ] Máy trắng: redeem key → PRO OK
[ ] Free bị chặn CapCut/Ship
[ ] Pro mở CapCut/Ship
[ ] Không OWNER_UNLIMITED trên bản khách
[ ] Link ToS / support Zalo đã gửi kèm
[ ] Quy trình cấp key seller đã thử 1 lần thật
```

**Tất cả `[x]` → sẵn sàng mở bán.**

---

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử |
|------------|---------|
| 403 Pro dù đã dán key | Secret app ≠ secret lúc issue; hoặc HWID khác máy |
| Token invalid | `MODE=enforce` nhưng secret trống/yếu; kiểm tra `.env.commercial` |
| Trial «đã dùng» | 1 HWID chỉ 1 lần — đúng thiết kế |
| Telegram fail | Token/chat_id sai; bot chưa được add group |
| SmartScreen chặn | Code sign hoặc hướng dẫn Run anyway |
| App không đọc `.env.commercial` | Sai path `%APPDATA%\ai-novel-script-generator\`; restart app |
| Pulse Free không thấy | Đã Pro/trial/token; hoặc OS «Giảm chuyển động» |

---

## Lệnh tóm tắt (copy nhanh)

```powershell
cd "D:\My app\AI Novel"

# 1) Secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2) Preflight
npm run prepare:publish

# 3) Build
npm run build:desktop

# 4) Issue key (seller, sau khi set env SECRET)
npm run license:issue -- --plan pro --count 1 --note "don-001"
npm run license:issue -- --token --hwid ABCDEF0123456789 --plan vip --expDays 365
```

Chi tiết kỹ thuật thêm: [`COMMERCIAL_RELEASE.md`](./COMMERCIAL_RELEASE.md) · [`COMMERCIAL.md`](./COMMERCIAL.md) · [`PRICING.md`](./PRICING.md).
