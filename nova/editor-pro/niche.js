// Tìm Ngách (Niche Finder) — 6 module, đấu vào đồ thật của Nova:
//   yt-dlp (cookie Nova) khám phá FREE → YouTube Data API (key Nova) enrich like/comment/sub
//   → Claude (cli-bridge) phân tích. + cache kết quả. Không dùng key/DB proprietary của Fractal.
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { YTDLP } = require('./ytdlp-path');   // ưu tiên bản đóng gói theo app (ytdlp-bin/), không có mới dò máy/PATH
let _ck = null; try { _ck = require('./nova-cookies'); } catch (_) {}
let _yt = null; try { _yt = require('./nova-yt'); } catch (_) {}

function run(args, timeoutMs = 150000) {
  return new Promise((res, rej) => {
    const ps = spawn(YTDLP, args, { windowsHide: true }); let o = '', e = '';
    const t = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} rej(new Error('yt-dlp timeout')); }, timeoutMs);
    ps.stdout.on('data', d => o += d); ps.stderr.on('data', d => e += d);
    ps.on('error', rej); ps.on('close', c => { clearTimeout(t); c === 0 ? res(o) : rej(new Error(e.split('\n').slice(-2).join(' '))); });
  });
}
async function claude(sys, content) {
  const r = await fetch('http://127.0.0.1:8790/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonnet', messages: [{ role: 'system', content: sys }, { role: 'user', content }] })
  });
  const d = await r.json();
  return (d.choices && d.choices[0] && d.choices[0].message.content) || '';
}
function safeJson(txt, fallback) {
  try { return JSON.parse(txt); } catch (_) {}
  let s = String(txt || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = s.indexOf('['), b = s.indexOf('{');
  const start = (a >= 0 && (b < 0 || a < b)) ? a : b;
  if (start >= 0) { const end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}')); if (end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {} } }
  return fallback;
}
async function cookies() { return _ck ? await _ck.youtubeCookiesFile().catch(() => null) : null; }
function daysSince(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd || '')) return null;
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6) - 1, dd = +yyyymmdd.slice(6, 8);
  const d = Math.floor((Date.now() - new Date(y, m, dd).getTime()) / 86400000);
  return d >= 0 ? d : null;
}
const kfmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n | 0);

// ── CACHE (memory + đĩa), TTL 6h, key = mod:seed ──
const CACHE_TTL = 6 * 3600 * 1000;
const _mem = new Map();
function cachePath() { const b = path.join(os.homedir(), '.nova'); try { fs.mkdirSync(b, { recursive: true }); } catch (_) {} return path.join(b, 'niche-cache.json'); }
function cacheLoad() { try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch (_) { return {}; } }
function cacheSave(obj) { try { fs.writeFileSync(cachePath(), JSON.stringify(obj)); } catch (_) {} }
function cacheGet(k) {
  let e = _mem.get(k); if (!e) { const disk = cacheLoad(); e = disk[k]; }
  if (e && (Date.now() - e.t) < CACHE_TTL) return e.v; return null;
}
function cachePut(k, v) { const e = { t: Date.now(), v }; _mem.set(k, e); const disk = cacheLoad(); disk[k] = e; cacheSave(disk); }
async function cached(mod, seed, fresh, onProgress, producer) {
  const k = mod + ':' + String(seed).toLowerCase().trim();
  if (!fresh) { const hit = cacheGet(k); if (hit) { onProgress(100, '(cache) Xong'); return { ...hit, fromCache: true }; } }
  const v = await producer();
  if (v && v.ok) cachePut(k, v);
  return v;
}

