/* ══ KHỚP LỜI — tìm đúng giây trong video nguồn ═══════════════════════════════
   Cách cắt mặc định (tỉ lệ vàng + bám chuyển cảnh) chọn điểm cắt mà KHÔNG đọc
   nội dung — hợp với b-roll, nhưng sai hẳn khi cảnh trích dẫn một phát biểu
   cụ thể ("Steve Jobs nói ở Stanford…", phiên điều trần, phóng sự).

   Module này bóc băng tiếng của video nguồn rồi tìm đoạn đang nói đúng nội
   dung cảnh. Đắt: phải tải tiếng cả video (đo được 10s–336s tuỳ nền tảng —
   nguồn nào không có luồng audio riêng thì yt-dlp phải tải cả video). Nên nó
   chạy THEO YÊU CẦU, người dùng tự bấm cho vài cảnh quan trọng, KHÔNG tự động
   cho cả trăm cảnh.

   Thứ tự ưu tiên, rẻ trước:
     1) phụ đề có sẵn của trang  — ~2s, khỏi tải media
     2) tải audio-only + Whisper — đắt hơn nhiều
*/
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { YTDLP } = require('./ytdlp-path');
const { claudeChat } = require('./smart-clip');

const TMP = path.join(os.tmpdir(), 'nova-khoploi');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

function chay(bin, args, hetGio = 300000) {
  return new Promise((res) => {
    const ps = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { try { ps.kill(); } catch (_) {} res({ ok: false, err: 'quá giờ' }); }, hetGio);
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', (e) => { clearTimeout(t); res({ ok: false, err: String(e.message || e) }); });
    ps.on('close', (c) => { clearTimeout(t); res({ ok: c === 0, out, err }); });
  });
}

const _kho = () => {
  try {
    const { app } = require('electron');
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'nova-settings.json'), 'utf8')) || {};
  } catch (_) { return {}; }
};

/* ── VTT/SRT → [{start, end, text}] ───────────────────────────────────────── */
function docPhuDe(vb) {
  const giay = (s) => {
    const m = String(s).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / (m[4].length === 2 ? 100 : 1000);
  };
  const ra = [];
  for (const kh of String(vb).split(/\r?\n\r?\n+/)) {
    const d = kh.split(/\r?\n/);
    const iM = d.findIndex((x) => x.includes('-->'));
    if (iM < 0) continue;
    const [a, b] = d[iM].split('-->');
    const s = giay(a), e = giay(b);
    if (s === null || e === null) continue;
    // Phụ đề tự động của YouTube nhồi thẻ <c> và lặp dòng — bóc sạch rồi mới gộp.
    const t = d.slice(iM + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t) ra.push({ start: +s.toFixed(2), end: +e.toFixed(2), text: t });
  }
  return ra;
}

/* ── 1) Thử phụ đề có sẵn ─────────────────────────────────────────────────── */
async function _thuPhuDe(url, ck) {
  const nen = path.join(TMP, 'sub_' + Date.now());
  const a = ['--no-warnings', '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'en.*,vi.*', '--sub-format', 'vtt/srt', '-o', nen + '.%(ext)s', url];
  if (ck) a.push('--cookies', ck);
  await chay(YTDLP, a, 90000);
  const f = fs.readdirSync(TMP).filter((x) => x.startsWith(path.basename(nen)) && /\.(vtt|srt)$/i.test(x));
  if (!f.length) return null;
  try {
    const doan = docPhuDe(fs.readFileSync(path.join(TMP, f[0]), 'utf8'));
    f.forEach((x) => { try { fs.unlinkSync(path.join(TMP, x)); } catch (_) {} });
    return doan.length >= 3 ? doan : null;
  } catch (_) { return null; }
}

/* ── 2) Tải tiếng + Whisper (Groq) ────────────────────────────────────────── */
async function _thuWhisper(url, ck) {
  const kho = _kho();
  const key = String(kho.t8_key_groq || '').trim();
  if (!key) return { loi: 'chưa có khoá Groq — vào Căn Timing & Phụ Đề để cắm' };
  const f = path.join(TMP, 'a_' + Date.now() + '.mp3');
  const a = ['--no-warnings', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3',
    '--audio-quality', '9', '-o', f.replace(/\.mp3$/, '.%(ext)s'), url];
  if (ck) a.push('--cookies', ck);
  const r = await chay(YTDLP, a, 420000);
  if (!fs.existsSync(f)) return { loi: 'không tải được tiếng: ' + String(r.err || '').slice(-90) };
  try {
    const buf = fs.readFileSync(f);
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'a.mp3');
    fd.append('model', 'whisper-large-v3-turbo');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'segment');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) return { loi: 'Whisper: ' + String((d && d.error && d.error.message) || res.status).slice(0, 90) };
    return { doan: (d.segments || []).map((s) => ({ start: +s.start.toFixed(2), end: +s.end.toFixed(2), text: String(s.text || '').trim() })) };
  } catch (e) {
    return { loi: String((e && e.message) || e).slice(0, 90) };
  } finally { try { fs.unlinkSync(f); } catch (_) {} }
}

