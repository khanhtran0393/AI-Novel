// Tìm & tải clip bằng yt-dlp (lean, không cần key). Kênh ai:findYoutubeVideos/findVideos/downloadVideos.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const TMP = path.join(os.tmpdir(), 'nova-editor-pro', 'clips');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}
const { YTDLP } = require('./ytdlp-path');   // ưu tiên bản đóng gói theo app (ytdlp-bin/), không có mới dò máy/PATH
const { youtubeCookiesFile } = require('./nova-cookies');
const { FFMPEG, FFDIR } = require('./ff-path');   // máy khách KHÔNG có ffmpeg trong PATH → phải chỉ tận nơi
const g = (o, ...k) => { for (const x of k) if (o && o[x] != null && o[x] !== '') return o[x]; return undefined; };

function run(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const ps = spawn(YTDLP, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} reject(new Error('yt-dlp timeout')); }, timeoutMs);
    ps.stdout.on('data', d => out += d); ps.stderr.on('data', d => err += d);
    ps.on('error', e => { clearTimeout(t); reject(e); });
    ps.on('close', c => { clearTimeout(t); c === 0 ? resolve(out) : reject(new Error(err.split('\n').slice(-3).join(' ') || ('exit ' + c))); });
  });
}

async function search(term, n = 5) {
  const out = await run(['ytsearch' + n + ':' + term, '--flat-playlist', '--no-warnings', '--print', '%(id)s|%(title)s|%(duration)s'], 45000);
  const preferShort=true;
  const items=out.trim().split('\n').filter(Boolean).map(line => {
    const [id, title, dur] = line.split('|');
    return { videoId: id, url: 'https://www.youtube.com/watch?v=' + id, webpageUrl: 'https://www.youtube.com/watch?v=' + id,
      title: title || id, durationSec: Number(dur) || null, thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', source: 'youtube' };
  });
  // ưu tiên clip 8-180s (stock ngắn), bỏ livestream/playlist dài
  if(preferShort){ items.sort((a,b)=>{ const sa=(a.durationSec>=8&&a.durationSec<=180)?0:1, sb=(b.durationSec>=8&&b.durationSec<=180)?0:1; return sa-sb || (a.durationSec||9999)-(b.durationSec||9999); }); }
  return items;
}

/* ── ĐOẠN HAY NHẤT THEO CHÍNH KHÁN GIẢ CỦA HỌ ────────────────────────────────
   YouTube công bố biểu đồ "most replayed" (100 mốc, value 0–1). yt-dlp lấy được
   qua %(heatmap)j. Đây là dữ liệu THẬT về đoạn nào người xem tua lại nhiều nhất
   — tốt hơn mọi cách đoán.

   Bẫy: mốc ĐẦU gần như luôn = 1.0 vì ai cũng xem từ giây 0. Đó là hiện tượng
   thống kê, không phải đoạn hay. Phải bỏ vùng đầu trước khi so.                */
async function probeVideo(url) {
  try {
    // MỘT lượt -J lấy hết: thời lượng + heatmap + storyboard. Gọi 3 lần riêng thì
    // chậm gấp ba mà YouTube cũng dễ chặn hơn.
    const out = await run(['--skip-download', '--no-warnings', '-J', String(url)], 60000);
    const j = JSON.parse(out);
    const duration = Number(j.duration) || 0;
    const heatmap = (Array.isArray(j.heatmap) && j.heatmap.length > 3) ? j.heatmap : null;
    // Storyboard = sprite YouTube dùng cho ô xem trước khi rê thanh tua.
    // Ưu tiên sb1 (160×90) — đủ nét mà nhẹ; sb0 to gấp đôi, tải lâu.
    let sb = null;
    const cand = (j.formats || []).filter(f => f && f.format_note === 'storyboard' && Array.isArray(f.fragments) && f.fragments.length);
    const pick = cand.find(f => f.format_id === 'sb1') || cand.find(f => f.format_id === 'sb0') || cand[0];
    if (pick) sb = {
      frags: pick.fragments.map(fr => ({ url: fr.url, dur: Number(fr.duration) || 0 })),
      rows: Number(pick.rows) || 5, cols: Number(pick.columns) || 5,
      w: Number(pick.width) || 160, h: Number(pick.height) || 90,
    };
    return { duration, heatmap, sb };
  } catch (_) { return { duration: 0, heatmap: null, sb: null }; }
}

// Trả mốc BẮT ĐẦU (giây) của cửa sổ `want` giây có điểm xem lại trung bình cao nhất.
// Không có heatmap → lùi về 20% thời lượng (qua intro), vẫn hơn cắt từ giây 0.
function bestWindow(heatmap, duration, want) {
  const dur = Number(duration) || 0, W = Math.max(1, Number(want) || 10);
  if (!(dur > W + 2)) return 0;
  const SKIP_HEAD = Math.max(8, dur * 0.06);          // bỏ vùng đầu: mốc 0 luôn = 1.0
  const maxStart = Math.max(0, dur - W - 1);
  if (!Array.isArray(heatmap) || heatmap.length < 4) {
    return Math.min(maxStart, Math.max(SKIP_HEAD, dur * 0.2));
  }
  const at = (t) => {                                  // điểm tại giây t
    for (const b of heatmap) if (t >= b.start_time && t < b.end_time) return Number(b.value) || 0;
    return 0;
  };
  const step = Math.max(1, Math.round(dur / 200));
  let best = -1, bestS = Math.min(maxStart, SKIP_HEAD);
  for (let s = SKIP_HEAD; s <= maxStart; s += step) {
    let sum = 0, n = 0;
    for (let t = s; t < s + W; t += step) { sum += at(t); n++; }
    const avg = n ? sum / n : 0;
    if (avg > best) { best = avg; bestS = s; }
  }
  return Math.round(bestS);
}

// Chạy ffmpeg (khác run() ở trên — cái đó chạy yt-dlp).
function runFf(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    const t = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} reject(new Error('ffmpeg timeout')); }, timeoutMs);
    ps.stderr.on('data', d => err += d);
    ps.on('error', e => { clearTimeout(t); reject(e); });
    ps.on('close', c => { clearTimeout(t); c === 0 ? resolve(1) : reject(new Error(err.split('\n').slice(-3).join(' '))); });
  });
}

