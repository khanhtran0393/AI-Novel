/**
 * MCP Bridge Native — cầu HTTP cục bộ để MCP server (tiến trình node riêng, stdio) điều khiển
 * các NĂNG LỰC NATIVE sẵn có của app: dựng video (FFmpeg), nâng cấp ảnh (Real-ESRGAN),
 * xoá watermark, đo độ dài media. Chạy THẲNG trong main process → dùng lại đúng các hàm mà
 * IPC handler đang gọi (không viết lại engine).
 *
 *   MCP server (stdio)  →  HTTP 127.0.0.1:8794  →  bridge này  →  nativeTools / upscaleNative / watermarkNative
 *
 * Chỉ nghe localhost (127.0.0.1 + ::1). Mỗi tool = 1 endpoint POST JSON. Điểm khác biệt quan trọng:
 * engine renderVideo nhận ẢNH dạng dataURL (base64) — agent lại tiện truyền ĐƯỜNG DẪN FILE, nên
 * bridge tự đọc file → dataURL trước khi gọi engine.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8794;
const VERSION = '1.0.0';

// Các module native được main.js tiêm vào (đã require sẵn ở đó) để tránh khởi tạo trùng.
let deps = { nativeTools: null, upscaleNative: null, watermarkNative: null, getWindow: null };

// ── Tiện ích ──────────────────────────────────────────────────────────────
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
const VID_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];

function mimeOf(file) {
  const e = path.extname(file).toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.bmp') return 'image/bmp';
  if (VID_EXT.includes(e)) return 'video/mp4';
  return 'image/png';
}

// Đọc 1 file → data URL. Ném lỗi rõ ràng nếu không thấy file (để agent biết đường sửa).
function fileToDataUrl(file) {
  if (!file) throw new Error('Thiếu đường dẫn file.');
  if (!fs.existsSync(file)) throw new Error('Không tìm thấy file: ' + file);
  const b64 = fs.readFileSync(file).toString('base64');
  return 'data:' + mimeOf(file) + ';base64,' + b64;
}

function isVideoPath(p) { return VID_EXT.includes(path.extname(String(p || '')).toLowerCase()); }

// ── Map "scene" thân thiện (agent) → "image" mà engine renderVideo hiểu ─────
function sceneToImage(sc) {
  const src = sc.image || sc.path || sc.file || sc.src;
  const kind = sc.kind || (isVideoPath(src) ? 'video' : 'image');
  const out = {
    dataUrl: fileToDataUrl(src),
    dur: Math.max(0.3, Number(sc.seconds != null ? sc.seconds : sc.dur) || 4),
    kind,
  };
  if (sc.effect || sc.fx) out.fx = String(sc.effect || sc.fx);
  if (sc.transition || sc.trans) out.trans = String(sc.transition || sc.trans);
  if (sc.transDur != null) out.transDur = Number(sc.transDur);
  if (sc.scale != null) out.scale = Number(sc.scale);
  return out;
}

// ── Xử lý từng tool ─────────────────────────────────────────────────────────
async function toolRenderVideo(body) {
  const { nativeTools, getWindow } = deps;
  if (!nativeTools) throw new Error('nativeTools chưa sẵn sàng.');
  const scenes = Array.isArray(body.scenes) ? body.scenes
    : Array.isArray(body.images) ? body.images : [];
  if (!scenes.length) throw new Error('Cần ít nhất 1 cảnh (scenes: [{ image, seconds }]).');
  const out = body.output || body.outPath;
  if (!out) throw new Error('Cần "output" (đường dẫn MP4 để lưu) — MCP chạy nền, không mở hộp thoại được.');

  const payload = {
    images: scenes.map(sceneToImage),
    outPath: out,
    width: body.width || 1920,
    height: body.height || 1080,
    fps: body.fps || 30,
    crf: body.crf || 20,
    vcodec: body.vcodec || 'h264',
    gpu: body.gpu != null ? !!body.gpu : (process.platform === 'darwin'),
    effect: body.effect || undefined,
    duckMusic: body.duckMusic,
    musicVolume: body.musicVolume,
    subtitlesSrt: body.subtitlesSrt || undefined,
    subStyle: body.subStyle || undefined,
  };
  if (body.voiceover) payload.audioDataUrl = fileToDataUrl(body.voiceover);
  if (body.music) payload.musicDataUrl = fileToDataUrl(body.music);
  if (Array.isArray(body.overlays)) {
    payload.overlays = body.overlays
      .filter((o) => o && (o.image || o.path))
      .map((o) => ({ dataUrl: fileToDataUrl(o.image || o.path), start: Number(o.start) || 0, dur: Number(o.seconds != null ? o.seconds : o.dur) || 3 }));
  }
  const win = (getWindow && getWindow()) || null;
  const r = await nativeTools.renderVideo(payload, win);
  if (r && r.error) throw new Error(r.error);
  if (r && r.canceled) throw new Error('Đã huỷ render.');
  return { ok: true, output: r.path, scenes: scenes.length };
}

async function toolProbeMedia(body) {
  const { nativeTools } = deps;
  if (!nativeTools || !nativeTools.probeDur) throw new Error('probeDur chưa sẵn sàng.');
  const p = body.path || body.file;
  if (!p) throw new Error('Cần "path".');
  if (!fs.existsSync(p)) throw new Error('Không tìm thấy file: ' + p);
  const durationSec = await nativeTools.probeDur(p);
  return { ok: true, path: p, durationSec, kind: isVideoPath(p) ? 'video' : 'image' };
}

function toolFfmpegInfo() {
  const { nativeTools } = deps;
  if (!nativeTools) throw new Error('nativeTools chưa sẵn sàng.');
  return { ok: true, ...nativeTools.ffmpegInfo() };
}

async function toolUpscale(body) {
  const { upscaleNative, getWindow } = deps;
  if (!upscaleNative) throw new Error('upscaleNative chưa sẵn sàng.');
  const pr = upscaleNative.probe();
  if (pr && pr.ok === false) throw new Error('Chưa cài binary Real-ESRGAN (upscaler-bin). Trên máy này chưa dùng được nâng cấp ảnh.');
  const inputs = Array.isArray(body.inputs) ? body.inputs : (body.input ? [body.input] : []);
  if (!inputs.length) throw new Error('Cần "inputs": [đường dẫn ảnh hoặc thư mục].');
  const items = upscaleNative.expandPaths(inputs);   // mở rộng thư mục/nhiều ảnh → [{path,...}]
  if (!items.length) throw new Error('Không tìm thấy ảnh trong "inputs".');
  const win = (getWindow && getWindow()) || null;
  const r = await upscaleNative.runUpscale({
    items,
    outputDir: body.outputDir || undefined,
    model: body.model || 'remacri-4x',
    target: body.target || 3840,
    tile: body.tile || 0,
    format: body.format || 'source',
    gpu: body.gpu || '',
    removeWatermark: !!body.removeWatermark,
  }, win);
  if (r && r.error) throw new Error(r.error);
  return { ok: true, count: items.length, result: r };
}

async function toolRemoveWatermark(body) {
  const { watermarkNative } = deps;
  if (!watermarkNative) throw new Error('watermarkNative chưa sẵn sàng.');
  const pr = watermarkNative.probe();
  if (pr && (pr.hasRoot === false || pr.hasPython === false)) {
    throw new Error('Công cụ xoá watermark (WatermarkRemover-AI) chưa cài đủ (thiếu root/python) trên máy này.');
  }
  const input = body.input;
  if (!input) throw new Error('Cần "input" (file hoặc thư mục).');
  const opts = body.opts || {};
  if (body.folder) {
    const r = await watermarkNative.removeFolder(input, body.output || undefined, opts);
    if (r && r.error) throw new Error(r.error);
    return { ok: true, mode: 'folder', result: r };
  }
  const r = await watermarkNative.removeFile(input, body.output || undefined, opts);
  if (r && r.error) throw new Error(r.error);
  return { ok: true, mode: 'file', output: (r && (r.output || r.path)) || body.output, result: r };
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const ROUTES = {
  '/render-video': toolRenderVideo,
  '/probe-media': toolProbeMedia,
  '/ffmpeg-info': toolFfmpegInfo,
  '/upscale': toolUpscale,
  '/remove-watermark': toolRemoveWatermark,
};

const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b));
});
const sendJSON = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function handler(req, res) {
  // Chỉ localhost — CORS mở cho công cụ cục bộ, nhưng server đã bind 127.0.0.1/::1.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const p = (req.url || '').split('?')[0];
  if (req.method === 'GET' && (p === '/health' || p === '/')) {
    return sendJSON(res, { ok: true, name: 'nova-mcp-bridge', version: VERSION, tools: Object.keys(ROUTES).map((k) => k.slice(1)) });
  }
  const fn = ROUTES[p];
  if (req.method === 'POST' && fn) {
    let body = {};
    try { const raw = await readBody(req); body = raw ? JSON.parse(raw) : {}; }
    catch { return sendJSON(res, { error: 'JSON không hợp lệ.' }, 400); }
    try {
      const out = await fn(body);
      return sendJSON(res, out);
    } catch (e) {
      return sendJSON(res, { error: String(e && e.message || e) }, 500);
    }
  }
  res.writeHead(404); res.end('not found');
}

let started = false;
/**
 * @param {object} injected { nativeTools, upscaleNative, watermarkNative, getWindow }
 */
function startAll(injected) {
  if (started) return;
  started = true;
  deps = Object.assign(deps, injected || {});
  for (const host of ['127.0.0.1', '::1']) {
    const s = http.createServer(handler);
    s.on('error', (e) => console.warn(`[mcp-bridge] ${host}:${PORT}:`, e.message));
    s.listen(PORT, host, () => console.log(`[mcp-bridge] → ${host}:${PORT}`));
  }
}

module.exports = { startAll, PORT };
