// Handler nova:autoVideo — chạy orchestrator textmode, gửi progress, mở file khi xong.
const { shell } = require('electron');
const { make } = require('./auto-video-textmode');

function registerEditorProAutoVideo(ipcMain) {
  const ch = 'nova:autoVideo';
  try { ipcMain.removeHandler(ch); } catch (_) {}
  ipcMain.handle(ch, async (e, payload = {}) => {
    try {
      const topic = String(payload.topic || '').trim();
      if (!topic) return { ok: false, error: 'Thiếu chủ đề' };
      const n = Math.max(2, Math.min(30, Number(payload.scenes) || 4));
      const onProgress = (p, msg) => { try { e.sender.send('nova:autoVideoProgress', { percent: p, message: msg }); } catch (_) {} };
      const r = await make(topic, n, onProgress, { vision: payload.vision !== false, score: payload.score !== false, capStyle: payload.capStyle || "nova" });
      if (r && r.ok && r.path) { try { shell.showItemInFolder(r.path); shell.openPath(r.path); } catch (_) {} }
      return r;
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 300) }; }
  });
  return [ch];
}
module.exports = { registerEditorProAutoVideo };
