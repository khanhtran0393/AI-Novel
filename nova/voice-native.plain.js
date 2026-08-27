/**
 * Voice Native — khởi động backend Voice Studio (OmniVoice) rồi cho novastudio nhúng UI.
 * Backend = thư mục voice-studio do người dùng chọn (engine OmniVoice qua .venv-omni).
 * App gọi start() khi mở tab "Tạo giọng nói" → spawn uvicorn (nếu chưa chạy) → chờ health → trả URL.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
let electronApp = null; try { electronApp = require('electron').app; } catch {}

const PORT = 8771;
const URL = 'http://127.0.0.1:' + PORT;
let proc = null;

// ── Đường dẫn voice-studio KHÁCH tự chọn (lưu ở userData/voice-root.txt) ──
function _cfgPath() { try { return electronApp ? path.join(electronApp.getPath('userData'), 'voice-root.txt') : null; } catch { return null; } }
function _isValidRoot(p) { try { return !!p && fs.existsSync(path.join(p, 'backend', 'app.py')); } catch { return false; } }
function customRoot() { try { const f = _cfgPath(); if (f && fs.existsSync(f)) { const p = fs.readFileSync(f, 'utf8').trim(); if (_isValidRoot(p)) return p; } } catch {} return null; }
function setRoot(p) { const f = _cfgPath(); if (!f) return { error: 'Không lưu được cấu hình.' }; if (!_isValidRoot(p)) return { error: 'Thư mục không hợp lệ — cần chứa backend/app.py của voice-studio.' }; try { fs.writeFileSync(f, String(p).trim()); return { ok: true, root: String(p).trim() }; } catch (e) { return { error: String(e) }; } }
let logSink = null;   // callback nhận từng dòng log backend (để hiện lên UI)
function onLog(cb) { logSink = cb; }
function emit(line) {
  const s = String(line).trim();
  if (!s) return;
  console.log('[voice]', s);
  // Bỏ spam polling (GET /api/status|voices|health) khỏi UI — chỉ giữ dòng có ý nghĩa.
  if (/GET \/api\/(status|voices|health)/.test(s)) return;
  if (logSink) { try { logSink(s); } catch {} }
}

function voiceRoot() {
  const custom = customRoot();
  if (custom) return custom;
  const candidates = [
    path.join(__dirname, '..', 'voice-studio'),
    '/Users/user/Documents/tool/voice-studio',
  ];
  for (const c of candidates) { try { if (_isValidRoot(c)) return c; } catch {} }
  return null;
}

function venvPython(root) {
  const c = [
    path.join(root, '.venv-omni', 'bin', 'python'),            // macOS/Linux
    path.join(root, '.venv-omni', 'Scripts', 'python.exe'),    // Windows
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '.venv', 'Scripts', 'python.exe'),
  ];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

// Trạng thái cài đặt cho UI: có tìm thấy voice-studio + môi trường Python chưa
function probe() { const root = voiceRoot(); return { root: root || null, hasRoot: !!root, hasPython: root ? !!venvPython(root) : false }; }

function health() {
  return new Promise((res) => {
    const r = http.get(URL + '/', () => { res(true); r.destroy(); });
    r.on('error', () => res(false));
    r.setTimeout(1500, () => { r.destroy(); res(false); });
  });
}

async function start() {
  if (await health()) return { ok: true, url: URL };
  const root = voiceRoot();
  if (!root) return { error: 'Không tìm thấy thư mục voice-studio. Hãy chọn thư mục backend trong AI Video Studio.' };
  const py = venvPython(root);
  if (!py) return { error: 'Thiếu môi trường Python (.venv-omni) trong voice-studio. Chạy setup trong voice-studio trước.' };

  if (!proc) {
    const env = { ...process.env, COQUI_TOS_AGREED: '1', VOICE_PORT: String(PORT) };
    const hasOmni = fs.existsSync(path.join(root, '.venv-omni', 'bin', 'python')) || fs.existsSync(path.join(root, '.venv-omni', 'Scripts', 'python.exe'));
    if (hasOmni) {
      env.VOICE_TTS_ENGINE = env.VOICE_TTS_ENGINE || 'omnivoice';
      // ASR mặc định là 'mock' → trả câu giả "[Đây là bản nhận dạng giả…]".
      // Timing cảnh giờ dựa vào ASR nên mock là dữ liệu rác đội lốt số đo. Ưu tiên
      // whisper thật; không có thư viện thì engine tự báo lỗi, app rơi về ước lượng.
      env.VOICE_ASR_ENGINE = env.VOICE_ASR_ENGINE || 'whisper';
      const hf = path.join(root, 'data', 'hf');
      if (fs.existsSync(hf)) env.HF_HOME = env.HF_HOME || hf;
    } else {
      env.VOICE_TTS_ENGINE = env.VOICE_TTS_ENGINE || 'xtts';
      const vixtts = path.join(root, 'data', 'models', 'viXTTS');
      if (fs.existsSync(vixtts)) env.VOICE_XTTS_DIR = env.VOICE_XTTS_DIR || vixtts;
    }
    proc = spawn(py, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(PORT)], {
      cwd: path.join(root, 'backend'), env,
    });
    proc.stdout.on('data', (d) => emit(d.toString()));
    proc.stderr.on('data', (d) => emit(d.toString()));
    proc.on('exit', () => { proc = null; });
    proc.on('error', (e) => { console.warn('[voice] spawn lỗi:', e.message); proc = null; });
  }

  // Chờ backend sẵn sàng (nạp model OmniVoice lần đầu có thể mất ~30-60s).
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await health()) return { ok: true, url: URL };
  }
  return { error: 'Backend giọng nói khởi động quá lâu — thử lại (hoặc kiểm tra voice-studio).' };
}

function status() { return health().then((ok) => ({ running: ok, url: URL })); }
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; } }

module.exports = { start, status, stop, onLog, setRoot, probe, PORT, URL };
