# POC — Video "nhân vật dẫn chuyện" kiểu explainer

Bản thử 21 giây, 4 beat, dựng theo style của video mẫu.

## Kết luận quan trọng nhất

**Không cần dựng project Remotion mới.** Engine `nova-remotion` sẵn có (`NovaScene` +
`NovaSequence`) làm được toàn bộ style này mà **không phải viết thêm một dòng code engine nào** —
POC này chỉ là một file JSON đút vào `inputProps`.

Nghĩa là "tầng giữa" mình nói ở phần thiết kế pipeline **đã tồn tại rồi**: chính là spec
`{ scenes, globals }`. Việc còn lại chỉ là sinh JSON đó cho đúng.

## Chạy

```bash
node editor-pro/nova-remotion/poc-narrator/make-scene.js && node editor-pro/nova-remotion/poc-narrator/render.js
```

| File | Vai trò |
|---|---|
| `ghost.json` | Nhân vật line-art — lớp `type:'svg'`, nét **tự bò ra** bằng `evolvePath` |
| `make-scene.js` | Kịch bản + mốc thời gian → `scene.json` (tầng sẽ nối vào LLM + Whisper) |
| `scene.json` | Spec thuần dữ liệu, đút thẳng vào composition `NovaSequence` |
| `render.js` | Render qua đúng đường của app: bundle + `@remotion/renderer` + chrome vendored |
| `assets/` | 7 SVG placeholder **tự vẽ** — không lấy gì từ video mẫu |

## Bốn beat, ánh xạ sang các thủ pháp của video mẫu

| Beat | Thủ pháp | Cách làm trong engine |
|---|---|---|
| 1 | Nền photoreal + nhân vật, Ken Burns | `backdrop` + `hold:kenIn` + lớp `svg` |
| 2 | 4 hình minh hoạ nảy vào lệch nhịp | 4 lớp `image`, `in:pop`, lệch `at` 0.45s |
| 3 | Cận cảnh một hình + chữ nhấn | `in:zoom` + `hold:kenIn` + `reveal:'kinetic'` |
| 4 | Thẻ dẫn nguồn trượt vào từ phải | `shape` + `text` + `image`, `in:slideR` |

Phụ đề gõ từng ký tự (`reveal:'type'`) chạy xuyên suốt — đây chính là chỗ sau này cắm
timestamp của Whisper vào.

## Ba lỗ hổng engine phát hiện khi dựng POC

### 1. `ShapeLayer` không có `boxShadow` — thẻ card không đổ bóng được
`ImageLayer`/`VideoLayer` đã có `shadowOf(st.shadow)`, riêng `ShapeLayer` thì không. Trong POC
đang phải **giả bóng bằng 2 rect chồng nhau** (`card-shadow` + `card`), tốn lớp và không mềm.

Vá trong `src/NovaScene.js`, hàm `ShapeLayer`, thêm vào object `base`:
```js
boxShadow: shadowOf(st.shadow),
```

### 2. Cutout nền trong không đổ bóng theo hình được
`boxShadow` bám theo **hộp** chứ không theo alpha, nên ảnh PNG/SVG nền trong bị lộ khung chữ nhật
(POC đã phải bỏ hẳn bóng cho 3 cutout). Style này sống bằng cutout bay vào, nên cần `drop-shadow`.

Vá trong `ImageLayer`:
```js
filter: st.dropShadow ? `drop-shadow(0 ${num(st.dropShadow,1)*14}px ${num(st.dropShadow,1)*18}px rgba(0,0,0,.35))` : undefined,
```

### 3. `revealSpread` tính theo tỉ lệ span, không theo giây
`charStyleAt` nhận `p = local/span`, nên cùng một `revealSpread` chạy ở cảnh 3s và cảnh 6s ra tốc
độ gõ chữ khác nhau — rất khó canh khi ghép với giọng đọc. Nên cho `reveal` nhận thêm
`revealDur` (giây) và quy đổi `spread = revealDur / span`.

## Còn thiếu gì để thành sản phẩm

Phần dựng hình **đã xong**. Ba mảng còn lại đều nằm *ngoài* Remotion:

1. **Asset** — mỗi video ngốn 40–80 cutout nền trong. Cần gen ảnh + tách nền tự động
   (app đã có `inpaint-bin`, cần thêm bước rembg).
2. **Nhân vật** — POC dùng ghost line-art vẽ tay bằng path. Muốn nhiều tư thế (ngồi, chỉ tay,
   nhún vai) thì làm **bộ path dựng sẵn** rẻ hơn nhiều so với gen ảnh, và không bao giờ lệch nét.
