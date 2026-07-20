# Bảng giá gợi ý — AI Novel

Giá tiền do **seller** tự set. Đây là ma trận quyền (sync code `PRICING_PLANS`).

| Gói | Giá | Thời hạn | Quyền chính |
|-----|-----|----------|-------------|
| Free | 0 | mãi | Viết ≤600 từ · ≤2 chương · 3 lượt/ngày; outline/prompt/TTS Edge-Piper/ảnh BYOK: 3 lượt/ngày mỗi mục |
| Trial | 0 | 3 ngày / 1 HWID | + video, CapCut, ship, TTS premium |
| Pro tháng | **478.000đ** | 30 ngày | + pipeline, multi-channel, toolbox, multi Flow |
| Pro năm | **4.780.000đ** | 365 ngày | như Pro |
| Pro trọn đời | **8.999.000đ** | không hết hạn | Toàn bộ quyền Pro, không gia hạn |

**CK:** Techcombank · STK `1903 2706 3540 18` · **TRAN HUU KHANH**  
**Nội dung động:** `AI Novel THANG|AI Novel NAM|AI Novel TRON DOI` + mã thiết bị (HWID)  
**Zalo admin:** 0868.715.114  
**Telegram admin:** cấu hình `AINOVEL_TELEGRAM_BOT_TOKEN` + `AINOVEL_TELEGRAM_CHAT_ID` — nút **Đã thanh toán** trong modal logo.
**UI:** nhấp logo app (góc trái header) → modal Bản quyền (không còn trong Cài đặt).

## Thanh toán

Webhook: `POST /api/entitlement/webhook`  
→ tạo mã `AINOVEL-…` (gửi email khách) hoặc token gắn HWID nếu checkout có HWID.

## Seller issue tay

```bash
npm run license:issue -- --plan pro --count 3 --note "batch-web"
# hoặc
curl -X POST http://localhost:3000/api/entitlement/codes \
  -H "Content-Type: application/json" \
  -d "{\"adminKey\":\"…\",\"count\":1,\"plan\":\"pro\"}"
```
