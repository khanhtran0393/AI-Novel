# AI Novel — Bảng giá (trạng thái: mở miễn phí toàn bộ)

> **Cập nhật:** App đã chuyển sang **mở miễn phí cho tất cả user** — mọi tính năng (viết, prompt, ảnh, video, TTS, CapCut, ship, pipeline, toolbox, multi-channel, Flow multi-account…) đều miễn phí, không cần license, không quota ngày.
>
> `FEATURE_MATRIX` (sync code trong `src/lib/commercial/featureMatrix.ts`) không còn chặn tính năng nào.

## Giá hiện tại

| Gói | Giá | Thời hạn | Quyền |
|-----|-----|----------|-------|
| **Mở miễn phí (Open)** | **0** | mãi mãi | **Toàn bộ tính năng**, không meter, không giới hạn chương/từ |

Badge UI luôn hiển thị **PRO** (màu vàng) với credits 999.999.999. Không có popup mua/trial.

## Thông tin thanh toán cũ (đã ngừng áp dụng)

Giá cũ (chỉ để tham chiếu nếu bật lại mô hình trả phí):

| Gói cũ | Giá cũ | Quyền cũ |
|--------|--------|----------|
| Free | 0 | giới hạn lượt/ngày |
| Trial | 0 · 3 ngày | 50 lượt/ngày |
| Pro tháng | 478.000đ · 30 ngày | toàn bộ Pro |
| Pro năm | 4.780.000đ · 365 ngày | như Pro |
| Pro trọn đời | 8.999.000đ | toàn bộ Pro |

## Bật lại mô hình trả phí

Xem phần "Bật lại mô hình trả phí" trong [`COMMERCIAL.md`](./COMMERCIAL.md) — bao gồm `entitlement.ts`, `featureMatrix.ts`, `main.js`, `useEntitlementSync.ts`, rebuild `main.jsc`.

## Seller issue tay (chỉ khi đã bật lại)

```bash
AINOVEL_LICENSE_API_URL=https://<license-api> \
AINOVEL_ENTITLEMENT_ADMIN_KEY=<admin-key> \
npm run license:issue -- --hwid <HWID> --expDays 365
```
