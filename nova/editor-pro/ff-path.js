// Đường dẫn FFmpeg/FFprobe DÙNG CHUNG cho mọi module editor-pro.
//
// Vì sao phải có file này: require('ffmpeg-static') trả đường dẫn NẰM TRONG app.asar.
// fs đọc được (Electron vá fs) nhưng spawn thì KHÔNG — đã đo, lỗi ENOTDIR. native-tools.js
// từ đầu đã tự đổi sang app.asar.unpacked, còn 8 module editor-pro thì chưa → mọi thứ
// dính ffmpeg ở đây (cắt clip YouTube, lấy frame, đo thời lượng) chết trên máy khách.
'use strict';
const fs = require('fs');

function unasar(p) {
  if (!p) return null;
  const real = String(p).includes('app.asar') && !String(p).includes('app.asar.unpacked')
    ? String(p).replace('app.asar', 'app.asar.unpacked') : String(p);
  try {
    if (fs.existsSync(real)) {
      // zip/dmg làm rơi cờ thực thi → spawn EACCES. Set lại một lần.
      if (process.platform !== 'win32') { try { fs.accessSync(real, fs.constants.X_OK); } catch (_) { try { fs.chmodSync(real, 0o755); } catch (_) {} } }
      return real;
    }
  } catch (_) {}
  return real;
}

const FFMPEG = (() => { try { return unasar(require('ffmpeg-static')) || 'ffmpeg'; } catch (_) { return 'ffmpeg'; } })();
const FFPROBE = (() => { try { const p = require('ffprobe-static'); return unasar(p.path || p) || 'ffprobe'; } catch (_) { return 'ffprobe'; } })();
// Thư mục chứa ffmpeg — yt-dlp cần biết chỗ này (--ffmpeg-location) mới cắt được đoạn.
const FFDIR = (() => { try { return require('path').dirname(FFMPEG); } catch (_) { return null; } })();

module.exports = { FFMPEG, FFPROBE, FFDIR, unasar };