/* ── 3) AI chọn đoạn khớp nhất ────────────────────────────────────────────── */
async function _chonDoan(doan, loiThoai, giay) {
  // Gộp đoạn ngắn liền nhau cho đủ dài, đỡ tốn token và khớp ngữ nghĩa tốt hơn.
  const gop = [];
  for (const d of doan) {
    const cuoi = gop[gop.length - 1];
    if (cuoi && (d.end - cuoi.start) <= Math.max(12, giay * 2)) { cuoi.end = d.end; cuoi.text += ' ' + d.text; }
    else gop.push({ start: d.start, end: d.end, text: d.text });
  }
  const ds = gop.slice(0, 120);
  const bang = ds.map((d, i) => `${i}. [${d.start}s] ${d.text.slice(0, 120)}`).join('\n');
  const p = `Đây là bản bóc băng một video, chia theo mốc giây.
Tôi cần đoạn NÓI ĐÚNG nội dung của câu thoại dưới đây để cắt ${giay} giây hình minh hoạ.

CÂU THOẠI CẦN MINH HOẠ: "${String(loiThoai).slice(0, 400)}"

BẢN BÓC BĂNG:
${bang}

Chọn ĐÚNG 1 số thứ tự đoạn khớp nội dung nhất. Nếu không đoạn nào liên quan, trả -1.
CHỈ trả về một con số, không giải thích.`;
  try {
    const r = await claudeChat(p);
    const m = String(r).match(/-?\d+/);
    const i = m ? parseInt(m[0], 10) : -1;
    if (!Number.isFinite(i) || i < 0 || i >= ds.length) return null;
    return ds[i];
  } catch (_) { return null; }
}

/* ── Điểm vào ─────────────────────────────────────────────────────────────── */
async function khopLoi({ url, narration, duration }, onProgress) {
  const bao = (p, m) => { try { onProgress && onProgress(p, m); } catch (_) {} };
  const giay = Math.max(1, Number(duration) || 4);
  if (!url || !String(narration || '').trim()) return { ok: false, error: 'thiếu URL hoặc lời thoại' };

  let ck = null;
  try { ck = await require('./nova-cookies').youtubeCookiesFile(); } catch (_) {}

  bao(15, 'Tìm phụ đề có sẵn…');
  let doan = await _thuPhuDe(url, ck);
  let nguon = 'phụ đề';

  if (!doan) {
    bao(35, 'Không có phụ đề — tải tiếng về để bóc băng…');
    const w = await _thuWhisper(url, ck);
    if (w.loi) return { ok: false, error: w.loi };
    doan = w.doan; nguon = 'Whisper';
  }
  if (!doan || doan.length < 2) return { ok: false, error: 'video này không có lời nói để khớp' };

  bao(80, `Khớp lời thoại với ${doan.length} đoạn…`);
  const chon = await _chonDoan(doan, narration, giay);
  if (!chon) return { ok: false, error: 'không đoạn nào khớp nội dung cảnh' };

  bao(100, 'Xong');
  return { ok: true, startSec: chon.start, nguon, soDoan: doan.length, doanText: chon.text.slice(0, 120) };
}

function registerKhopLoi(ipcMain) {
  const ch = 'nova:khopLoi';
  try { ipcMain.removeHandler(ch); } catch (_) {}
  ipcMain.handle(ch, async (e, payload) => {
    try {
      const onP = (p, m) => { try { e.sender.send('nova:khopLoiProgress', { percent: p, message: m }); } catch (_) {} };
      return await khopLoi(payload || {}, onP);
    } catch (err) { return { ok: false, error: String((err && err.message) || err).slice(0, 200) }; }
  });
  return [ch];
}
module.exports = { registerKhopLoi, khopLoi, docPhuDe };
