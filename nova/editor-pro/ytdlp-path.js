// Đường dẫn yt-dlp DÙNG CHUNG cho mọi chỗ (clip cảnh, phân tích đối thủ, tìm ngách).
// Ưu tiên bản ĐÓNG GÓI THEO APP ở ytdlp-bin/ → khách không phải tự cài yt-dlp.
// ytdlp-bin nằm trong asarUnpack nên file thật ở app.asar.unpacked/ytdlp-bin/ (KHÔNG spawn được file trong app.asar).
const fs = require('fs');
const path = require('path');

function resolveYtdlp() {
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_macos';
  const roots = [];
  try { if (!__dirname.includes('.asar')) roots.push(path.join(__dirname, '..', 'ytdlp-bin')); } catch (_) {}   // dev: chạy thẳng từ source
  try { roots.push(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', 'ytdlp-bin')); } catch (_) {}
  try { if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'ytdlp-bin'), path.join(process.resourcesPath, 'ytdlp-bin')); } catch (_) {}
  for (const r of roots) {
    const p = path.join(r, exe);
    try {
      if (!fs.existsSync(p)) continue;
      // zip/dmg có thể làm rơi cờ thực thi → tự set lại, không thì spawn EACCES.
      if (process.platform !== 'win32') { try { fs.accessSync(p, fs.constants.X_OK); } catch (_) { try { fs.chmodSync(p, 0o755); } catch (_) {} } }
      // macOS: file tải từ dmg/zip dính cờ quarantine → Gatekeeper chặn chạy binary lồng trong app chưa ký. Gỡ 1 lần, lỗi thì kệ.
      if (process.platform === 'darwin') { try { require('child_process').spawnSync('xattr', ['-d', 'com.apple.quarantine', p], { stdio: 'ignore' }); } catch (_) {} }
      return p;
    } catch (_) {}
  }
  for (const p of ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return 'yt-dlp';   // cuối cùng: dựa vào PATH (máy dev đã cài)
}

const YTDLP = resolveYtdlp();
const YTDLP_BUNDLED = YTDLP !== 'yt-dlp' && YTDLP.includes('ytdlp-bin');

module.exports = { YTDLP, YTDLP_BUNDLED, resolveYtdlp };