/**
 * Thang định dạng, thử lần lượt cho tới khi ra file.
 *
 * KHÔNG có bộ nào ăn mọi video — đã đo trên hai clip:
 *   0ejnenppJTE : DASH 398+140 ✓  ·  progressive 18 ✗ 403
 *   dQw4w9WgXcQ : DASH 398+140 ✗ 403  ·  HLS 95 ✓
 * itag nào bị chặn là chuyện của từng video, nên cứ thử xuống dần.
 */
const FMTS = [
  'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba',   // DASH
  'best[height<=720][ext=mp4]/best[height<=720]',                // progressive hoặc HLS
  'best',
];

/**
 * Giữ thư mục tạm dưới ngưỡng. Đường 2 kéo NGUYÊN video về (vài chục–vài trăm MB
 * mỗi cái) — chạy một dự án 200 cảnh là thừa sức lấp ổ, mà lỗi hết đĩa thì hiện ra
 * ở chỗ chẳng liên quan gì (ghi dự án hỏng, ffmpeg chết giữa chừng). Nên trước mỗi
 * lần tải nguyên thì dọn: xoá bản _full cũ nhất cho tới khi tổng < CACHE_MAX.
 * Chỉ đụng file do chính hàm này tạo trong thư mục tạm của app.
 */
const CACHE_MAX = 3 * 1024 * 1024 * 1024;              // 3 GB
function pruneCache() {
  try {
    const files = fs.readdirSync(TMP)
      .filter(f => f.endsWith('_full.mp4'))
      .map(f => { const fp = path.join(TMP, f); const st = fs.statSync(fp); return { fp, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at);                    // mới nhất trước
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files) {
      if (total <= CACHE_MAX) break;
      try { fs.unlinkSync(f.fp); total -= f.size; } catch (_) {}
    }
  } catch (_) {}
}

const ytIdOf = (url) => {
  const m = String(url).match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/([\w-]{11})$/);
  return m ? (m[1] || m[2] || m[3]) : Buffer.from(String(url)).toString('hex').slice(0, 11);
};

/**
 * Tải một đoạn video về máy.
 *
 * ⚠️ Vì sao có hai đường: --download-sections bảo yt-dlp nhờ ffmpeg tự kéo dải byte
 * qua HTTPS. Nhưng link googlevideo giờ gắn chặt với client cấp nó, ffmpeg gọi vào
 * là YouTube trả 403 Forbidden — đã đo, thua ở CẢ web / web_safari / mweb /
 * tv_simply / android_vr, tức không phải đổi client là xong. Nên hỏng thì quay
 * sang: yt-dlp tự tải nguyên video (nó gửi đúng header nên không 403), rồi ffmpeg
 * cắt tại chỗ. Tốn băng thông hơn nhưng chắc chắn ra clip.
 */
