/* ══ NGUỒN WEB — cầu nối phía main cho 50 nền tảng ═════════════════════════════
   Học kiến trúc từ folder "test tool" (main/source-search-service): cùng bộ 50
   nền tảng, cùng cách lọc URL theo luật allow/block. Nhưng tầng TÌM KIẾM bên đó
   đã hỏng khi đo lại (2026-08):
     · SearXNG worker  → 401 Unauthorized, cần key không có sẵn
     · Bing HTML       → 200 nhưng 0 kết quả: Bing bọc link trong bing.com/ck/a?u=a1<base64>
     · DuckDuckGo HTML → chạy ~100 truy vấn rồi 403 chặn IP
   Nên ở đây: ưu tiên API TÌM RIÊNG của từng nền tảng (không chặn, không key),
   nền tảng nào không có mới lùi về tìm web — và tìm web thì có phanh.

   Renderer không tự fetch được vì Bing/DDG/Dailymotion không gửi header CORS.
   Mọi truy vấn phải đi qua đây.                                              */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { YTDLP } = require('./ytdlp-path');
const { FFMPEG, FFPROBE, FFDIR } = require('./ff-path');
const { lapDuGiay } = require('./lap-du-giay');
const { youtubeCookiesFile } = require('./nova-cookies');   // app đã có sẵn, đường clip YouTube cũ vẫn dùng

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const NGAN = '|@|';   // phân tách trường khi in từ yt-dlp; tiêu đề video không bao giờ chứa chuỗi này

function tmpDir() {
  const d = path.join(os.tmpdir(), 'nova-nguon-web');
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}

/* ── GET thô, dùng cho cả API JSON lẫn trang HTML cần scrape ────────────────
   Trả text nguyên si; renderer tự parse. Không ném lỗi ra ngoài để một nền
   tảng chết không kéo cả lượt tìm chết theo.                                */
async function webGet(url, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Math.max(2000, Number(opts.timeoutMs) || 15000));
  try {
    const r = await fetch(String(url), {
      headers: Object.assign({ 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, opts.headers || {}),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? 'quá thời gian chờ' : String((e && e.message) || e);
    return { ok: false, status: 0, error: msg.slice(0, 120) };
  } finally { clearTimeout(to); }
}

function chay(bin, args, timeoutMs = 60000) {
  return new Promise((res, rej) => {
    const ps = spawn(bin, args, { windowsHide: true });
    let o = '', e = '';
    const t = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} rej(new Error('quá thời gian chờ')); }, timeoutMs);
    ps.stdout.on('data', (d) => { o += d; });
    ps.stderr.on('data', (d) => { e += d; });
    ps.on('error', rej);
    ps.on('close', (c) => { clearTimeout(t); c === 0 ? res(o) : rej(new Error(e.split('\n').filter(Boolean).slice(-1)[0] || ('mã thoát ' + c))); });
  });
}

/* ── Đọc thông tin 1 trang video BẤT KỲ ────────────────────────────────────
   Đây là chỗ yt-dlp thay hẳn được một tầng scrape: nó hiểu ~1800 trang, nên
   URL nào tìm web trả về (trần trụi, không tiêu đề, không ảnh) vẫn lấy đủ
   tiêu đề, thời lượng, ảnh đại diện. Đã đo chạy được trên Archive.org,
   Dailymotion, PeerTube.                                                    */
async function ytdlpInfo(url, timeoutMs = 45000) {
  try {
    const mau = ['%(title)s', '%(duration)s', '%(thumbnail)s', '%(extractor)s', '%(uploader)s', '%(license)s'].join(NGAN);
    const them = [];
    if (/(^|\.)(youtube\.com|youtu\.be)/i.test(String(url))) {
      const ck = await youtubeCookiesFile().catch(() => null);
      if (ck) them.push('--cookies', ck);
    }
    const out = await chay(YTDLP, ['--socket-timeout', '15', '--skip-download', '--no-warnings', '--no-playlist',
      ...them, '--print', mau, String(url)], timeoutMs);
    const p = String(out).split('\n')[0].split(NGAN);
    const naOff = (v) => String(v || '').trim().replace(/^NA$/, '');
    const d = Number(p[1]);
    return {
      ok: true,
      ten: naOff(p[0]),
      giay: Number.isFinite(d) ? Math.round(d) : 0,
      anh: /^https?:/i.test(String(p[2] || '').trim()) ? String(p[2]).trim() : '',
      may: naOff(p[3]),
      tacGia: naOff(p[4]),
      giayPhep: naOff(p[5]),
    };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 140) }; }
}

