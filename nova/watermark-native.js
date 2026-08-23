/**
 * Watermark Native — xoá watermark/logo (đặc biệt watermark Flow/Veo) bằng engine
 * WatermarkRemover-AI (Florence-2 phát hiện + LaMa vẽ lại) chạy LOCAL qua Python.
 *
 * Khác voice-native (giữ server uvicorn chạy nền), ở đây gọi CLI remwm.py theo từng
 * lần (1 file hoặc cả thư mục — bulk mode). Bulk mode load model Florence-2 1 lần cho
 * cả lô nên nhanh hơn nhiều so với gọi lẻ từng ảnh → luồng Flow nên gom ảnh rồi chạy 1 lần.
 *
 * CLI (đã xác nhận từ repo):
 *   python remwm.py INPUT [OUTPUT] [--overwrite] [--transparent]
 *     [--max-bbox-percent N] [--force-format PNG|WEBP|JPG|MP4|AVI]
 *     [--detection-prompt "watermark"] [--detection-skip N]   # N: nhận diện mỗi N frame (video)
 *     [--fade-in S] [--fade-out S] [--preview]                # preview: trả JSON box + base64, không xử lý
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let electronApp = null; try { electronApp = require('electron').app; } catch {}

// ── Cấu hình đường dẫn watermark-remover (khách tự chọn, lưu userData/watermark-root.txt) ──
function _cfgPath() { try { return electronApp ? path.join(electronApp.getPath('userData'), 'watermark-root.txt') : null; } catch { return null; } }
function _isValidRoot(p) { try { return !!p && fs.existsSync(path.join(p, 'remwm.py')); } catch { return false; } }
function customRoot() { try { const f = _cfgPath(); if (f && fs.existsSync(f)) { const p = fs.readFileSync(f, 'utf8').trim(); if (_isValidRoot(p)) return p; } } catch {} return null; }
function setRoot(p) {
  const f = _cfgPath(); if (!f) return { error: 'Không lưu được cấu hình.' };
  if (!_isValidRoot(p)) return { error: 'Thư mục không hợp lệ — cần chứa remwm.py của WatermarkRemover-AI.' };
  try { fs.writeFileSync(f, String(p).trim()); return { ok: true, root: String(p).trim() }; } catch (e) { return { error: String(e) }; }
}

function wmRoot() {
  const custom = customRoot();
  if (custom) return custom;
  const candidates = [
    path.join(__dirname, '..', 'watermark-remover'),
    '/Users/chukien/Documents/tool/watermark-remover',
  ];
  for (const c of candidates) { try { if (_isValidRoot(c)) return c; } catch {} }
  return null;
}

function venvPython(root) {
  const c = [
    path.join(root, 'venv', 'bin', 'python'),          // macOS/Linux (setup.sh tạo ./venv)
    path.join(root, 'venv', 'Scripts', 'python.exe'),  // Windows (setup.ps1)
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '.venv', 'Scripts', 'python.exe'),
  ];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

// Trạng thái cài đặt cho UI
function probe() {
  const root = wmRoot();
  return { root: root || null, hasRoot: !!root, hasPython: root ? !!venvPython(root) : false };
}

let logSink = null;
function onLog(cb) { logSink = cb; }
function emit(line) {
  const s = String(line).trim(); if (!s) return;
  console.log('[wm]', s);
  if (logSink) { try { logSink(s); } catch {} }
}

// ── Chạy remwm.py 1 lần ──
function _run(args, { onData } = {}) {
  return new Promise((resolve, reject) => {
    const root = wmRoot();
    if (!root) return reject(new Error('Chưa tìm thấy WatermarkRemover-AI (thiếu remwm.py). Vào cài đặt để chọn thư mục.'));
    const py = venvPython(root);
    if (!py) return reject(new Error('Chưa cài môi trường Python cho WatermarkRemover-AI (thiếu venv). Chạy setup.sh trong thư mục đó.'));

    // Ép dùng model cache có sẵn, tránh tải lại; tắt buffering để log ra realtime.
    const env = { ...process.env, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '0', TOKENIZERS_PARALLELISM: 'false' };
    const cp = spawn(py, [path.join(root, 'remwm.py'), ...args], { cwd: root, env });

    let out = '', err = '';
    cp.stdout.on('data', (d) => { const s = String(d); out += s; if (onData) onData(s); else emit(s); });
    cp.stderr.on('data', (d) => { const s = String(d); err += s; emit(s); });
    cp.on('error', reject);
    cp.on('close', (code) => {
      if (code === 0) return resolve({ code, out, err });
      reject(new Error('remwm lỗi (' + code + '): ' + (err || out).slice(-600)));
    });
    _current = cp;
  });
}

let _current = null;
function cancel() { try { if (_current) _current.kill('SIGTERM'); } catch {} }

function _opts(o = {}) {
  const a = [];
  if (o.overwrite !== false) a.push('--overwrite');             // mặc định ghi đè khi bulk
  if (o.transparent) a.push('--transparent');
  if (o.maxBboxPercent != null) a.push('--max-bbox-percent', String(o.maxBboxPercent));
  if (o.forceFormat) a.push('--force-format', String(o.forceFormat).toUpperCase());
  a.push('--detection-prompt', o.detectionPrompt || 'watermark');
  if (o.detectionSkip != null) a.push('--detection-skip', String(o.detectionSkip));
  if (o.fadeIn != null) a.push('--fade-in', String(o.fadeIn));
  if (o.fadeOut != null) a.push('--fade-out', String(o.fadeOut));
  return a;
}

// remwm.py TỪ CHỐI khi output trùng input ("Cannot overwrite input file") → cần dọn "tại chỗ"
// bằng cách xuất ra thư mục/tệp tạm rồi chuyển ngược đè lên bản gốc.
function _moveOver(srcFile, dstFile) {
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  try { fs.renameSync(srcFile, dstFile); }                       // cùng ổ đĩa (thư mục tạm là anh em) → nhanh
  catch { fs.copyFileSync(srcFile, dstFile); try { fs.unlinkSync(srcFile); } catch {} }
}
function _stem(name) { const i = name.lastIndexOf('.'); return (i >= 0 ? name.slice(0, i) : name).toLowerCase(); }
function _moveBack(srcDir, dstDir) {
  // remwm hay đổi đuôi (vd .jpg→.jpeg). Ghép ảnh đã xử lý về ĐÚNG TÊN GỐC theo phần tên (stem),
  // để ghi đè bản gốc thay vì tạo file trùng khác đuôi.
  let origByStem = {};
  try { for (const f of fs.readdirSync(dstDir)) origByStem[_stem(f)] = f; } catch {}
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    if (ent.isDirectory()) { _moveBack(s, path.join(dstDir, ent.name)); continue; }
    const target = origByStem[_stem(ent.name)] || ent.name;   // giữ tên gốc nếu tìm được
    _moveOver(s, path.join(dstDir, target));
  }
}

// Xoá watermark 1 file. Nếu không cho outputPath (hoặc trùng input) → dọn tại chỗ qua file tạm.
async function removeFile(inputPath, outputPath, opts = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Không tìm thấy file đầu vào: ' + inputPath);
  const inPlace = !outputPath || path.resolve(outputPath) === path.resolve(inputPath);
  const dir = path.dirname(inputPath);
  const wmStem = '.' + _stem(path.basename(inputPath)) + '__wm';
  const realOut = inPlace ? path.join(dir, wmStem + path.extname(inputPath)) : outputPath;
  try {
    await _run([inputPath, realOut, ..._opts(opts)]);
    if (inPlace) {
      let produced = realOut;   // remwm có thể đổi đuôi → dò file thật theo stem
      if (!fs.existsSync(produced)) { const c = fs.readdirSync(dir).find(f => _stem(f) === wmStem.toLowerCase()); if (c) produced = path.join(dir, c); }
      if (fs.existsSync(produced)) _moveOver(produced, inputPath);
      return { output: inputPath };
    }
    // Non-in-place: remwm có thể đổi đuôi output → trả về đường dẫn THẬT đã ghi (để caller như upscale dùng lại).
    let out = outputPath;
    if (!fs.existsSync(out)) { const od = path.dirname(outputPath), os2 = _stem(path.basename(outputPath)); const c = fs.readdirSync(od).find(f => _stem(f) === os2); if (c) out = path.join(od, c); }
    return { output: out };
  } finally {
    if (inPlace) { try { for (const f of fs.readdirSync(dir)) if (_stem(f) === wmStem.toLowerCase()) fs.unlinkSync(path.join(dir, f)); } catch {} }
  }
}

// Xoá watermark cả thư mục (bulk) → Florence-2 load 1 lần cho cả lô.
// output trùng/không có → xuất ra thư mục tạm anh em rồi chuyển ngược đè lên bản gốc.
async function removeFolder(inputDir, outputDir, opts = {}) {
  if (!inputDir || !fs.existsSync(inputDir)) throw new Error('Không tìm thấy thư mục đầu vào: ' + inputDir);
  const inPlace = !outputDir || path.resolve(outputDir) === path.resolve(inputDir);
  const realOut = inPlace ? path.join(path.dirname(inputDir), '.' + path.basename(inputDir) + '__wm_tmp') : outputDir;
  fs.mkdirSync(realOut, { recursive: true });
  try {
    await _run([inputDir, realOut, ..._opts({ overwrite: true, ...opts })]);
    if (inPlace) _moveBack(realOut, inputDir);        // chỉ ảnh đã xử lý mới có trong realOut → ảnh không watermark giữ nguyên bản gốc
    return { output: inPlace ? inputDir : realOut };
  } finally { if (inPlace) { try { fs.rmSync(realOut, { recursive: true, force: true }); } catch {} } }
}

// Preview: phát hiện watermark, trả JSON { boxes, image (base64) } — KHÔNG xử lý.
async function preview(inputPath, opts = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Không tìm thấy file: ' + inputPath);
  let raw = '';
  await _run([inputPath, '--preview', ..._opts(opts)], { onData: (s) => { raw += s; } });
  // remwm in JSON ra stdout ở chế độ preview.
  try { const m = raw.match(/\{[\s\S]*\}$/); return JSON.parse(m ? m[0] : raw); }
  catch { return { raw }; }
}

module.exports = { probe, setRoot, onLog, removeFile, removeFolder, preview, cancel };
