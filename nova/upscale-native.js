/*
 * upscale-native.js — Nâng cấp ảnh (Real-ESRGAN, local & offline).
 *   - Dùng binary realesrgan-ncnn-vulkan (GPU: Metal/Vulkan) bundle trong upscaler-bin/.
 *   - KHÔNG gửi ảnh lên mạng, không cần Python. Miễn phí, không dính reCAPTCHA của Flow.
 *   - Chạy tuần tự từng ảnh, báo tiến độ qua sự kiện 'upscale-progress'.
 */
const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

// Thư mục chứa binary + models. Khi đóng gói (asar) trỏ vào bản unpack.
function baseDir() {
  // Đóng gói: mã chạy trong app.asar nhưng upscaler-bin nằm ở app.asar.unpacked (asarUnpack).
  // Dev (npm start): __dirname là thư mục nguồn thật. Dùng ĐÚNG mẫu như ffmpeg-static/native-tools/main.js.
  const real = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
  const dir = path.join(real, 'upscaler-bin');
  if (fs.existsSync(dir)) return dir;
  // dự phòng: một số cấu hình đóng gói khác
  try { const alt = path.join(process.resourcesPath, 'app.asar.unpacked', 'upscaler-bin'); if (fs.existsSync(alt)) return alt; } catch (_) {}
  return dir;
}
function binaryPath() {
  const exe = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';
  return path.join(baseDir(), exe);
}
function modelsPath() { return path.join(baseDir(), 'models'); }

// Gỡ cờ cách ly (Gatekeeper) cho binary trên macOS — tránh "không mở được".
let _unquarantined = false;
function ensureRunnable() {
  const bin = binaryPath();
  try { fs.chmodSync(bin, 0o755); } catch (_) {}
  if (process.platform === 'darwin' && !_unquarantined) {
    _unquarantined = true;
    try { require('child_process').execFileSync('xattr', ['-dr', 'com.apple.quarantine', baseDir()]); } catch (_) {}
  }
}

function probe() {
  const bin = binaryPath();
  const ok = fs.existsSync(bin);
  let models = [];
  try {
    models = fs.readdirSync(modelsPath()).filter(f => f.endsWith('.param')).map(f => f.replace('.param', ''));
  } catch (_) {}
  return { ok, bin, models };
}

// --- Đọc kích thước ảnh (không cần thư viện): parse header PNG/JPEG/WEBP/BMP ---
function imageDim(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    // PNG
    if (n > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // BMP
    if (n > 26 && buf[0] === 0x42 && buf[1] === 0x4D) {
      return { w: buf.readInt32LE(18), h: buf.readInt32LE(22) };
    }
    // WEBP (VP8X / VP8 / VP8L)
    if (n > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { w: 1 + ((buf[24] | (buf[25] << 8) | (buf[26] << 16))), h: 1 + ((buf[27] | (buf[28] << 8) | (buf[29] << 16))) };
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') { const b = buf; const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
    }
    // JPEG — duyệt các segment tìm SOF
    if (n > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let o = 2;
      while (o + 9 < n) {
        if (buf[o] !== 0xFF) { o++; continue; }
        const marker = buf[o + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        }
        o += 2 + buf.readUInt16BE(o + 2);
      }
    }
  } catch (_) {}
  return { w: 0, h: 0 };
}

function expandPaths(paths) {
  const out = [];
  const seen = new Set();
  const add = (f) => { const k = path.resolve(f); if (!seen.has(k)) { seen.add(k); out.push(k); } };
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      try { fs.readdirSync(p).forEach(name => walk(path.join(p, name))); } catch (_) {}
    } else if (IMG_EXTS.includes(path.extname(p).toLowerCase())) {
      add(p);
    }
  };
  (paths || []).forEach(walk);
  return out.map(p => ({ path: p, name: path.basename(p), ...imageDim(p) }));
}

