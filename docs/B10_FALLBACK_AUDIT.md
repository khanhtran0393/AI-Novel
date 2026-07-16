# IRON B10 — Audit & purge fallback (cập nhật)

> **Quy tắc:** Xóa logic **dự phòng / fallback** nội dung–engine–platform–voice–model.  
> **Ngoại lệ duy nhất:** xoay **API key** cùng provider (429/401).  
> Lỗi → **báo thẳng** để CISO sửa config.

## Vòng 4 (2026-07-15) — Flow video model + queue

### Đã gỡ

| Trước | Nay |
|--------|-----|
| Auto-swap model T2V→I2V/reference/extend trong `payloadBuilder` | **`MODEL_MISMATCH` throw** — chọn đúng model trên UI |
| Queue multi-model T2V waterfall | **1 model**, 1 captcha `VIDEO_GENERATION` |
| Auto still (Imagen) → I2V khi T2V fail / không frame | **Throw** — gen ảnh trước hoặc chọn T2V đúng |
| I2V multi-candidate (ultra / veo_3_0 / …) | **1 model** từ UI (phải đúng family I2V) |
| Captcha ladder VIDEO→IMAGE→none | **Chỉ VIDEO_GENERATION** |
| Seedance local fill / giữ draft khi compile fail | **Throw** |
| Invent `video_prompt` từ image/sentence | **Throw** nếu thiếu field |

### Giữ (không phải fail-over)

| Hạng mục | Lý do |
|----------|--------|
| Default model **khi UI trống** theo family (T2V/I2V/ref/extend) | Giá trị khởi tạo mode, không phải “fail rồi nhảy” |
| Xoay `apiKeys[]` cùng provider | Ngoại lệ B10 |
| Retry HTTP **cùng** model khi 429/403 network (không 400) | API infra |
| Fail-fast permanent 400 / MODEL_MISMATCH | Báo thẳng, không 30s×5 |

### Cách sửa khi thấy lỗi

```
MODEL_MISMATCH: Model UI "veo_3_1_t2v_fast_ultra" thuộc nhánh T2V
nhưng endpoint đang là I2V.
Chọn model I2V (vd. veo_3_1_i2v_s_fast) trong Cấu hình Ảnh/Video.
```

1. Mở Media Config → dropdown **Video model**  
2. Có start image / ingredients → chọn model **i2v** hoặc **reference**  
3. Chỉ text → giữ **t2v**  
4. Gen lại — không còn auto-swap che lỗi

## Kiểm tra

```bash
rg -i "auto-swap|auto still|fallback|buildLocal|multi-model" src/lib/flow-bridge src/lib/integrations --glob "*.ts"
```

Expect: không còn auto-swap / auto still.
