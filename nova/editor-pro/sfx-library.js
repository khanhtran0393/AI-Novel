// Thư viện Hiệu ứng âm thanh (SFX) dựng sẵn — 333 .wav offline (từ starter-pack).
// Trả catalog (id/tên/nhóm/tag/giây/đường dẫn); renderer đọc file khi người dùng chọn.
const fs = require('fs'); const path = require('path');

function libDir() {
  const cands = [
    path.join(__dirname, '..', 'assets', 'sfx-library'),                 // dev
    path.join(process.resourcesPath || '', 'assets', 'sfx-library'),     // đóng gói
    path.join(process.resourcesPath || '', 'app', 'assets', 'sfx-library'),
  ];
  for (const d of cands) { try { if (fs.existsSync(path.join(d, 'manifest.json'))) return d; } catch (_) {} }
  return cands[0];
}
const CAT_VI = { whooshes: 'Vút / chuyển', mechanical: 'Cơ khí', tactile: 'Chạm / giấy', tech: 'Công nghệ', ambience: 'Nền / không gian' };
function list() {
  try {
    const d = libDir(); const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
    return (m.items || []).map(it => ({
      id: it.id,
      name: String(it.id || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: it.category || 'khác',
      catVi: CAT_VI[it.category] || it.category || 'Khác',
      tags: it.tags || [],
      dur: +(it.durationSec || 0),
      path: path.join(d, it.relativePath || (it.file || '')),
    })).filter(x => { try { return x.path && fs.existsSync(x.path); } catch (_) { return false; } });
  } catch (_) { return []; }
}
function registerSfxLibrary(ipcMain) {
  const ch = 'nova:sfxLibrary:list';
  try { ipcMain.removeHandler(ch); } catch (_) {}
  ipcMain.handle(ch, async () => { const items = list(); return { ok: true, items, count: items.length }; });
  return [ch];
}
module.exports = { registerSfxLibrary, list };
