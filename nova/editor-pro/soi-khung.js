/* ══ SOI KHUNG HÌNH CỤC BỘ ════════════════════════════════════════════════════
   Cùng việc với bannedRanges (tìm khung có mặt người / chữ để né khi cắt),
   nhưng chạy bằng HAI MÔ HÌNH ONNX NHỎ ngay trong máy thay vì gửi ảnh lên
   Vision API.

   Vì sao đổi: bản Vision mất ~8 giây và tốn tiền mỗi clip, nên phải để
   `vision:false` mặc định — tức là gần như KHÔNG clip nào được soi. Bản cục bộ
   rẻ và nhanh đủ để bật cho mọi clip.

   Bê từ renderer/video-suitability của Fractal, đổi từ onnxruntime-web (chạy
   trong trình duyệt, đọc ảnh qua Canvas) sang onnxruntime-node (tiến trình
   chính, đọc ảnh thô từ ffmpeg) — Nova đã dùng onnxruntime-node cho MI-GAN.

     ultraface-rfb-320.onnx  1,1 MB  dò mặt người   vào 'input' → ra scores, boxes
     dbnet-mobile.onnx       4,5 MB  dò chữ/phụ đề  vào 'x'     → ra sigmoid_0.tmp_0
*/
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { FFMPEG } = require('./ff-path');

/* Giải đường dẫn giống _miganPath của upscale-native: onnx-bin được asarUnpack
   nên khi đóng gói nó nằm ở app.asar.unpacked, không đọc thẳng trong asar. */
const MO_HINH = (ten) => {
  const goc = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
  const thu = [
    path.join(goc, '..', 'onnx-bin', ten),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'onnx-bin', ten),
    path.join(process.resourcesPath || '', 'onnx-bin', ten),
  ];
  for (const p of thu) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
};

const MAT_W = 320, MAT_H = 240;          // UltraFace nhận đúng cỡ này
const MAT_TIN = 0.7;                      // ngưỡng tin cậy
const MAT_NMS = 0.3, MAT_TOPK = 16;
const CHU_NGUONG = 0.3;                   // ngưỡng mặt nạ chữ của DBNet
const CHU_W = 320, CHU_H = 320;
const MAU_MOI = 0.75;                     // lấy mẫu mỗi 0,75 giây
const CUA_SO = 2.0;                       // gom kết quả theo cửa sổ 2 giây
const TI_LE_CAM = 0.35;                   // >35% mẫu xấu → cấm cửa sổ
const NOI_DAI = 0.5;                      // nới mỗi đầu 0,5 giây

let _ort = null, _sMat = null, _sChu = null;
async function _nap() {
  if (!_ort) { _ort = require('onnxruntime-node'); try { _ort.env.logLevel = 'fatal'; } catch (_) {} }
  if (!_sMat) {
    const p = MO_HINH('ultraface-rfb-320.onnx');
    if (!p) throw new Error('thiếu ultraface-rfb-320.onnx');
    _sMat = await _ort.InferenceSession.create(p, { logSeverityLevel: 4 });
  }
  if (!_sChu) {
    const p = MO_HINH('dbnet-mobile.onnx');
    if (!p) throw new Error('thiếu dbnet-mobile.onnx');
    _sChu = await _ort.InferenceSession.create(p, { logSeverityLevel: 4 });
  }
}

/* Trích TOÀN BỘ khung mẫu bằng MỘT lượt ffmpeg, xuất RGB thô — nhanh hơn
   nhiều so với ghi từng file PNG rồi đọc lại như bannedRanges đang làm. */