// Khám phá video theo từ khoá (yt-dlp FREE) → enrich (YT Data API nếu có key Nova).
async function searchVideos(query, n = 20, onProgress = () => {}) {
  onProgress(12, `Tìm "${query}" trên YouTube…`);
  const ck = await cookies();
  // Lấy luôn channel_url + channel_follower_count: tên kênh có dấu cách KHÔNG ghép được thành @handle,
  // và có sub từ yt-dlp thì tính được VPS ngay cả khi máy chưa có key YouTube API.
  const args = [`ytsearch${n}:${query}`, '--no-warnings', '--print', '%(view_count)s\t%(upload_date)s\t%(duration)s\t%(channel)s\t%(channel_url)s\t%(channel_follower_count)s\t%(id)s\t%(title)s'];
  if (ck) args.push('--cookies', ck);
  const out = await run(args);
  let vids = out.trim().split('\n').filter(Boolean).map(l => {
    const [v, up, d, ch, chUrl, sub, id, ...t] = l.split('\t');
    const views = parseInt(v) || 0, days = daysSince(up);
    const subs = parseInt(sub) || 0;
    return { views, date: up || '', days, dur: parseInt(d) || 0, channel: (ch || '').trim(), channelUrl: /^https?:/i.test(chUrl || '') ? chUrl.trim() : '', id: (id || '').trim(), url: id ? 'https://youtu.be/' + id : '', title: (t.join('\t') || '').trim(), vel: days != null ? Math.round(views / Math.max(days, 1)) : 0, likes: 0, comments: 0, subs, engRate: 0, viewPerSub: subs ? +(views / subs).toFixed(2) : 0, demand: views };
  }).filter(x => x.title);
  // Enrich chính xác (like/comment/sub) qua YT Data API — key của Nova
  let enriched = false;
  if (_yt) {
    try {
      onProgress(42, 'Bổ sung like/comment/sub (YouTube API)…');
      const { key, map } = await _yt.enrich(vids.map(x => x.id));
      if (key) {
        enriched = true;
        vids.forEach(x => { const e = map[x.id]; if (e) { x.views = e.views || x.views; x.likes = e.likes; x.comments = e.comments; x.dur = e.dur || x.dur; x.days = e.days != null ? e.days : x.days; x.channel = e.channel || x.channel; x.subs = e.subs; x.vel = e.vel || x.vel; x.engRate = e.engRate; x.viewPerSub = e.viewPerSub; x.demand = e.demand; } });
      }
    } catch (_) {}
  }
  return { vids, enriched };
}

// ══════════════════════════════════════════════════════════════════
//  1b) HOT TOPICS v2 — sửa 3 điểm yếu của topics():
//      · quét NHIỀU GÓC (4 truy vấn) thay vì 1 → không chỉ thấy một mặt của ngách
//      · chấm bằng BỘI SỐ so với trung vị ngách thay vì view/ngày tuyệt đối → kênh to hết át kênh nhỏ
//      · tách HAI CỬA SỔ thời gian → "đang lên" không bị video bùng nổ 5 tháng trước đè
// ══════════════════════════════════════════════════════════════════
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Sinh 3 biến thể truy vấn quanh seed (Claude, 1 lần gọi rẻ). Hỏng thì dùng biến thể mặc định.
async function sweepQueries(seed, onProgress = () => {}) {
  onProgress(6, 'Nghĩ các góc quét…');
  try {
    const raw = await claude(
      'Bạn là chuyên gia nghiên cứu ngách YouTube. CHỈ trả JSON mảng chuỗi, không giải thích.',
      `Ngách gốc: "${seed}".\nSinh 3 TRUY VẤN YouTube khác góc nhìn để quét cùng ngách này (đừng lặp lại từ gốc y hệt, mỗi cái nhắm 1 kiểu nội dung khác nhau).\nTrả JSON: ["…","…","…"]`);
    const arr = safeJson(raw, []);
    if (Array.isArray(arr) && arr.length) return [seed, ...arr.map(x => String(x || '').trim()).filter(Boolean)].slice(0, 4);
  } catch (_) {}
  return [seed, `bí ẩn ${seed}`, `${seed} ít ai biết`, `top ${seed}`];
}

