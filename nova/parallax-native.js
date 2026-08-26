// parallax-native.js — Cầu Electron main → parallax-native.py (ảnh tĩnh → clip 3D parallax).
// Nhận {imageB64|imagePath, dur} → ghi ảnh temp → spawn python (venv) → trả {ok, path}.
// Tiến độ đẩy về renderer qua 'nova:parallaxProgress'. Cần venv có torch + Depth-Anything.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT = path.join(__dirname, 'parallax-native.py');
function pyPath() {
  const cands = [
    path.join(os.homedir(), '.omnivoice-venv', 'bin', 'python'),   // venv voice-studio (dev) — có torch + depth
    '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3'
  ];
  for (const p of cands) { try { if (p === 'python3' || fs.existsSync(p)) return p; } catch (_) {} }
  return 'python3';
}
function tmpDir() { const d = path.join(os.tmpdir(), 'nova-parallax'); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} return d; }

// { imageB64?, imagePath?, dur, fps?, w?, h? } → { ok, path } | { ok:false, error }
async function renderParallax(payload = {}, win) {
  const dur = Math.max(1, Number(payload.dur) || 4);
  const fps = Number(payload.fps) || 30, W = Number(payload.w) || 1280, H = Number(payload.h) || 720;
  const dir = tmpDir(); const tag = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  let img = payload.imagePath || '';
  if (!img && payload.imageB64) {
    const b = String(payload.imageB64).replace(/^data:image\/\w+;base64,/, '');
    img = path.join(dir, `in_${tag}.png`);
    try { fs.writeFileSync(img, Buffer.from(b, 'base64')); } catch (e) { return { ok: false, error: 'Không ghi được ảnh tạm: ' + e.message }; }
  }
  if (!img || !fs.existsSync(img)) return { ok: false, error: 'Thiếu ảnh đầu vào' };
  const out = path.join(dir, `px_${tag}.mp4`);
  const py = pyPath();
  const send = (percent, message) => { try { win && win.webContents.send('nova:parallaxProgress', { percent, message }); } catch (_) {} };

  return await new Promise((resolve) => {
    let outBuf = '', errBuf = '';
    const proc = spawn(py, [SCRIPT, img, String(dur), out, String(fps), String(W), String(H)]);
    const to = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 180000);   // 3 phút/ảnh — chống treo
    proc.stdout.on('data', d => outBuf += d);
    proc.stderr.on('data', d => {
      errBuf += d; const s = String(d);
      const m = s.match(/P:(\d+)\s*([^\n]*)/); if (m) send(parseInt(m[1]), (m[2] || '').trim());
    });
    proc.on('error', e => { clearTimeout(to); resolve({ ok: false, error: 'Không chạy được python: ' + e.message }); });
    proc.on('close', code => {
      clearTimeout(to);
      if (code === 0 && fs.existsSync(out)) resolve({ ok: true, path: out });
      else {
        const hint = /import|torch|transformers|No module/i.test(errBuf) ? ' (thiếu thư viện AI trong venv — cần torch + transformers/Depth-Anything)' : '';
        resolve({ ok: false, error: (errBuf.trim().split('\n').slice(-2).join(' ') || 'python lỗi mã ' + code) + hint });
      }
    });
  });
}

module.exports = { renderParallax };