/* ── Tìm trên YouTube qua yt-dlp (ytsearch) ────────────────────────────────
   YouTube không có API miễn phí không key, nhưng ytsearch của yt-dlp thì có. */
async function ytdlpSearch(q, n = 8, timeoutMs = 60000) {
  try {
    const mau = ['%(id)s', '%(title)s', '%(duration)s'].join(NGAN);
    const out = await chay(YTDLP, ['--socket-timeout', '15', '--flat-playlist', '--no-warnings',
      '--print', mau, 'ytsearch' + Math.max(1, Math.min(20, Number(n) || 8)) + ':' + String(q)], timeoutMs);
    const items = String(out).trim().split('\n').filter(Boolean).map((d) => {
      const p = d.split(NGAN);
      const id = String(p[0] || '').trim();
      if (!id || id === 'NA') return null;
      return {
        url: 'https://www.youtube.com/watch?v=' + id,
        ten: String(p[1] || id).trim(),
        giay: Number(p[2]) || 0,
        anh: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      };
    }).filter(Boolean);
    return { ok: true, items };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 140), items: [] }; }
}

/* ── Tải + cắt đúng số giây của cảnh ───────────────────────────────────────
   Tên file băm từ URL chứ không lấy id kiểu YouTube: nguồn web có URL đủ kiểu,
   lấy id YouTube ra "undefined" là hai cảnh khác nhau ăn chung một file.     */
function tenFile(url, batDau, dai) {
  let h = 5381;
  const s = String(url);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'w' + h.toString(36) + '_' + Math.floor(batDau || 0) + '_' + Math.ceil(dai || 0) + '.mp4';
}

// Đo thời lượng thật của file đã cắt. Không đo được thì trả 0 (coi như đạt).
async function doGiay(file) {
  try {
    const o = await chay(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 20000);
    const d = Number(String(o).trim());
    return Number.isFinite(d) ? d : 0;
  } catch (_) { return 0; }
}

/* File có THẬT SỰ dùng được không.
   Chỉ hỏi fs.existsSync là hớ: ffmpeg thất bại vẫn kịp tạo file rỗng vài trăm
   byte, nhận vào là cảnh đen thui mà không báo gì (đã dính: 261 byte).       */
async function hopLe(file) {
  try {
    if (!fs.existsSync(file)) return false;
    if (fs.statSync(file).size < 10 * 1024) return false;
    return (await doGiay(file)) > 0.3;
  } catch (_) { return false; }
}