async function hotTopics(seed, onProgress = () => {}, opts = {}) {
  return cached('hot', seed, opts.fresh, onProgress, async () => {
    const queries = await sweepQueries(seed, onProgress);
    // Quét từng góc, gộp lại, khử trùng theo id video.
    const seen = new Set(); const all = []; let enriched = false;
    for (let i = 0; i < queries.length; i++) {
      onProgress(10 + Math.round(i * 40 / queries.length), `Quét góc ${i + 1}/${queries.length}: "${queries[i].slice(0, 40)}"…`);
      try {
        const r = await searchVideos(queries[i], 20, () => {});
        enriched = enriched || r.enriched;
        r.vids.forEach(v => { if (v.id && !seen.has(v.id)) { seen.add(v.id); v.q = queries[i]; all.push(v); } });
      } catch (_) {}
    }
    if (!all.length) throw new Error('Không tìm được video cho từ khoá này.');

    // Trung vị ngách: chịu nhiễu tốt hơn trung bình khi có 1-2 video triệu view.
    const med = median(all.map(x => x.views).filter(v => v > 0)) || 1;
    all.forEach(x => {
      x.ratio = +(x.views / med).toFixed(2);
      x.vps = x.subs > 0 ? +(x.views / x.subs).toFixed(2) : 0;   // chỉ có khi enrich được sub
    });

    // Hai cửa sổ: ≤30 ngày = đang lên · 30-180 ngày = đã ăn. Chỉ giữ video vượt trung vị.
    const rising = all.filter(x => x.days != null && x.days <= 30 && x.ratio >= 1.2).sort((a, b) => b.ratio - a.ratio).slice(0, 14);
    const proven = all.filter(x => x.days != null && x.days > 30 && x.days <= 180 && x.ratio >= 1.5).sort((a, b) => b.ratio - a.ratio).slice(0, 14);
    if (!rising.length && !proven.length) throw new Error('Ngách này không có video nào vượt trung vị trong 180 ngày.');

    const fmt = (x) => `x${x.ratio} trung vị · ${kfmt(x.views)} view · ${x.days}d${x.vps ? ` · VPS ${x.vps}` : ''}${x.subs ? ` · kênh ${kfmt(x.subs)} sub` : ''} | ${x.channel} | ${x.title}`;
    onProgress(76, 'Claude gom nhóm chủ đề…');
    const raw = await claude(
      'Bạn là chuyên gia nghiên cứu ngách YouTube, trả lời tiếng Việt. CHỈ trả JSON hợp lệ, không giải thích ngoài JSON.',
      `Ngách: "${seed}". Trung vị ngách ${kfmt(med)} view. "Bội số" = view ÷ trung vị.\n` +
      (rising.length ? `\nĐANG LÊN (đăng ≤30 ngày):\n${rising.map(fmt).join('\n')}\n` : '') +
      (proven.length ? `\nĐÃ ĂN (30-180 ngày):\n${proven.map(fmt).join('\n')}\n` : '') +
      `\nGom thành tối đa 5 CHỦ ĐỀ (micro-topic). Mỗi chủ đề ghi rõ nó thuộc nhóm nào.\n` +
      `Khi giải thích "vì sao ăn", BÁM SỐ LIỆU ở trên (bội số, VPS, số sub của kênh đăng) — VPS cao ở kênh ít sub nghĩa là thuật toán đang đẩy CHỦ ĐỀ chứ không đẩy KÊNH.\n` +
      `Trả JSON mảng:\n{"topic":"tên ngắn","window":"rising|proven","heat":"Cao|Trung bình","ratio":số bội số trung bình,"count":số video,"why":"vì sao ăn, bám số liệu (1 câu)","angle":"góc làm khác biệt (1 câu)","title":"1 tiêu đề mẫu"}`);

    onProgress(100, 'Xong');
    const pick = (x) => ({ title: x.title, channel: x.channel, views: x.views, viewsFmt: kfmt(x.views), ratio: x.ratio, vps: x.vps, subs: x.subs, days: x.days, url: x.url, id: x.id });
    return {
      ok: true, seed, enriched, queries, median: Math.round(med), scanned: all.length,
      items: safeJson(raw, []),
      rising: rising.map(pick), proven: proven.map(pick),
    };
  });
}

