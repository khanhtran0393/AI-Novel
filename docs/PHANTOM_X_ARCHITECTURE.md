# Phân Tích Kiến Trúc Module Phantom-X (Enterprise Bypass Engine)

Theo yêu cầu chuẩn hóa và tái sử dụng module bảo mật nội bộ (Knowledge Transfer for Enterprise Tool Standardization), dưới đây là bản phân tích bóc tách chi tiết toàn bộ mã nguồn của động cơ **Phantom-X**. Bạn có thể dùng tài liệu này để copy nguyên lý và tham số FFmpeg sang các ứng dụng bảo mật (Enterprise IAM) khác của doanh nghiệp.

## 1. Tổng Quan Kiến Trúc Hạt Nhân (Core Architecture)

Phantom-X hoạt động dưới dạng một **FFmpeg Command Assembler** (trình lắp ráp lệnh FFmpeg). Nó nhận trạng thái từ UI (các checkbox bộ lọc, tùy chọn GPU, Grid layout) và biến dịch thành một Node-Graph FFmpeg có tính tất định cao.

Quy trình xử lý chia làm 5 Giai đoạn (Stages):
1. **Stage 1 (Input Init - Stealth P0):** Mở rộng bộ đệm `thread_queue_size` để tránh rớt khung hình, và cấu hình cờ sửa lỗi timestamp (`-fflags +genpts`).
2. **Stage 2 (Video filter_complex):** Xử lý pixel theo quy trình nghiêm ngặt (Grade → Noise → Crop/Vignette → Zoom). Cấm tuyệt đối lật khung hình (hflip/vflip) do dễ bị phát hiện.
3. **Stage 3 (Audio Mask):** Áp dụng Stealth Audio (tiêm tiếng ồn nâu nền, chorus, nắn phổ âm, v.v.).
4. **Stage 4 (Encoder & B-Frames):** Encode NVENC hoặc libx264. Cấu hình can thiệp sâu vào cấu trúc GOP, chèn B-Frames giả, và điều chỉnh CQ/CRF (Stealth P1).
5. **Stage 5 (Mux & Metadata):** Xóa toàn bộ dấu vết của thiết bị quay (EXIF), phần mềm (Lavf/Lavc), và chuẩn hóa không gian màu (Stealth P0/P3).

---

## 2. Giải Phẫu Chi Tiết Từng Hàm (Function Analysis)

### A. Hàm Điều Phối Lõi: `buildBypassEngineCommand` (buildCommand.ts)
Đây là hàm "nhạc trưởng". Nhận vào cấu hình `BypassEngineRequest` và trả ra lệnh FFmpeg hoàn chỉnh.
- **Tiền xử lý:** Gọi `probeBypassInput` để trích xuất `width, height, fps, duration, hasAudio` qua `ffprobe`.
- **Dựng Graph (Stage 2 & 3):** Gọi `buildBypassGraph` hoặc `buildGridVideoFilterParts` để tạo ra mảng các bộ lọc FFmpeg (`-filter_complex`).
- **Xử lý GPU (Stage 4):** Probe xem NVENC có hoạt động không qua `probeH264Nvenc()`. Nếu có, chèn `-c:v h264_nvenc`, thiết lập B-frames (`-bf 2`), và Constant Quality (CQ). Nếu là máy yếu (Turbo), dùng `-preset ultrafast` hoặc `p6`.
- **Dọn dẹp Metadata (Stage 5):** Thêm hàng loạt cờ `-map_metadata -1`, `-fflags +bitexact`, và ghi đè metadata trắng (`-metadata encoder=`).

### B. Hàm Tạo Lõi Pixel Video: `buildVideoFragmentsForCell` (filters.ts)
Hàm này chịu trách nhiệm sinh ra chuỗi string filter cho Video. Thứ tự xử lý là **bắt buộc** để tránh nhiễu tín hiệu:
1. **Micro Color-Space (`eq`):** Chỉnh màu trước. `eq=brightness=...:contrast=...:saturation=...:gamma=...`
2. **Dynamic Temporal Noise (`noise`):** Phủ hạt nhiễu (grain) sau khi chỉnh màu. `noise=alls=1:allf=t+u`.
3. **Phantom Sub-Pixel Shift (`crop` + `vignette`):** Cắt viền 1-2 pixel để làm lệch mã băm hình ảnh (pHash). `crop=iw-2:ih-2:x=1:y=1`. Có thể chèn thêm `vignette` tạo góc tối nhẹ.
4. **Dynamic Zoom & Pan (`zoompan`):** Phóng to siêu nhỏ. Để tiết kiệm CPU, FPS của zoom được giới hạn tối đa ở 30. `zoompan=z='min(zoom+0.0003,1.03)'...`
5. **Scale & Format:** Đưa về kích thước gốc bằng `lanczos` (nếu là quality) hoặc `fast_bilinear` (nếu là turbo) và ép chuẩn màu `bt709`.