async function ytdlpClip(url, dai, batDau) {
  const a = Math.max(0, Math.floor(batDau || 0));
  const len = dai ? Math.ceil(dai) : 0;
  const out = path.join(tmpDir(), tenFile(url, a, len));
  if (fs.existsSync(out)) return { ok: true, path: out, cache: true };
  const nen = ['--socket-timeout', '20', '--no-warnings', '--no-playlist'];
  if (FFDIR) nen.push('--ffmpeg-location', FFDIR);
  // YouTube chặn tải không cookie bằng 403 (đã đo). App đã có sẵn cơ chế lấy
  // cookie mà module này quên dùng — nhánh clip YouTube cũ thì có.
  if (/(^|\.)(youtube\.com|youtu\.be)/i.test(String(url))) {
    const ck = await youtubeCookiesFile().catch(() => null);
    if (ck) nen.push('--cookies', ck);
  }
  const FMT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b';

  // đường 1: cắt ngay lúc tải — nhanh nhất, nhưng nhiều trang chặn range request
  if (len) {
    const tho = out.replace(/\.mp4$/, '_tho.mp4');
    try {
      await chay(YTDLP, [...nen, '-f', FMT, '--download-sections', '*' + a + '-' + (a + len),
        '--force-keyframes-at-cuts', '-o', tho, String(url)], 240000);
      if (await hopLe(tho)) {
        // yt-dlp cắt theo KEYFRAME nên hay dôi ra (đã đo: xin 4s, ra 6,05s).
        // Cảnh cần đúng số giây thì mới khớp lời đọc — dôi quá nửa giây là tỉa lại.
        const d = await doGiay(tho);
        if (d && Math.abs(d - len) > 0.5) {
          try {
            await chay(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', tho, '-t', String(len),
              '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', out], 180000);
          } catch (_) { /* xử lý ngay dưới bằng hopLe, không nuốt lặng */ }
          // Tỉa hỏng thì THÀ giữ bản thô hơi dôi còn hơn nhận file rỗng.
          if (!(await hopLe(out))) { try { fs.unlinkSync(out); } catch (_) {} }
        }
        if (!fs.existsSync(out)) { try { fs.renameSync(tho, out); } catch (_) {} }
        try { if (fs.existsSync(tho) && fs.existsSync(out) && tho !== out) fs.unlinkSync(tho); } catch (_) {}
        if (await hopLe(out)) { try { await lapDuGiay(out, len); } catch (_) {} return { ok: true, path: out }; }
      }
      try { fs.unlinkSync(tho); } catch (_) {}
    } catch (_) { for (const f of [tho, out]) { try { fs.unlinkSync(f); } catch (__) {} } }
  }
  // đường 2: tải nguyên rồi cắt bằng ffmpeg
  const nguyen = out.replace(/\.mp4$/, '_full.mp4');
  if (!fs.existsSync(nguyen)) {
    try { await chay(YTDLP, [...nen, '-f', FMT, '-N', '4', '-o', nguyen, String(url)], 600000); }
    catch (e) { try { fs.unlinkSync(nguyen); } catch (__) {} return { ok: false, error: String((e && e.message) || e).slice(0, 140) }; }
  }
  if (!(await hopLe(nguyen))) { try { fs.unlinkSync(nguyen); } catch (_) {} return { ok: false, error: 'tải về không ra file dùng được' }; }
  if (!len) return { ok: true, path: nguyen };
  let loiCat = '';
  try {
    await chay(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(a), '-i', nguyen, '-t', String(len),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', out], 300000);
  } catch (e) { loiCat = String((e && e.message) || e).slice(0, 100); }
  if (await hopLe(out)) { try { await lapDuGiay(out, len); } catch (_) {} return { ok: true, path: out }; }
  try { fs.unlinkSync(out); } catch (_) {}
  return { ok: false, error: 'cắt lỗi' + (loiCat ? ': ' + loiCat : ' (ra file rỗng)') };
}

// Dọn cache: giữ 2 GB gần nhất, xoá dần từ file cũ nhất.
function donCache(tranByte = 2 * 1024 * 1024 * 1024) {
  try {
    const d = tmpDir();
    const fl = fs.readdirSync(d).map((f) => {
      const p = path.join(d, f);
      try { const st = fs.statSync(p); return { p, size: st.size, mtime: st.mtimeMs }; } catch (_) { return null; }
    }).filter(Boolean);
    let tong = fl.reduce((a, x) => a + x.size, 0);
    if (tong <= tranByte) return;
    fl.sort((a, b) => a.mtime - b.mtime);
    for (const f of fl) { if (tong <= tranByte) break; try { fs.unlinkSync(f.p); tong -= f.size; } catch (_) {} }
  } catch (_) {}
}

function registerNguonWeb(ipcMain) {
  const H = {
    'web:get': (_e, p = {}) => webGet(p.url, p),
    'web:info': (_e, p = {}) => ytdlpInfo(p.url, p.timeoutMs),
    'web:search': (_e, p = {}) => ytdlpSearch(p.q, p.n, p.timeoutMs),
    'web:clip': (_e, p = {}) => { donCache(); return ytdlpClip(p.url, p.dur, p.start); },
  };
  for (const [ch, fn] of Object.entries(H)) { try { ipcMain.removeHandler(ch); } catch (_) {} ipcMain.handle(ch, fn); }
  return Object.keys(H);
}

module.exports = { registerNguonWeb, webGet, ytdlpInfo, ytdlpSearch, ytdlpClip };