// ══════════════════════════════════════════════════════════════════
//  1c) THẺ ĐIỂM KÊNH — 5 chỉ số sức khoẻ + outlier + kênh giống.
//      Tất cả từ yt-dlp (có %(channel_follower_count)s nên tính được VPS), không cần API key.
// ══════════════════════════════════════════════════════════════════
function normChannel(u) {
  let s = String(u || '').trim();
  if (!s) return s;
  if (!/^https?:/i.test(s)) s = 'https://www.youtube.com/' + (s.startsWith('@') ? s : '@' + s);
  return /\/videos\/?$/.test(s) ? s : s.replace(/\/+$/, '') + '/videos';
}

// 5 chỉ số của Fractal: VPS · VPH · tỉ lệ longform · độ ổn định · xu hướng (độ dốc hồi quy).
function channelMetrics(vids, subs) {
  if (!vids.length) return null;
  const recent = vids.slice(0, 20);
  const avg = recent.reduce((s, x) => s + x.views, 0) / recent.length;
  const vps = subs > 0 ? avg / subs : 0;
  // VPH: view/giờ của 5 video mới nhất — "nhiệt" hiện tại, khác hẳn view tổng.
  const last5 = recent.slice().sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)).slice(0, 5);
  const vph = last5.length ? last5.reduce((s, x) => s + x.views / Math.max(1, (x.days ?? 1) * 24), 0) / last5.length : 0;
  const longform = recent.filter(x => x.dur >= 480).length / recent.length;
  // Độ ổn định = hệ số biến thiên (lệch chuẩn ÷ trung bình). Thấp = đều đặn.
  const variance = recent.reduce((s, x) => s + Math.pow(x.views - avg, 2), 0) / recent.length;
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;
  // Xu hướng: hồi quy view theo TUỔI video. Dốc âm (video mới view cao hơn) = đang lên → đảo dấu.
  let trend = 0;
  const xy = recent.filter(x => x.days != null).map(x => [x.days, x.views]);
  if (xy.length >= 3) {
    const n = xy.length;
    const sx = xy.reduce((s, [x]) => s + x, 0), sy = xy.reduce((s, [, y]) => s + y, 0);
    const sxy = xy.reduce((s, [x, y]) => s + x * y, 0), sxx = xy.reduce((s, [x]) => s + x * x, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx + 1e-6);
    trend = avg > 0 ? -slope * 30 / avg : 0;   // đổi ra "thay đổi ~%/tháng so với view trung bình"
  }
  return { avgViews: Math.round(avg), vps: +vps.toFixed(2), vph: Math.round(vph), longform: +longform.toFixed(2), cv: +cv.toFixed(2), trend: +trend.toFixed(2) };
}
// Đã bật kiếm tiền? (suy đoán — YouTube không công khai)
function monetizedGuess(subs, m) {
  if (!m) return false;
  if (subs >= 2000) return true;
  if (m.avgViews >= 20000 && m.longform >= 0.3) return true;
  return m.avgViews >= 50000;
}
// Điểm sức khoẻ 0-100 gộp 5 chỉ số — để xếp hạng nhanh, chi tiết vẫn xem từng dòng.
function healthScore(m) {
  if (!m) return 0;
  const s = Math.min(30, (m.vps / 2) * 30)            // VPS 2.0 → kịch 30đ
    + Math.min(25, m.longform * 25)                    // longform 100% → 25đ
    + Math.min(20, Math.max(0, (1 - m.cv)) * 20)       // cv 0 → 20đ
    + Math.min(15, Math.max(0, m.trend) * 30)          // trend +50%/tháng → kịch 15đ
    + Math.min(10, Math.log10(Math.max(1, m.vph)) * 3);
  return Math.round(Math.max(0, Math.min(100, s)));
}