async function downloadOne(url, maxSec, startSec) {
  const id = ytIdOf(url);
  const a = Math.max(0, Math.floor(startSec || 0));
  const len = maxSec ? Math.ceil(maxSec) : 0;
  // ⚠️ Tên file cũ chỉ có id → cảnh sau xin đoạn khác của CÙNG video là ăn ngay
  // file đoạn cũ trong cache, cắt sai chỗ mà không báo gì. Phải kèm mốc cắt.
  const out = path.join(TMP, len ? `${id}_${a}_${len}.mp4` : `${id}.mp4`);
  if (fs.existsSync(out)) return out;
  const ck = await youtubeCookiesFile().catch(() => null);
  const base = ['--no-warnings', '--no-playlist'];
  // Không truyền --ffmpeg-location thì yt-dlp bỏ cuộc ngay ("ffmpeg is not
  // installed") trên mọi máy khách — đã đo.
  if (FFDIR) base.push('--ffmpeg-location', FFDIR);
  if (ck) base.push('--cookies', ck);

  // ── đường 1: cắt sẵn khi tải. Nhanh nhất, nhưng hay dính 403.
  if (len) {
    try {
      await run([...base, '-f', FMTS[0], '--download-sections', `*${a}-${a + len}`, '--force-keyframes-at-cuts', '-o', out, url], 180000);
      if (fs.existsSync(out)) return out;
    } catch (_) { try { fs.unlinkSync(out); } catch (__) {} }
  }

  // ── đường 2: tải nguyên rồi cắt. Bản nguyên dùng chung cho mọi cảnh cùng video.
  pruneCache();
  const full = path.join(TMP, id + '_full.mp4');
  if (!fs.existsSync(full)) {
    for (const f of FMTS) {
      try { await run([...base, '-f', f, '-N', '4', '-o', full, url], 600000); } catch (_) {}
      if (fs.existsSync(full)) break;
      try { fs.unlinkSync(full); } catch (__) {}
    }
  }
  if (!fs.existsSync(full)) return null;
  if (!len) return full;
  try {
    await runFf(['-hide_banner', '-loglevel', 'error', '-ss', String(a), '-i', full, '-t', String(len),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', out]);
  } catch (_) { try { fs.unlinkSync(out); } catch (__) {} return null; }
  return fs.existsSync(out) ? out : null;
}

function registerEditorProClips(ipcMain) {
  const termOf = (p) => String(g(p, 'term', 'keyword', 'query', 'q', 'text') || '').trim();
  const countOf = (p) => Math.max(1, Math.min(10, Number(g(p, 'count', 'limit', 'max', 'n')) || 5));
  const findHandler = async (_e, payload = {}) => {
    try {
      const term = termOf(payload);
      if (!term) return { ok: false, error: 'Thiếu từ khoá', items: [] };
      const items = await search(term, countOf(payload));
      return { ok: true, items, results: items };
    } catch (e) { return { ok: false, error: 'yt-dlp: ' + String(e.message || e), items: [] }; }
  };
  const H = {
    'ai:findYoutubeVideos': findHandler,
    'ai:findVideos': findHandler,
    'ai:downloadVideos': async (_e, payload = {}) => {
      try {
        let list = g(payload, 'items', 'videos', 'urls', 'list') || [];
        if (!Array.isArray(list)) list = [list];
        const out = [];
        for (const it of list) {
          const url = typeof it === 'string' ? it : (g(it, 'url', 'webpageUrl', 'href', 'link', 'sourceUrl') || '');
          if (!url) { out.push({ ...(typeof it === 'object' ? it : {}), ok: false }); continue; }
          try {
            const fp = await downloadOne(url);
            out.push({ ...(typeof it === 'object' ? it : { url }), ok: !!fp, filePath: fp, localPath: fp, path: fp, file: fp });
          } catch (err) { out.push({ ...(typeof it === 'object' ? it : { url }), ok: false, error: String(err.message || err) }); }
        }
        return { ok: true, items: out, results: out };
      } catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
    },
  };
  for (const [ch, fn] of Object.entries(H)) { try { ipcMain.removeHandler(ch); } catch (_) {} ipcMain.handle(ch, fn); }
  return Object.keys(H);
}

const { novaLocalStorage } = require("./nova-keys");
async function searchPexels(kw, n=5) {
  const key = await novaLocalStorage("pexels-key"); if (!key) return [];
  try {
    const r = await fetch("https://api.pexels.com/videos/search?query="+encodeURIComponent(kw)+"&per_page="+n+"&orientation=landscape&size=medium", { headers: { Authorization: key } });
    const d = await r.json();
    return (d.videos||[]).map(v => { const files=(v.video_files||[]).filter(f=>f.file_type==="video/mp4"); const pick=files.filter(f=>f.height>=540&&f.height<=1080).sort((a,b)=>a.height-b.height)[0]||files[0]; return pick?{ url: pick.link, title:"pexels-"+v.id, durationSec:v.duration, source:"pexels" }:null; }).filter(Boolean);
  } catch(_) { return []; }
}
async function downloadPexels(url, out) {
  try { const r = await fetch(url); if(!r.ok) return null; const buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(out, buf); return fs.existsSync(out)&&fs.statSync(out).size>10000 ? out : null; } catch(_) { return null; }
}


async function searchPexelsPhotos(kw, n=4) {
  const key = await novaLocalStorage("pexels-key"); if (!key) return [];
  try {
    const r = await fetch("https://api.pexels.com/v1/search?query="+encodeURIComponent(kw)+"&per_page="+n+"&orientation=landscape", { headers: { Authorization: key } });
    const d = await r.json();
    return (d.photos||[]).map(p => ({ url: (p.src&&(p.src.large2x||p.src.large))||"", title:"pexels-photo-"+p.id, source:"pexels-photo" })).filter(x=>x.url);
  } catch(_) { return []; }
}
async function downloadPhoto(url, out) {
  try { const r = await fetch(url); if(!r.ok) return null; fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); return fs.existsSync(out)&&fs.statSync(out).size>5000?out:null; } catch(_) { return null; }
}

module.exports = { probeVideo, bestWindow, registerEditorProClips, search, downloadOne, searchPexels, downloadPexels, searchPexelsPhotos, downloadPhoto };