### C. Hàm Dựng Lớp Mask Âm Thanh: `buildAudioMaskComplexParts` (filters.ts)
Che giấu mã băm âm thanh bằng một chuỗi 4 lớp (4-layer spectral mask):
1. **L1 - Noise Floor:** Tạo tiếng ồn nâu cực nhỏ (brown noise) liên tục bằng `anoisesrc`.
2. **L2 - Micro-Chorus:** Trộn tiếng ồn vào track chính, dùng `chorus` tạo hiệu ứng lệch pha mờ (phase smear).
3. **L3 - EQ Shift:** Dùng `treble` và `bass` để nắn phổ tần số âm.
4. **L4 - Dynamics & Pitch:** 
   - `adelay` (Lệch kênh trái phải 2ms chống quét mono).
   - `compand` (Làm mờ transient/tiếng trống).
   - `vibrato` (Rung âm siêu nhẹ).
   - `atempo` & `asetrate` (Đẩy tốc độ/cao độ lệch đi khoảng 0.1%).

### D. Kiến Trúc Lắp Ghép Nhiều Video (Grid): `buildGridVideoFilterParts`
Khi cần ghép (1x2, 2x1, 2x2):
- **Turbo Mode:** Video đầu vào tự động được thu nhỏ (scale mid ~1280px) để giảm tải RAM/VRAM.
- Lệnh `split` chia video gốc làm N bản copy.
- Hàm `buildTransformNode` xoay lệch (micro-rotate) từng bản copy một góc rất nhỏ (ví dụ: -3 độ, +2 độ) và cắt viền đen.
- Cuối cùng dùng `xstack` ghép các khung lại, rồi đưa khung ghép qua hàm `buildVideoFragmentsForCell` xử lý pixel tổng thể.

### E. Máy Sinh Số Giả Ngẫu Nhiên: `resolveBypassParams` (variance.ts)
Tạo tham số "biến thiên" (variance) để mỗi lần render ra một file khác nhau hoàn toàn:
- Sử dụng thuật toán `Mulberry32 PRNG` để đảm bảo tính ngẫu nhiên tất định (nếu chung một seed thì sinh ra kết quả giống nhau).
- Hàm `jitter(base, percent, rnd)` cộng trừ ngẫu nhiên một tỷ lệ % vào các thông số gốc (BYPASS_DEFAULTS).
- Việc lệch tham số CQ/CRF (Quality) được cấu hình lệch số nguyên tuyệt đối (`jitterAbsInt`), giúp thay đổi kích thước file và rate-curve đầu ra.

---

## 3. Bộ Tham Số Lõi Cần Chép (Core Defaults Formula)
Để đảm bảo hiệu quả lách (bảo vệ IP), bạn cần bê nguyên bộ thông số gốc này (trong tệp `BYPASS_DEFAULTS`) sang ứng dụng của bạn:

**Video Defaults:**
- `phantomBorder`: `1` (Cắt viền 1px = crop đi 2px)
- `vignetteAngle`: `0.628` (Tương đương PI/5)
- `noiseAlls`: `1`
- `brightness`: `0.005`, `contrast`: `1.01`, `saturation`: `1.015`, `gamma`: `0.99`
- `zoomStep`: `0.0003`, `zoomMax`: `1.03`

**Audio Defaults:**
- Lệch tempo/pitch (`atempo`, `asetrateFactor`): `1.001`
- `stereoDelayMs`: `2` (2 mili-giây)
- `vibratoFreq`: `2`, `vibratoDepth`: `0.1`
- `brownNoiseAmp`: `0.005`, `brownNoiseMixWeight`: `0.05`
- `chorusDelay`: `55` (ms)
- `trebleGainDb`: `1.5`, `trebleFreq`: `8000`
- `bassGainDb`: `-1`, `bassFreq`: `100`

**Encoder Defaults (CQ/CRF):**
- **NVENC:** `cqQuality: 19`, `cqTurbo: 26`
- **libx264:** `crfQuality: 18`, `crfTurbo: 25`
- **Cấu trúc GOP:** `gop: 47`, `keyintMin: 23`
- B-frames (`bFrames`): `2`
- Tham chiếu (`refs`): `3`

*Lưu ý Quản trị (IAM Context)*: Việc tích hợp module này lên một hệ thống khác nên tuân thủ luồng bảo mật "Zero-trust decoupling". Quá trình gen lệnh nên nằm ở backend hoặc được đóng gói biên dịch ẩn (như cách Phantom-X đang dùng `crown-seal` khóa module này không cho phép extract text ở file asar). Mọi tham số đều có biên an toàn (Ví dụ Random <= 5%) để video không bị méo mó về mặt con người nhìn thấy được.