async function channelScorecard(channelUrl, onProgress = () => {}, opts = {}) {
  return cached('scorecard', channelUrl, opts.fresh, onProgress, async () => {
    const count = Math.max(8, Math.min(30, Number(opts.count) || 20));
    onProgress(10, 'Lấy video kênh…');
    const ck = await cookies();
    const args = [normChannel(channelUrl), '--no-warnings', '--playlist-items', '1-' + count,
      '--print', '%(id)s\t%(view_count)s\t%(duration)s\t%(upload_date)s\t%(channel)s\t%(channel_follower_count)s\t%(title)s'];
    if (ck) args.push('--cookies', ck);
    const out = await run(args);
    const vids = out.trim().split('\n').filter(Boolean).map(l => {
      const [id, v, d, up, ch, sub, ...t] = l.split('\t');
      return { id: (id || '').trim(), views: parseInt(v) || 0, dur: parseInt(d) || 0, days: daysSince(up), channel: (ch || '').trim(), subs: parseInt(sub) || 0, title: (t.join('\t') || '').trim(), url: id ? 'https://youtu.be/' + id : '' };
    }).filter(x => x.title && x.views >= 0);
    if (!vids.length) throw new Error('Không đọc được video của kênh này (kênh riêng tư hoặc sai link).');

    const subs = vids.find(x => x.subs > 0)?.subs || 0;
    const name = vids.find(x => x.channel)?.channel || String(channelUrl);
    const m = channelMetrics(vids, subs);
    onProgress(48, 'Tính chỉ số…');

    // Outlier: bội số so với TRUNG VỊ kênh (không phải trung bình — 1 video triệu view sẽ kéo lệch).
    const med = median(vids.map(x => x.views)) || 1;
    vids.forEach(x => x.ratio = +(x.views / med).toFixed(2));
    const outliers = vids.filter(x => x.ratio >= 1.5).sort((a, b) => b.ratio - a.ratio).slice(0, 8);

    let analysis = '';
    if (opts.analyze !== false && outliers.length) {
      onProgress(70, 'Claude đọc mô-típ…');
      try {
        analysis = await claude(
          'Bạn là chuyên gia nội dung YouTube, trả lời tiếng Việt, ngắn gọn.',
          `Kênh "${name}" (${kfmt(subs)} sub). Trung vị kênh ${kfmt(med)} view.\nChỉ số: VPS ${m.vps}× · longform ${Math.round(m.longform * 100)}% · độ ổn định (CV) ${m.cv} · xu hướng ${m.trend > 0 ? '+' : ''}${Math.round(m.trend * 100)}%/tháng.\n\nVIDEO VƯỢT TRỘI:\n${outliers.map(x => `x${x.ratio} · ${kfmt(x.views)} view · ${Math.round(x.dur / 60)}p · ${x.title}`).join('\n')}\n\nViết 3-5 câu: mô-típ nào đang ăn ở kênh này, và người mới chen vào bằng cách nào. Bám số liệu, không nói chung chung.`);
      } catch (_) {}
    }
    onProgress(100, 'Xong');
    return {
      ok: true, channel: name, subs, subsFmt: kfmt(subs), videoCount: vids.length, median: Math.round(med),
      metrics: m, health: healthScore(m), monetized: monetizedGuess(subs, m), analysis,
      outliers: outliers.map(x => ({ title: x.title, views: x.views, viewsFmt: kfmt(x.views), ratio: x.ratio, dur: x.dur, days: x.days, url: x.url, id: x.id })),
    };
  });
}

