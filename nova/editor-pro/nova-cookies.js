// Xuất cookie YouTube/Google từ partition Flow của Nova → file Netscape cho yt-dlp.
const { session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OUT = path.join(os.tmpdir(), 'nova-editor-pro', 'yt-cookies.txt');
let _cache = { file: null, at: 0 };

async function youtubeCookiesFile() {
  // cache 10 phút
  if (_cache.file && fs.existsSync(_cache.file) && Date.now() - _cache.at < 600000) return _cache.file;
  const parts = ['persist:flow-1', 'persist:flow-3', 'persist:flow-6', 'persist:flow-5', 'persist:novastudio'];
  let best = null;
  for (const p of parts) {
    try {
      const ses = session.fromPartition(p);
      const cks = await ses.cookies.get({});
      const yt = cks.filter(c => /(^|\.)(youtube\.com|google\.com|googlevideo\.com|youtube-nocookie\.com)$/i.test(c.domain.replace(/^\./, '')) || /youtube|google/i.test(c.domain));
      const hasAuth = yt.some(c => /youtube\.com/i.test(c.domain));
      if (yt.length && (!best || (hasAuth && !best.hasAuth) || yt.length > best.list.length)) best = { part: p, list: yt, hasAuth };
      if (best && best.hasAuth && best.list.length > 20) break;
    } catch (_) {}
  }
  if (!best) return null;
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of best.list) {
    const domain = c.domain.startsWith('.') ? c.domain : (c.domain.includes('.') ? c.domain : '.' + c.domain);
    const inclSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 86400 * 30;
    lines.push([domain, inclSub, c.path || '/', secure, exp, c.name, c.value].join('\t'));
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  _cache = { file: OUT, at: Date.now() };
  console.log('[nova-cookies] xuất', best.list.length, 'cookie từ', best.part, '→', OUT);
  return OUT;
}
module.exports = { youtubeCookiesFile };
