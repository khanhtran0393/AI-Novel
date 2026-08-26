// Cầu nối Tool 2 → Editor Pro (editor.html): nhận ảnh cảnh (base64) + số giây + mp3
// → xuất ảnh ra file tạm → dựng project schema editor.html (mỗi cảnh = 1 "Cảnh"/section).
const fs = require('fs'); const path = require('path'); const os = require('os');

let _pending = null;   // gói chờ editor kéo về

function tmpDir() {
  const d = path.join(os.tmpdir(), 'nova-scene-bridge');
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}
function writeB64(dataUrl, file) {
  const b64 = String(dataUrl || '').startsWith('data:') ? String(dataUrl).split(',')[1] : String(dataUrl || '');
  if (!b64) return null;
  try { fs.writeFileSync(file, Buffer.from(b64, 'base64')); return file; } catch (_) { return null; }
}

// payload: { title, voicePath, scenes:[{ id, duration, base64, mime }] }
function buildProject(payload = {}) {
  const dir = tmpDir();
  const stamp = String(Date.now());
  const scenes = Array.isArray(payload.scenes) ? payload.scenes : [];
  const sections = []; const sectionEndTimes = []; let cum = 0; let n = 0;
  for (const s of scenes) {
    const dur = Math.max(0.1, Number(s.duration) || 3);
    let filePath = null;
    if (s.base64) {
      const ext = ((s.mime || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg');
      filePath = writeB64(s.base64, path.join(dir, `scene-${stamp}-${s.id || (n + 1)}.${ext}`));
    } else if (s.path) filePath = s.path;
    if (!filePath) continue;
    sections.push({ files: [filePath], removeAudio: true, shuffle: false, cut: false, locked: false, layer: 1, startSec: +cum.toFixed(2) });
    cum = +(cum + dur).toFixed(2);
    sectionEndTimes.push(cum);
    n++;
  }
  const project = {
    title: String(payload.title || 'Từ Tool 2'),
    script: String(payload.script || ''),
    sections, sectionEndTimes, transitions: [],
    totalDuration: cum,
  };
  return { project, voiceoverFile: payload.voicePath || '', count: n, totalDuration: cum };
}

function registerSceneBridge(ipcMain) {
  const chans = [];
  const H = (ch, fn) => { try { ipcMain.removeHandler(ch); } catch (_) {} ipcMain.handle(ch, fn); chans.push(ch); };
  // Tool 2 (cửa sổ Nova) đẩy gói sang
  H('nova:sceneBridge:push', async (e, payload = {}) => {
    try {
      const built = buildProject(payload);
      if (!built.count) return { ok: false, error: 'Không có cảnh nào có ảnh để đưa sang.' };
      _pending = built;
      // báo mọi webContents (editor webview) là có gói mới
      try { const { webContents } = require('electron'); webContents.getAllWebContents().forEach(wc => { try { wc.send('nova:sceneBridge:ready'); } catch (_) {} }); } catch (_) {}
      return { ok: true, count: built.count, totalDuration: built.totalDuration };
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });
  // editor.html kéo gói về (rồi xoá)
  H('nova:sceneBridge:pull', async () => {
    const p = _pending; _pending = null;
    return p ? { ok: true, ...p } : { ok: false };
  });
  // xem có gói không mà không lấy
  H('nova:sceneBridge:peek', async () => ({ ok: !!_pending, count: _pending ? _pending.count : 0 }));
  // CHẨN ĐOÁN: editor ghi trạng thái sau loadProject ra file để đọc bằng Bash
  H('nova:sceneBridge:diag', async (e, p = {}) => { try { fs.writeFileSync(path.join(os.tmpdir(), 'nova-scene-diag.json'), JSON.stringify(p, null, 2)); } catch (_) {} return { ok: true }; });
  return chans;
}
module.exports = { registerSceneBridge, buildProject };