// KÊNH GIỐNG — không có API key nên bỏ tín hiệu featuredChannels (YouTube đã gỡ tab này ở nhiều kênh),
// dùng ĐỒNG XUẤT HIỆN: lấy từ khoá từ video top của kênh gốc → ytsearch → kênh nào lặp lại nhiều lần thì điểm cao.
async function similarChannels(channelUrl, onProgress = () => {}, opts = {}) {
  return cached('similar', channelUrl, opts.fresh, onProgress, async () => {
    onProgress(8, 'Đọc kênh gốc…');
    const seedCard = await channelScorecard(channelUrl, () => {}, { count: 12, analyze: false, fresh: opts.fresh });
    const seedName = seedCard.channel;
    // Từ khoá quét = tiêu đề của 5 video vượt trội nhất (đã bỏ số/ký tự thừa).
    const seeds = (seedCard.outliers.length ? seedCard.outliers : []).slice(0, 5).map(x => x.title)
      .concat(seedCard.outliers.length < 3 ? [seedName] : []);
    const queries = seeds.map(t => String(t).replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(w => w.length >= 4).slice(0, 5).join(' ')).filter(Boolean);
    if (!queries.length) throw new Error('Kênh này không đủ dữ liệu để tìm kênh giống.');

    // Gom theo channel_url (khoá ổn định) chứ không theo TÊN — tên có dấu cách thì ghép @handle sẽ hỏng.
    const score = new Map(), meta = new Map();
    for (let i = 0; i < queries.length; i++) {
      onProgress(15 + Math.round(i * 55 / queries.length), `Quét "${queries[i].slice(0, 34)}"…`);
      try {
        const { vids } = await searchVideos(queries[i], 15, () => {});
        const perQuery = new Set();
        vids.forEach(v => {
          const key = v.channelUrl || (v.channel || '').trim();
          if (!key || (v.channel || '').toLowerCase() === seedName.toLowerCase()) return;
          if (!perQuery.has(key)) { perQuery.add(key); score.set(key, (score.get(key) || 0) + 7); }   // +7 mỗi truy vấn xuất hiện
          const mm = meta.get(key) || { name: v.channel, views: 0, n: 0, subs: 0 };
          mm.views += v.views; mm.n++; if (v.subs > mm.subs) mm.subs = v.subs; if (v.channel) mm.name = v.channel;
          meta.set(key, mm);
        });
      } catch (_) {}
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(3, Math.min(8, Number(opts.limit) || 6)));
    if (!ranked.length) throw new Error('Không tìm được kênh nào cùng tệp.');

    // Chấm chỉ số thật cho từng ứng viên (mỗi kênh 1 lần yt-dlp, 12 video).
    const cards = [];
    for (let i = 0; i < ranked.length; i++) {
      const [key, pts] = ranked[i];
      const mm = meta.get(key) || {};
      const label = mm.name || key;
      onProgress(72 + Math.round(i * 26 / ranked.length), `Chấm "${String(label).slice(0, 26)}"…`);
      try {
        const c = await channelScorecard(key, () => {}, { count: 12, analyze: false });
        cards.push({ channel: c.channel, url: key, subs: c.subs, subsFmt: c.subsFmt, metrics: c.metrics, health: c.health, points: pts, hits: Math.round(pts / 7) });
      } catch (_) {
        // Đọc kênh hỏng thì vẫn giữ lại với sub lấy được từ kết quả tìm kiếm, đánh dấu partial.
        cards.push({ channel: label, url: key, subs: mm.subs || 0, subsFmt: kfmt(mm.subs || 0), metrics: null, health: 0, points: pts, hits: Math.round(pts / 7), partial: true });
      }
    }
    onProgress(100, 'Xong');
    return { ok: true, seed: seedName, queries, cards: cards.sort((a, b) => (b.metrics?.vps || 0) - (a.metrics?.vps || 0)) };
  });
}