function _layKhung(file, w, h, fps) {
  return new Promise((res) => {
    const a = ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `fps=${fps},scale=${w}:${h}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'];
    const cp = spawn(FFMPEG, a, { windowsHide: true });
    const buf = []; let n = 0;
    const het = setTimeout(() => { try { cp.kill(); } catch (_) {} }, 60000);
    cp.stdout.on('data', (d) => { buf.push(d); n += d.length; });
    cp.on('error', () => { clearTimeout(het); res([]); });
    cp.on('close', () => {
      clearTimeout(het);
      const all = Buffer.concat(buf, n);
      const cỡ = w * h * 3, so = Math.floor(all.length / cỡ);
      const ra = [];
      for (let i = 0; i < so; i++) ra.push(all.subarray(i * cỡ, (i + 1) * cỡ));
      res(ra);
    });
  });
}

const _dienTich = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function _iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const giao = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const hop = _dienTich(a) + _dienTich(b) - giao;
  return hop > 0 ? giao / hop : 0;
}
function _nms(ds, nguong, topK) {
  const s = ds.slice().sort((x, y) => y.diem - x.diem); const giu = [];
  for (const d of s) {
    if (giu.length >= topK) break;
    if (giu.every((g) => _iou(g.box, d.box) < nguong)) giu.push(d);
  }
  return giu;
}

async function _soiMat(rgb) {
  const t = new Float32Array(3 * MAT_H * MAT_W);
  const mp = MAT_W * MAT_H;
  for (let i = 0, px = 0; px < mp; i += 3, px += 1) {
    t[px] = (rgb[i] - 127) / 128;
    t[mp + px] = (rgb[i + 1] - 127) / 128;
    t[mp * 2 + px] = (rgb[i + 2] - 127) / 128;
  }
  const r = await _sMat.run({ input: new _ort.Tensor('float32', t, [1, 3, MAT_H, MAT_W]) });
  const sc = r.scores.data, bx = r.boxes.data;
  const n = sc.length / 2, ds = [];
  for (let i = 0; i < n; i++) {
    const d = sc[i * 2 + 1];                         // [nền, mặt]
    if (d < MAT_TIN) continue;
    ds.push({ diem: d, box: [bx[i * 4], bx[i * 4 + 1], bx[i * 4 + 2], bx[i * 4 + 3]] });
  }
  const giu = _nms(ds, MAT_NMS, MAT_TOPK);
  // Mặt CHIẾM KHUNG mới đáng lo (người nói trước camera); mặt bé trong đám
  // đông thì b-roll vẫn dùng được.
  const lon = giu.reduce((m, d) => Math.max(m, _dienTich(d.box)), 0);
  return { so: giu.length, toNhat: lon };
}

async function _soiChu(rgb) {
  const t = new Float32Array(3 * CHU_H * CHU_W);
  const mp = CHU_W * CHU_H;
  // DBNet chuẩn ImageNet
  const TB = [0.485, 0.456, 0.406], DL = [0.229, 0.224, 0.225];
  for (let i = 0, px = 0; px < mp; i += 3, px += 1) {
    t[px] = (rgb[i] / 255 - TB[0]) / DL[0];
    t[mp + px] = (rgb[i + 1] / 255 - TB[1]) / DL[1];
    t[mp * 2 + px] = (rgb[i + 2] / 255 - TB[2]) / DL[2];
  }
  const r = await _sChu.run({ x: new _ort.Tensor('float32', t, [1, 3, CHU_H, CHU_W]) });
  const m = r[Object.keys(r)[0]].data;
  let dem = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > CHU_NGUONG) dem++;
  return { tiLe: m.length ? dem / m.length : 0 };
}

/* Trả MẢNG dải cấm [{start,end}] — cùng hình dạng bannedRanges để thay thẳng. */
async function soiKhung(file, mediaDur, opts = {}) {
  await _nap();
  const fps = 1 / MAU_MOI;
  const [khungMat, khungChu] = await Promise.all([
    _layKhung(file, MAT_W, MAT_H, fps),
    _layKhung(file, CHU_W, CHU_H, fps),
  ]);
  const n = Math.min(khungMat.length, khungChu.length);
  if (!n) return Object.assign([], { offTopic: false, soKhung: 0 });

  const xau = [];
  for (let i = 0; i < n; i++) {
    const [mat, chu] = await Promise.all([_soiMat(khungMat[i]), _soiChu(khungChu[i])]);
    // Xấu khi: có mặt chiếm ≥4% khung, HOẶC vùng chữ ≥1,5% khung.
    const coMat = mat.so > 0 && mat.toNhat >= 0.04;
    const coChu = chu.tiLe >= 0.015;
    xau.push(coMat || coChu);
  }

  // Gom theo cửa sổ 2 giây, cấm cửa sổ có hơn 35% mẫu xấu.
  const dai = [];
  const mauMoiCua = Math.max(1, Math.round(CUA_SO / MAU_MOI));
  for (let i = 0; i < n; i += mauMoiCua) {
    const lat = xau.slice(i, i + mauMoiCua);
    const ti = lat.filter(Boolean).length / lat.length;
    if (ti > TI_LE_CAM) {
      dai.push({ start: Math.max(0, i * MAU_MOI - NOI_DAI),
                 end: Math.min(mediaDur || (n * MAU_MOI), (i + lat.length) * MAU_MOI + NOI_DAI) });
    }
  }
  // Gộp dải liền nhau
  const gop = [];
  for (const d of dai) {
    const c = gop[gop.length - 1];
    if (c && d.start <= c.end + 0.05) c.end = Math.max(c.end, d.end);
    else gop.push({ start: +d.start.toFixed(2), end: +d.end.toFixed(2) });
  }
  const ra = gop;
  ra.offTopic = false;              // dò cục bộ KHÔNG biết chủ đề — việc đó vẫn cần AI
  ra.soKhung = n;
  ra.soXau = xau.filter(Boolean).length;
  return ra;
}

module.exports = { soiKhung };