async function pickImages() {
  const r = await dialog.showOpenDialog({
    title: 'Chọn ảnh cần nâng cấp',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  });
  if (r.canceled) return [];
  return expandPaths(r.filePaths);
}
async function pickFolderImages() {
  const r = await dialog.showOpenDialog({ title: 'Chọn thư mục ảnh', properties: ['openDirectory'] });
  if (r.canceled) return [];
  return expandPaths(r.filePaths);
}
async function pickOutputDir() {
  const r = await dialog.showOpenDialog({ title: 'Chọn thư mục lưu', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  return r.filePaths[0];
}

const procs = new Set();
let cancelled = false;

function cancel() {
  cancelled = true;
  for (const p of procs) { try { p.kill('SIGKILL'); } catch (_) {} }
  procs.clear();
  return { ok: true };
}

// Chạy realesrgan cho 1 ảnh. Báo tiến độ % qua stderr.
function runOne(input, outPath, opts, jobId, win) {
  return new Promise((resolve, reject) => {
    const args = ['-i', input, '-o', outPath, '-n', opts.model, '-s', String(opts.scale), '-f', opts.format, '-m', modelsPath()];
    if (opts.tile && Number(opts.tile) > 0) args.push('-t', String(opts.tile));
    if (opts.gpu != null && String(opts.gpu) !== '') args.push('-g', String(opts.gpu));

    const proc = spawn(binaryPath(), args);
    procs.add(proc);
    let errTail = '';   // gom stderr để biết LÝ DO thật (Vulkan/GPU/DLL…), không chỉ mã lỗi trơ
    proc.stderr.on('data', (data) => {
      const s = String(data);
      errTail = (errTail + s).slice(-1200);
      const m = s.match(/(\d+(?:\.\d+)?)%/g);
      if (m && m.length && win && !win.isDestroyed()) {
        win.webContents.send('upscale-progress', { id: jobId, type: 'tick', percent: parseFloat(m[m.length - 1]) });
      }
    });
    proc.on('error', (err) => {
      procs.delete(proc);
      reject(new Error('Không chạy được Real-ESRGAN (' + (err.code || err.message) + ') — có thể thiếu "Microsoft Visual C++ 2015-2022 Redistributable x64" hoặc driver GPU/Vulkan.'));
    });
    proc.on('close', (code) => {
      procs.delete(proc);
      if (cancelled) return resolve({ cancelled: true });
      if (code === 0) return resolve({ ok: true });
      const tail = errTail.replace(/\s+/g, ' ').trim();
      let hint = '';
      if (/vulkan|vk[A-Z]|no gpu|gpu.*not|physical device|device.*not/i.test(tail)) hint = ' — MÁY KHÔNG CÓ GPU/Vulkan hỗ trợ (Real-ESRGAN cần GPU rời hoặc GPU tích hợp có driver Vulkan mới). Cập nhật driver GPU hoặc chạy máy có GPU.';
      else if (code === 3221225781 || code === 3221225595 || code === -1073741515) hint = ' — THIẾU DLL runtime. Cài "Microsoft Visual C++ 2015-2022 Redistributable x64".';
      reject(new Error('Real-ESRGAN lỗi mã ' + code + (tail ? (' · ' + tail.slice(-260)) : '') + hint));
    });
  });
}

// ffmpeg-static để co ảnh về đúng độ phân giải mục tiêu (và đổi định dạng).
function ffmpegPath() {
  try { let p = require('ffmpeg-static'); if (p) return p.replace('app.asar', 'app.asar.unpacked'); } catch (_) {}
  return null;
}
function resizeTo(input, outPath, w, h) {
  return new Promise((resolve, reject) => {
    const ff = ffmpegPath();
    if (!ff) return reject(new Error('Thiếu ffmpeg'));
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', '-update', '1', outPath];
    const proc = spawn(ff, args);
    procs.add(proc);
    proc.on('error', (err) => { procs.delete(proc); reject(err); });
    proc.on('close', (code) => { procs.delete(proc); if (cancelled) return resolve({ cancelled: true }); code === 0 ? resolve({ ok: true }) : reject(new Error('ffmpeg lỗi mã ' + code)); });
  });
}

// Tính cỡ ra sao cho CẠNH DÀI = target, giữ tỉ lệ; làm tròn về số chẵn.
function fitLongEdge(w, h, target) {
  if (!w || !h) return { w: target, h: target };
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (w >= h) return { w: even(target), h: even(target * h / w) };
  return { w: even(target * w / h), h: even(target) };
}

function _ffOnce(args) {
  return new Promise((resolve, reject) => {
    const ff = ffmpegPath(); if (!ff) return reject(new Error('Thiếu ffmpeg'));
    const proc = spawn(ff, args); procs.add(proc);
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => { procs.delete(proc); reject(e); });
    proc.on('close', code => { procs.delete(proc); code === 0 ? resolve(true) : reject(new Error('ffmpeg lỗi ' + code + ': ' + err.slice(-200))); });
  });
}

/*
 * runUpscale(payload, win)
 *   payload = { items:[{id, path}], outputDir, suffix, model, tile, format, gpu,
 *               target: <cạnh dài mục tiêu px, vd 1920/2560/3840> }
 *   format: 'png' | 'jpg' | 'webp' | 'source' (giữ đuôi ảnh gốc)
 * Với mỗi ảnh: phóng AI bằng Real-ESRGAN (2×/3×/4× tuỳ mô hình) rồi ffmpeg co/nới
 * đúng độ phân giải mục tiêu theo cạnh dài. Nếu ảnh đã lớn hơn mục tiêu thì chỉ co xuống.
 */
// ── AI INPAINT xoá dấu ✦ bằng MI-GAN (onnxruntime-node) — sạch cả khi ✦ đè lên vật ──
let _ort = null, _miganSession = null, _miganTried = false;
function _miganPath() {
  const real = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
  const p = path.join(real, 'inpaint-bin', 'migan.onnx');
  if (fs.existsSync(p)) return p;
  try { const alt = path.join(process.resourcesPath, 'app.asar.unpacked', 'inpaint-bin', 'migan.onnx'); if (fs.existsSync(alt)) return alt; } catch (_) {}
  return p;
}
function miganAvailable() { try { return fs.existsSync(_miganPath()); } catch (_) { return false; } }
async function _miganSess() {
  if (_miganSession) return _miganSession;
  if (!_ort) _ort = require('onnxruntime-node');
  _miganSession = await _ort.InferenceSession.create(_miganPath());
  return _miganSession;
}
// Inpaint 1 vùng box (toạ độ tuyệt đối {x0,y0,x1,y1}) trên ảnh input → trả file PNG đã xoá (hoặc null).
// Cắt vùng vuông quanh box (gấp ~3 lần) → resize 512 → MI-GAN → dán trả về ĐÚNG vùng đó (phần còn lại giữ nguyên).
async function _miganInpaint(input, box, jobId) {
  const S = 512;
  const dim = imageDim(input); const W = dim.w, H = dim.h;
  if (!W || !H) return null;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  // Crop vuông quanh box: đủ ngữ cảnh nhưng KHÔNG quá to (crop to → thu về 512 mất nét → smudge).
  let side = Math.max(Math.round(Math.max(bw, bh) * 2.3), 96);
  side = Math.min(side, Math.min(W, H), Math.round(Math.max(bw, bh)) + 640);   // giới hạn để 512 không bị thu quá mạnh
  const cx = Math.round((box.x0 + box.x1) / 2), cy = Math.round((box.y0 + box.y1) / 2);
  let rx = Math.max(0, Math.min(cx - Math.round(side / 2), W - side));
  let ry = Math.max(0, Math.min(cy - Math.round(side / 2), H - side));
  const stamp = `${process.pid}_${jobId}`;
  const rawIn = path.join(os.tmpdir(), `ip_in_${stamp}.raw`);
  const rawOut = path.join(os.tmpdir(), `ip_out_${stamp}.raw`);
  const patch = path.join(os.tmpdir(), `ip_patch_${stamp}.png`);
  const maskf = path.join(os.tmpdir(), `ip_mask_${stamp}.png`);
  const out = path.join(os.tmpdir(), `ip_final_${stamp}.png`);
  try {
    await _ffOnce(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vf', `crop=${side}:${side}:${rx}:${ry},scale=${S}:${S}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawIn]);
    const rgb = fs.readFileSync(rawIn);
    if (rgb.length !== S * S * 3) return null;
    const sc = S / side;
    const hx0 = Math.max(0, Math.floor((box.x0 - rx) * sc)), hy0 = Math.max(0, Math.floor((box.y0 - ry) * sc));
    const hx1 = Math.min(S, Math.ceil((box.x1 - rx) * sc)), hy1 = Math.min(S, Math.ceil((box.y1 - ry) * sc));
    const mask = new Float32Array(S * S).fill(1);
    for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) mask[y * S + x] = 0;
    // Đo độ PHẲNG của vành ngoài hộp ✦: nền trơn (trắng/màu đơn) → TÔ ĐẶC bằng màu nền (MI-GAN tự chế ra xám → vệt); nền có vật/kết cấu → mới MI-GAN.
    let sr = 0, sg = 0, sb = 0, nc = 0, minL = 255, maxL = 0; const RR = 24;
    for (let y = Math.max(0, hy0 - RR); y < Math.min(S, hy1 + RR); y++) for (let x = Math.max(0, hx0 - RR); x < Math.min(S, hx1 + RR); x++) {
      if (!mask[y * S + x]) continue;   // bỏ pixel trong hole
      const p = (y * S + x) * 3, rr = rgb[p], gg = rgb[p + 1], bb = rgb[p + 2]; sr += rr; sg += gg; sb += bb; nc++;
      const l = 0.299 * rr + 0.587 * gg + 0.114 * bb; if (l < minL) minL = l; if (l > maxL) maxL = l;
    }
    const flat = nc > 0 && (maxL - minL) < 22;
    const png = Buffer.from(rgb);   // bắt đầu từ crop gốc; chỉ ghi đè vùng hole
    if (flat) {
      const mr = Math.round(sr / nc), mg = Math.round(sg / nc), mb = Math.round(sb / nc);
      for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) { const p = (y * S + x) * 3; png[p] = mr; png[p + 1] = mg; png[p + 2] = mb; }
    } else {
      const inp = new Float32Array(4 * S * S);
      for (let p = 0; p < S * S; p++) { const m = mask[p]; inp[p] = m - 0.5; for (let c = 0; c < 3; c++) inp[(1 + c) * S * S + p] = (rgb[p * 3 + c] / 127.5 - 1) * m; }
      const sess = await _miganSess();
      const r = await sess.run({ [sess.inputNames[0]]: new _ort.Tensor('float32', inp, [1, 4, S, S]) });
      const od = r[sess.outputNames[0]].data;
      for (let p = 0; p < S * S; p++) { if (mask[p]) continue; for (let c = 0; c < 3; c++) { const v = od[c * S * S + p]; png[p * 3 + c] = Math.max(0, Math.min(255, Math.round((v + 1) * 127.5))); } }
    }
    fs.writeFileSync(rawOut, png);
    await _ffOnce(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${S}x${S}`, '-i', rawOut, '-vf', `scale=${side}:${side}`, patch]);
    // Chỉ dán ĐÚNG vùng ✦ qua mask FEATHER (mờ mép) → phần ngoài giữ NGUYÊN ảnh gốc pixel-perfect → hết vết ô vuông trên nền phẳng.
    const lx = Math.max(0, box.x0 - rx), ly = Math.max(0, box.y0 - ry);
    const feather = Math.max(4, Math.round(Math.min(bw, bh) * 0.18));
    await _ffOnce(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${side}x${side}:d=1`, '-vf', `drawbox=x=${lx}:y=${ly}:w=${bw}:h=${bh}:color=white:t=fill,gblur=sigma=${feather},format=gray`, '-frames:v', '1', maskf]);
    await _ffOnce(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-i', patch, '-i', maskf, '-filter_complex', `[1]format=rgba[p];[p][2]alphamerge[fg];[0]format=rgb24[bg];[bg][fg]overlay=${rx}:${ry}:format=rgb,format=rgb24`, '-frames:v', '1', '-update', '1', out]);
    return fs.existsSync(out) ? out : null;
  } catch (e) { console.warn('[migan]', e && e.message); return null; }
  finally { for (const f of [rawIn, rawOut, patch, maskf]) { try { fs.unlinkSync(f); } catch (_) {} } }
}
// Xoá dấu ✦ Nano-Banana bằng AI: dùng vị trí TƯƠNG ĐỐI cố định của ✦ (~góc phải-dưới).
async function wmInpaintFile(input, jobId) {
  const dim = imageDim(input); const W = dim.w, H = dim.h;
  if (!W || !H || W < 200 || H < 200) return null;
  const box = { x0: Math.round(W * 0.912), y0: Math.round(H * 0.845), x1: Math.round(W * 0.957), y1: Math.round(H * 0.942) };
  return _miganInpaint(input, box, jobId);
}
// Cho renderer (bước Tạo Ảnh): nhận base64/dataURL → AI inpaint dấu ✦ → trả dataURL PNG (hoặc null nếu bỏ qua/lỗi).
async function inpaintBase64(base64, mime) {
  if (!base64 || !miganAvailable() || !ffmpegPath()) return null;
  const stamp = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const inExt = /jpe?g/i.test(mime || '') ? 'jpg' : (/webp/i.test(mime || '') ? 'webp' : 'png');
  const inp = path.join(os.tmpdir(), `wmin_${stamp}.${inExt}`);
  try {
    fs.writeFileSync(inp, Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64'));
    const out = await wmInpaintFile(inp, 'b64_' + stamp);
    if (!out) return null;
    const b = fs.readFileSync(out).toString('base64');
    try { fs.unlinkSync(out); } catch (_) {}
    return 'data:image/png;base64,' + b;
  } catch (e) { console.warn('[inpaintBase64]', e && e.message); return null; }
  finally { try { fs.unlinkSync(inp); } catch (_) {} }
}

async function runUpscale(payload = {}, win) {
  cancelled = false;
  const { items = [], outputDir, suffix = '_upscaled', model = 'remacri-4x', tile = 0, format = 'source', gpu = '', target = 3840, removeWatermark = false, wmOnly = false } = payload;
  ensureRunnable();
  if (!wmOnly && !fs.existsSync(binaryPath())) return { error: 'Thiếu binary Real-ESRGAN trong upscaler-bin/.' };   // wmOnly chỉ cần ffmpeg + model AI
  if ((removeWatermark || wmOnly) && !ffmpegPath()) return { error: 'Cần ffmpeg để xoá watermark.' };
  if ((removeWatermark || wmOnly) && !miganAvailable()) return { error: 'Thiếu model AI inpaint (inpaint-bin/migan.onnx).' };
  const T = parseInt(target) || 3840;
  const multiModel = (model === 'realesr-animevideov3');

  const results = [];
  for (const it of items) {
    if (cancelled) break;
    let input = it.path;
    let wmTmp = null;   // bản đã xoá dấu ✦ (file tạm) — dọn sau, KHÔNG đụng ảnh gốc
    // Bước 0: xoá dấu ✦ Nano-Banana bằng AI inpaint (MI-GAN). Lỗi thì vẫn giữ ảnh gốc, không chặn.
    if (removeWatermark || wmOnly) {
      if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'start' });
      try { const c = await wmInpaintFile(it.path, it.id); if (c) { input = c; wmTmp = c; } } catch (_) { /* giữ ảnh gốc */ }
    }
    // Tên & thư mục output luôn theo ảnh GỐC (it.path), không theo file tạm đã xoá watermark.
    const srcExt = path.extname(it.path).toLowerCase().replace('.', '') || 'png';
    const outExt = (format === 'source') ? (srcExt === 'jpeg' ? 'jpg' : srcExt) : format;
    const dir = outputDir && fs.existsSync(outputDir) ? outputDir : path.dirname(it.path);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const base = path.basename(it.path, path.extname(it.path));
    const outPath = path.join(dir, `${base}${suffix}.${outExt}`);
    const tmp = path.join(os.tmpdir(), `upx_${it.id}_${process.pid}.png`);

    // 🧽 CHẾ ĐỘ CHỈ XOÁ WATERMARK (không nâng cấp): lưu ảnh đã xoá dấu ở ĐÚNG cỡ gốc.
    if (wmOnly) {
      if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'start' });
      try {
        const d0 = imageDim(input);
        let r;
        if (d0.w && d0.h) r = await resizeTo(input, outPath, d0.w, d0.h);   // giữ nguyên cỡ, chỉ lưu/đổi định dạng
        else { fs.copyFileSync(input, outPath); r = { ok: true }; }
        if (r && r.cancelled) { results.push({ id: it.id, cancelled: true }); if (wmTmp) { try { fs.unlinkSync(wmTmp); } catch (_) {} } break; }
        const od = imageDim(outPath);
        if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'done', outPath, w: od.w, h: od.h });
        results.push({ id: it.id, ok: true, outPath, w: od.w, h: od.h });
      } catch (e) {
        if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'error', message: String(e.message || e) });
        results.push({ id: it.id, error: String(e.message || e) });
      } finally {
        if (wmTmp) { try { fs.unlinkSync(wmTmp); } catch (_) {} }
      }
      continue;
    }

    if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'start' });
    try {
      const dim = imageDim(input);
      const L = Math.max(dim.w || 0, dim.h || 0);
      const fit = fitLongEdge(dim.w, dim.h, T);

      if (L && L >= T) {
        // Ảnh đã lớn hơn/bằng mục tiêu → chỉ co xuống, không cần AI.
        const r = await resizeTo(input, outPath, fit.w, fit.h);
        if (r.cancelled) { results.push({ id: it.id, cancelled: true }); break; }
      } else {
        // Chọn bội số phóng: mô hình đa tỉ lệ chọn vừa đủ; x4plus/anime chỉ có 4×.
        let mult = 4;
        if (multiModel && L) mult = Math.min(4, Math.max(2, Math.ceil(T / L)));
        const r1 = await runOne(input, tmp, { model, scale: mult, tile, format: 'png', gpu }, it.id, win);
        if (r1.cancelled) { try { fs.unlinkSync(tmp); } catch (_) {} results.push({ id: it.id, cancelled: true }); break; }
        // Co/nới bản đã phóng về đúng độ phân giải mục tiêu + đổi định dạng.
        const r2 = await resizeTo(tmp, outPath, fit.w, fit.h);
        try { fs.unlinkSync(tmp); } catch (_) {}
        if (r2.cancelled) { results.push({ id: it.id, cancelled: true }); break; }
      }
      const od = imageDim(outPath);
      if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'done', outPath, w: od.w, h: od.h });
      results.push({ id: it.id, ok: true, outPath, w: od.w, h: od.h });
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (win && !win.isDestroyed()) win.webContents.send('upscale-progress', { id: it.id, type: 'error', message: String(e.message || e) });
      results.push({ id: it.id, error: String(e.message || e) });
    } finally {
      if (wmTmp) { try { fs.unlinkSync(wmTmp); } catch (_) {} }
    }
  }
  return { ok: true, results };
}

module.exports = { probe, pickImages, pickFolderImages, pickOutputDir, expandPaths, runUpscale, cancel, inpaintBase64, miganAvailable };