// ══════════════════════════════════════════════════════════════════
//  1d) CHẤM Ý TƯỞNG B&W — thang "đen–trắng" của Fractal.
//      Ý hay có 2 loại: NHIỀU TẦNG (sâu, giữ chân tốt, kém hút click) và ĐEN–TRẮNG
//      (rút được thành cặp nhị phân <60 ký tự mà không mất chất). Ô này tối ưu vế thứ hai.
// ══════════════════════════════════════════════════════════════════
async function bwScore(payload = {}, onProgress = () => {}) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Cần nhập tiêu đề để chấm.');
  const niche = String(payload.niche || '').trim();
  onProgress(30, 'Claude chấm theo thang đen–trắng…');
  const raw = await claude(
    'Bạn là chuyên gia đặt tiêu đề YouTube, trả lời tiếng Việt. CHỈ trả JSON hợp lệ.',
    `Chấm tiêu đề theo THANG ĐEN–TRẮNG.\n\nTriết lý:\n- Ý tồi thì bỏ. Ý hay có 2 loại:\n  · NHIỀU TẦNG: phức tạp, khó nói gọn. Giữ chân tốt, HÚT CLICK KÉM.\n  · ĐEN–TRẮNG: rút được thành một cặp nhị phân rõ ràng dưới ~60 ký tự mà KHÔNG mất chất. Hút click mạnh.\n- Cặp nhị phân tạo căng thẳng: X vs Y, thật vs giả, thắng vs thua, thiên tài vs lừa đảo, an toàn vs nguy hiểm, nên vs không nên.\n- Tránh tiêu đề mô tả chung chung, tránh thuật ngữ, tránh ý nhiều tầng không rút gọn được.\n\nThang điểm 0-100:\n- 0-20: tầm thường, không có căng, dễ lướt qua\n- 21-50: có mới nhưng còn rộng/mơ hồ, chưa tạo tò mò ngay\n- 51-70: hook rõ, có căng, làm được\n- 71-85: đóng gói đen-trắng rất mạnh, "vì sao phải click" hiển nhiên\n- 86-100: hiếm — nhị phân bắt ngay + hàm ý sâu + mới lạ mà vẫn làm được\n\nTIÊU ĐỀ: "${title}"${niche ? `\nNGÁCH: ${niche}` : ''}\n\nTrả JSON:\n{"score":0-100,"poleA":"cực đối lập thứ nhất tìm thấy (rỗng nếu không có)","poleB":"cực thứ hai (rỗng nếu không có)","layered":true nếu là ý nhiều tầng,"verdict":"1-2 câu nhận xét, nói thẳng vấn đề","alts":[{"title":"tiêu đề viết lại","score":0-100,"why":"cặp đối lập là gì (ngắn)"}]}\nViết 4 tiêu đề thay thế, mỗi cái một cặp đối lập khác nhau, ưu tiên dưới 60 ký tự.`);
  onProgress(100, 'Xong');
  const d = safeJson(raw, null);
  if (!d) throw new Error('Claude trả về không phải JSON.');
  return { ok: true, title, niche, result: d, chars: title.length };
}