3. **Đồng bộ tiếng** — TTS rồi Whisper lấy mốc từng từ, ghi vào `at` của từng lớp.
   Hiện `at` trong POC đang là số ước lượng đặt tay.

## Dọn dẹp

`render.js` chép `assets/poc_*.svg` vào `editor-pro/nova-remotion/bundle/assets/` (bắt buộc, vì
Remotion chỉ phục vụ file nằm trong bundle). Xoá bằng:

```bash
rm -f editor-pro/nova-remotion/bundle/assets/poc_*.svg
```


---

# Vòng 2 — Rig nhân vật + bộ pose

## Đã vá vào engine

`src/CharLayer.js` (mới) + `src/rigs/ghost.js` (mới), đăng ký `char` vào `RENDERERS`
trong `src/NovaScene.js` (2 dòng). Bundle đã build lại; bản cũ giữ ở `bundle.bak-prechar/`.

Vì sao phải là lớp riêng chứ không nong vào `svg`: lớp `svg` nhận một mảng `paths[]`
phẳng, không có group, không có transform riêng từng bộ phận, và **không có khái niệm
đổi bộ phận theo frame** — mà nhép miệng thì bắt buộc cần cái đó.

## Rig: tổ hợp, không phải hình vẽ sẵn

| Bộ phận | Biến thể |
|---|---|
| Thân + chân + nếp gấp | 1 (cố định — đây là thứ giữ nhận diện) |
| Tay trái | 6 · `down` `chin` `open` `wave` `hip` `up` |
| Tay phải | 6 · `down` `open` `point` `wave` `hip` `up` |
| Mắt | 6 · `normal` `wide` `squint` `closed` `side` `sparkle` |
| Chân mày | 5 · `none` `neutral` `raised` `furrow` `worried` |
| Miệng | 6 · `neutral` `smile` `frown` `openS` `openM` `openL` |
| Phụ kiện | slot mở · `bandana-us` (cắt theo vòm đầu) |

**~30 hình vẽ tay → 6.480 pose.** Chọn pose là chọn tên, nên LLM không thể vẽ sai nét.

```json
{ "type": "char", "rig": "ghost",
  "pose": { "armL": "chin", "armR": "hip", "eyes": "side", "brow": "furrow" } }
```

### Hai thủ pháp đáng chú ý trong `ghost.js`

**Tay vẽ theo đường tâm.** Mỗi cánh tay là *một* path, renderer tô hai lượt: nét mực dày ở
dưới, nét trắng mảnh ở trên → ra hình có viền, đầu bo tròn. Vẽ tay dạng khối kín cho từng
ngón đẹp hơn chút nhưng tốn gấp ~5 công và rất dễ lệch nét giữa các biến thể.

**Chớp mắt tính theo frame, không dùng `Math.random`.** Render chạy song song nhiều worker;
random sẽ làm mỗi frame chớp một kiểu → nhân vật giật lia lịa.

## Nhép miệng — đã cắm đúng định dạng Whisper

`voice-backend/backend/engines/asr_whisper.py` trả sẵn `{"w": từ, "s": bắt đầu, "e": kết thúc}`.
`pose-demo.js` đổi thẳng danh sách đó thành `mouthTrack: [{t, v}]` (v = độ mở 0→1, đếm nguyên
âm để ước lượng). Khi cắm TTS thật thì bỏ hàm `fakeWords()` đi là xong, phần còn lại giữ nguyên.

## Còn khác gì so với nhân vật gốc của bạn

Đây là bản **vẽ lại** từ ảnh trong chat, không phải file gốc. Khác rõ nhất:

- Bàn tay đang là cục bo tròn + ngón dạng que; bản gốc có bàn tay với ngón rõ ràng
- Chân đang là ống bo tròn; bản gốc có bàn chân tạo dáng giày
- Vạt vải bản gốc có nếp mềm và mảng đổ bóng xám; bản này chỉ có 3 nét gợi nếp
- Khăn bandana bản gốc trùm rộng hơn, nút thắt bên phải to hơn

Đổi sang nét gốc **không phải làm lại rig** — chỉ thay path data trong `ghost.js`, còn
`CharLayer.js`, schema pose, chớp mắt, nhép miệng giữ nguyên.

## Chạy

```bash
node editor-pro/nova-remotion/poc-narrator/pose-sheet.js   # bảng pose (PNG)
node editor-pro/nova-remotion/poc-narrator/pose-demo.js    # clip đổi pose theo câu (MP4)
```

## Còn treo từ vòng 1

Hai bản vá `boxShadow` cho `ShapeLayer` và `drop-shadow` cho `ImageLayer` (mục trên)
**chưa làm** — vòng này chỉ đụng vào phần rig.