// 5) ATTENTION MARKETS — "Người xem…" (tệp khán giả ĐỘNG, khác "ngách" là chủ đề TĨNH).
//    Nâng cấp: mỗi tệp được XẾP HẠNG BẰNG SỐ OUTLIER gom được (fire count) chứ không để Claude tự sắp,
//    và mọi ý tưởng đều bị chấm theo thang đen–trắng.
async function attentionMarkets(seed, onProgress = () => {}, opts = {}) {
  return cached('attention', seed, opts.fresh, onProgress, async () => {
    const { vids, enriched } = await searchVideos(seed, 24, onProgress);
    if (!vids.length) throw new Error('Không tìm được video cho từ khoá này.');
    onProgress(58, 'Lọc video vượt trội…');
    // Chỉ xét OUTLIER: video vượt trung vị ngách — đó mới là chỗ có tệp khán giả đang đói.
    const med = median(vids.map(x => x.views).filter(v => v > 0)) || 1;
    vids.forEach(x => x.ratio = +(x.views / med).toFixed(2));
    const out = vids.filter(x => x.ratio >= 1.3).sort((a, b) => b.ratio - a.ratio).slice(0, 20);
    const pool = out.length >= 4 ? out : vids.slice(0, 16);
    const list = pool.map((x, i) => `${i}. x${x.ratio} · ${kfmt(x.views)} view · ${x.days ?? '?'}d · ${x.channel} | ${x.title}`).join('\n');

    onProgress(80, 'Claude dựng thị trường chú ý…');
    const raw = await claude(
      'Bạn là chuyên gia nghiên cứu khán giả YouTube, trả lời tiếng Việt. CHỈ trả JSON hợp lệ.',
      `Ngách "${seed}" là một CHỦ ĐỀ (tĩnh). Việc của bạn là tìm các THỊ TRƯỜNG CHÚ Ý (tệp khán giả, động).\n` +
      `Ví dụ: ngách "Bóng rổ" → thị trường chú ý "Người xem hiểu luật bóng rổ và chán bình luận sáo rỗng".\n\n` +
      `${pool.length} video vượt trội (bội số so với trung vị ngách ${kfmt(med)} view):\n${list}\n\n` +
      `Xếp MỖI video vào đúng một tệp khán giả, rồi gom thành tối đa 5 tệp. Bỏ tệp chỉ có 1 video.\n` +
      `Với mỗi tệp, nghĩ 1 ý tưởng video mới và chấm theo THANG ĐEN–TRẮNG:\n` +
      `- Ý ĐEN–TRẮNG rút được thành cặp nhị phân rõ ràng dưới ~60 ký tự mà không mất chất → hút click mạnh (71-100đ).\n` +
      `- Ý NHIỀU TẦNG sâu nhưng khó nói gọn → giữ chân tốt, hút click kém (21-50đ).\n\n` +
      `Trả JSON mảng:\n{"segment":"Người xem … (mô tả tệp, dưới 90 ký tự)","videos":[các số thứ tự video thuộc tệp này],"demand":"Cao|Trung bình","need":"họ muốn gì (1 câu)","idea":"tiêu đề ý tưởng mới","bw":0-100,"poles":"cặp đối lập trong ý tưởng đó (hoặc rỗng)"}`);

    const items = (safeJson(raw, []) || []).map(m => {
      const idx = (Array.isArray(m.videos) ? m.videos : []).map(Number).filter(i => pool[i]);
      return {
        ...m, fire: idx.length,
        avgViews: idx.length ? Math.round(idx.reduce((s, i) => s + pool[i].views, 0) / idx.length) : 0,
        samples: idx.slice(0, 3).map(i => ({ title: pool[i].title, viewsFmt: kfmt(pool[i].views), ratio: pool[i].ratio, url: pool[i].url })),
      };
    }).filter(m => m.segment).sort((a, b) => b.fire - a.fire);

    onProgress(100, 'Xong');
    return { ok: true, seed, enriched, median: Math.round(med), scanned: vids.length, outliers: pool.length, items };
  });
}


module.exports = {
  attentionMarkets,
  hotTopics, channelScorecard, similarChannels, bwScore,
};

if (require.main === module) {
  const [, , cmd = 'topics', ...rest] = process.argv; const seed = rest.join(' ') || 'AI tools';
  const fns = { attentionMarkets, hotTopics, channelScorecard, similarChannels };
  (fns[cmd] || hotTopics)(seed, (p, m) => console.log(`${p}% ${m}`), { fresh: true }).then(r => console.log('\n' + JSON.stringify(r, null, 2).slice(0, 2500))).catch(e => console.log('ERR', String(e.message || e).slice(0, 200)));
}
