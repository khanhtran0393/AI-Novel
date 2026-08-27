// Smart clip giống Fractal (dùng Claude qua cli-bridge, không cần key OpenAI):
//  1) scoreCandidates: Claude chọn video hợp nhất
//  2) bannedRanges: Claude vision xem frame nào có mặt người/chữ/UI
//  3) pickSmartSourceStart: golden ratio né banned ranges
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { FFMPEG, FFPROBE } = require('./ff-path');   // đường dẫn đã gỡ khỏi app.asar (spawn được)
const { pickSmartSourceStart } = require('./smart-source-start');
const TMP = path.join(os.tmpdir(), 'nova-smart'); try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}
const run = (b, a) => new Promise((res, rej) => { const p = spawn(b, a, { windowsHide: true }); let e = ''; p.stderr.on('data', d => e += d); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(e.slice(-200)))); });
const durOf = f => { try { const o = require('child_process').execSync(`"${FFPROBE}" -v quiet -print_format json -show_format "${f}"`).toString(); return parseFloat(JSON.parse(o).format.duration) || 0; } catch (_) { return 0; } };

/* ══ GỌI MÔ HÌNH ══════════════════════════════════════════════════════════
   Bản cũ ghi cứng cầu nối CLI ở cổng 8790. Cầu nối chạy `claude` CLI trên máy,
   nên hết hạn đăng nhập là cả ba tính năng (chấm điểm · Vision · dịch lời
   thoại) chết câm — chúng đều bọc trong catch nên không ai hay.

   Nay dùng ĐÚNG khoá API người dùng đã cấu hình trong app (kho nova-settings),
   cầu nối CLI chỉ còn là chỗ lùi. Nội dung vốn đã đúng định dạng OpenAI
   (mảng {type:'text'} / {type:'image_url'}) nên gửi thẳng được, kể cả ảnh.   */
const _KHO = () => {
  try {
    const { app } = require('electron');
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'nova-settings.json'), 'utf8')) || {};
  } catch (_) { return {}; }
};

/* Model MẶC ĐỊNH riêng cho smart-clip — cố tình NHẸ hơn model chung của app.
   Ba việc ở đây (chọn index, đọc khung hình, rút một cụm từ khoá) không cần
   mô hình mạnh, mà lại chạy hàng trăm lượt mỗi video. Đã đo trên máy này:
   gpt-5-mini 15s/lượt · gpt-4o-mini 1,2s/lượt — đo trên 4 câu thật, nhanh
   gấp 20 lần, cụm từ khoá dùng được như nhau.

   DÙNG CHUNG nhà cung cấp với phần sinh kịch bản, chỉ khác BẬC model:
     chọn GPT-5 / GPT-5-mini cho chia cảnh  → smart-clip vẫn chạy gpt-4o-mini
     chọn Claude Sonnet/Opus cho chia cảnh  → smart-clip vẫn chạy Haiku 4.5
   Bắt buộc là model ĐỌC ĐƯỢC ẢNH vì bannedRanges gửi khung hình.
   Muốn đổi: đặt khoá `api_model_clip` trong kho cài đặt.                    */
const _NHA_CC = {
  openai:     { kieu: 'oa', url: 'https://api.openai.com/v1/chat/completions',      khoa: 'api_key_openai',     mac: 'gpt-4o-mini' },
  openrouter: { kieu: 'oa', url: 'https://openrouter.ai/api/v1/chat/completions',   khoa: 'api_key_openrouter', mac: 'openai/gpt-4o-mini' },
  groq:       { kieu: 'oa', url: 'https://api.groq.com/openai/v1/chat/completions', khoa: 'api_key_groq',       mac: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  deepseek:   { kieu: 'oa', url: 'https://api.deepseek.com/chat/completions',       khoa: 'api_key_deepseek',   mac: 'deepseek-v4-flash' },
  gemini:     { kieu: 'oa', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                khoa: 'api_key_gemini', mac: 'gemini-2.5-flash-lite' },
  anthropic:  { kieu: 'an', url: 'https://api.anthropic.com/v1/messages',           khoa: 'api_key_anthropic',  mac: 'claude-haiku-4.5' },
};

/* Anthropic nhận ảnh theo kiểu KHÁC OpenAI. Nội dung trong smart-clip vốn viết
   theo kiểu OpenAI, nên phải đổi khi gửi sang Anthropic:
     OpenAI    { type:'image_url', image_url:{ url:'data:image/png;base64,…' } }
     Anthropic { type:'image', source:{ type:'base64', media_type, data } }     */
function _sangAnthropic(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map((x) => {
    if (!x || x.type !== 'image_url') return x;
    const u = String((x.image_url && x.image_url.url) || '');
    const m = u.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { type: 'text', text: '' };
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  }).filter((x) => x && (x.type !== 'text' || x.text));
}


async function _goiApi(content, kho) {
  const nc = _NHA_CC[String(kho.api_provider || '').trim().toLowerCase()];
  if (!nc) return null;
  /* Ô key trong app cho phép NHIỀU khoá, mỗi khoá một dòng ("nhiều key =
     chạy song song"). Lấy nguyên khối là gửi cả xâu xuống dòng làm khoá → 401.
     smart-clip chạy tuần tự nên chỉ cần khoá đầu tiên còn dùng được.        */
  const key = String(kho[nc.khoa] || kho.api_key || '')
    .split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
  if (!key) return null;
  // Ưu tiên model riêng của smart-clip; KHÔNG lấy api_model chung của app —
  // model chung thường là loại mạnh/đắt, chạy hàng trăm lượt thì phí và chậm.
  const model = String(kho.api_model_clip || '').trim() || nc.mac;
  // Base URL tuỳ chọn (dùng API bên thứ ba) — cùng ô người dùng đã nhập ở tab API.
  const goc = String(kho.api_base_url || '').trim().replace(/\/+$/, '');

  if (nc.kieu === 'an') {
    const url = goc ? goc + '/v1/messages' : nc.url;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: _sangAnthropic(content) }] }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error((d && d.error && d.error.message) || ('HTTP ' + r.status));
    return ((d && d.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }

  const url = goc ? goc + '/chat/completions' : nc.url;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.error && d.error.message) || ('HTTP ' + r.status));
  return (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}


async function _goiCauNoi(content, kho) {
  const ep = String(kho.api_cli_endpoint || 'http://127.0.0.1:8790').replace(/\/+$/, '');
  const r = await fetch(ep + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonnet', messages: [{ role: 'user', content }] }),
  });
  const d = await r.json().catch(() => null);
  if (d && d.error) throw new Error(String(d.error.message || d.error).slice(0, 90));
  return (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}

async function claudeChat(content) {
  const kho = _KHO();
  try {
    const r = await _goiApi(content, kho);          // 1) khoá API đã cấu hình
    if (r != null) return r;
  } catch (e) {
    console.warn('[smart-clip] API lỗi, lùi về cầu nối CLI:', (e && e.message) || e);
  }
  return await _goiCauNoi(content, kho);            // 2) cầu nối CLI tự host
}


// 0) DỊCH lời thoại → cụm HÌNH cụ thể để tìm stock (bí quyết Fractal: né ẩn dụ).
//    vd "sit in a metal tube for three hours" → "airplane cabin interior".
async function visualQuery(narration, hint, topic) {
  const text = String(narration || '').slice(0, 600).trim();
  const h = String(hint || '').trim();
  if (!text) return h;
  // 3 nguồn, ưu tiên theo độ tin cậy:
  //   hint  = prompt ảnh của CHÍNH cảnh này — đã là mô tả HÌNH, nêu thẳng nơi chốn
  //   topic = chủ đề cả video — để phân biệt nghĩa ("gate" sân bay ≠ "gate" nhà hàng)
  //   text  = lời thoại — nhiều ẩn dụ nhất, dễ lạc nhất
  const prompt = `Bạn là biên tập B-roll. Trả về 1 CỤM TÌM STOCK FOOTAGE tiếng Anh, 3-6 từ.

${topic ? `CHỦ ĐỀ CẢ VIDEO: "${String(topic).slice(0, 220)}"\n` : ''}${h ? `MÔ TẢ HÌNH CỦA CẢNH (nguồn ĐÁNG TIN NHẤT — bám vào đây trước): "${h.slice(0, 320)}"\n` : ''}LỜI THOẠI: "${text}"

LUẬT:
- Cụm phải là HÌNH quay được: danh từ + (hành động) + NƠI CHỐN. Luôn có nơi chốn hoặc vật thể cụ thể.
- ⛔ CẤM trả về từ ĐA NGHĨA đứng một mình. Phải kèm bối cảnh để chốt nghĩa:
    "gate" → "airport departure gate" (KHÔNG phải cổng nhà, cổng nhà hàng)
    "bank" → "bank branch interior" (KHÔNG phải bờ sông)
    "terminal" → "airport terminal hall" (KHÔNG phải máy tính)
    "carrier" → "airline aircraft" (KHÔNG phải tàu sân bay)
- Lời thoại ẩn dụ thì dịch sang hình gần nhất: "sit in a metal tube" → "airplane cabin interior";
  "handed over money" → "person paying cash counter".
- ⛔ KHÔNG từ trừu tượng (mindset, freedom, value), KHÔNG "explained/recap/reaction/podcast".
- Nếu MÔ TẢ HÌNH đã nêu nơi chốn (sân bay, văn phòng, bếp…), BẮT BUỘC giữ nơi chốn đó trong cụm.

Chỉ trả về DUY NHẤT cụm tìm (tiếng Anh), không giải thích, không dấu ngoặc.`;
  try {
    const r = await claudeChat(prompt);
    let q = String(r || '').trim().split('\n')[0].split(/[,;]/)[0].replace(/^["'`\-\d.\s]+|["'`.]+$/g, '').trim();
    return q.split(/\s+/).slice(0, 7).join(' ') || String(hint || text).slice(0, 60);
  } catch (_) { return String(hint || text).slice(0, 60); }
}

// 1) Chấm điểm: Claude chọn candidate hợp nhất
/* ══ LỌC RÁC TRƯỚC KHI CHẤM ═══════════════════════════════════════════════
   Đường YouTube trước đây đưa thẳng ứng viên cho AI chấm. AI đọc tiêu đề nên
   phần lớn bắt được, nhưng AI hỏng (mất mạng, hết khoá) là lấy bừa ứng viên 0
   — mà YouTube chính là nơi nhiều AMV / fan edit / gameplay nhất.

   Bộ luật này chạy TRƯỚC, không cần mạng: loại thẳng loại không bao giờ dùng
   được, đẩy loại kém xuống cuối. Lọc bớt rồi mới hỏi AI cũng đỡ token.

   ⚠️ Bản SONG SINH của _T2_LOAI_NGUON bên web/index.html — sửa một bên thì
   sửa cả hai. Renderer không require được nên đành chép.                     */
const _LOAI_CHAN = [
  { lop: 'nhạc/AMV',   re: /\b(amv|music video|official (?:video|audio)|lyrics?|lyric video|ost|soundtrack|full song|cover|remix|concert|live performance|instrumental|karaoke)\b/i },
  { lop: 'fan edit',   re: /\b(compilation|fan ?edit|edits|tribute|highlights?|best (?:moments|scenes|of)|top \d+|scene ?pack|twixtor)\b/i },
  { lop: 'gameplay',   re: /\b(gameplay|walkthrough|speedrun|let'?s play|board game|card game|mod showcase)\b/i },
  { lop: 'repost MXH', re: /\b(tiktok|capcut|reels?|repost)\b/i },
  { lop: 'fan trailer',re: /\b(fan ?(?:trailer|made|film)|concept trailer|live action (?:remake|version))\b/i },
];
const _LOAI_TRU = [
  { d: -6, re: /\b(interview|podcast|reaction|reacts?|vlog|talking head|explains?|explained|review|unboxing|q&a|commentary|analysis|breakdown|recap|video essay)\b/i },
  { d: -4, re: /\b(tutorial|lesson|course|seminar|webinar|lecture|how to)\b/i },
  { d: -3, re: /\b(behind the scenes|making of|bloopers?)\b/i },
];
const _LOAI_TOT = /\b(4k|uhd|1080p|60fps|no copyright|copyright[- ]free|stock footage|b[- ]?roll|aerial|drone|timelapse)\b/i;

/* Trả { ds, bo } — ds đã xếp lại, bo là thống kê loại theo lớp.             */
function locRac(cands, sceneDur) {
  const bo = {}; const giu = [];
  for (const c of (cands || [])) {
    const ten = String((c && c.title) || '');
    const chan = ten && _LOAI_CHAN.find((x) => x.re.test(ten));
    if (chan) { bo[chan.lop] = (bo[chan.lop] || 0) + 1; continue; }
    const giay = Number(c && c.durationSec) || 0;
    // Clip ngắn hơn cảnh thì không lấp đủ — loại luôn, khỏi tải về mới biết.
    if (giay > 0 && sceneDur > 0 && giay < sceneDur * 0.9) { bo['ngắn hơn cảnh'] = (bo['ngắn hơn cảnh'] || 0) + 1; continue; }
    let d = 0;
    if (ten) {
      const tru = _LOAI_TRU.find((x) => x.re.test(ten));
      if (tru) d += tru.d;
      if (_LOAI_TOT.test(ten)) d += 1.5;
      if ((ten.match(/#/g) || []).length >= 2) d -= 2;
    }
    if (giay >= sceneDur * 1.5 && giay <= 600) d += 3;
    else if (giay > 3600) d -= 2;
    giu.push({ c, d });
  }
  giu.sort((a, b) => b.d - a.d);
  return { ds: giu.map((x) => x.c), bo };
}

async function scoreCandidates(sceneText, keyword, candidates, topic) {
  if (!candidates || candidates.length <= 1) return 0;
  const list = candidates.map((c, i) => `${i}. "${(c.title || '').slice(0, 70)}" (${c.durationSec || '?'}s, ${c.source || 'yt'})`).join('\n');
  // Có chủ đề cả video thì bước chấm mới loại được clip "đúng chữ nhưng sai ngành"
  // (tiêu đề có "Gate" nhưng là nhà hàng, trong khi video nói về hàng không).
  const txt = `${topic ? `CHỦ ĐỀ CẢ VIDEO: "${String(topic).slice(0, 200)}"\n` : ''}Cảnh cần b-roll minh họa: "${sceneText}"
Từ khóa: ${keyword}
Chọn video HỢP NHẤT (đúng chủ đề, ưu tiên stock/cinematic sạch; TRÁNH reaction/vlog/talking-head/compilation/nhạc lyric/tin tức).
⚠️ Tiêu đề CHỨA ĐÚNG CHỮ nhưng SAI NGÀNH thì loại — vd video về hàng không mà clip là nhà hàng tên "Gate".
Nếu KHÔNG clip nào hợp chủ đề, chọn clip TRUNG TÍNH nhất (cảnh vật/đồ vật) thay vì clip sai ngành.
Danh sách:
${list}
Chỉ trả về 1 CON SỐ index (0-${candidates.length - 1}).`;
  try { const r = await claudeChat(txt); const m = String(r).match(/\d+/); const i = m ? parseInt(m[0]) : 0; return (i >= 0 && i < candidates.length) ? i : 0; } catch (_) { return 0; }
}

// 2) Vision: frame nào có mặt người/chữ/UI → banned ranges (giây)
async function bannedRanges(clipPath, mediaDur, topic) {
  const every = Math.max(1.0, mediaDur / 8);
  const n = Math.max(2, Math.min(8, Math.floor(mediaDur / every)));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = +(i * every).toFixed(2); const out = path.join(TMP, `fr_${Date.now()}_${i}.png`);
    try { await run(FFMPEG, ['-y', '-ss', String(t), '-i', clipPath, '-frames:v', '1', '-vf', 'scale=384:-1', out]); if (fs.existsSync(out)) frames.push({ t, path: out }); } catch (_) {}
  }
  if (!frames.length) { const r = []; r.offTopic = false; return r; }
  const relLine = topic ? ` NGOÀI RA chấm "rel"=true nếu frame ĐÚNG chủ đề "${String(topic).slice(0, 60)}" (thể hiện đúng vật/cảnh/hành động đó), rel=false nếu LẠC ĐỀ.` : '';
  const content = [{ type: 'text', text: `${frames.length} frame trích từ 1 video (frame 0 ở giây ${frames[0].t}, cách nhau ~${every.toFixed(1)}s). Với MỖI frame theo thứ tự, đánh giá có hợp làm b-roll SẠCH không. "bad"=true nếu frame có: mặt người nói rõ trước camera, HOẶC chữ/phụ đề/UI/logo/watermark/nút bấm. bad=false nếu là cảnh minh họa đẹp (phong cảnh, vật thể, hành động, không chữ).${relLine} Trả JSON mảng ${frames.length} phần tử theo thứ tự: [{"i":0,"bad":true${topic ? ',"rel":true' : ''}}]. CHỈ JSON.` }];
  for (const f of frames) { try { content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + fs.readFileSync(f.path).toString('base64') } }); } catch (_) {} }
  let resp = ''; try { resp = await claudeChat(content); } catch (_) {}
  frames.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
  let arr = []; try { arr = JSON.parse(resp.match(/\[[\s\S]*\]/)[0]); } catch (_) {}
  const ranges = [];
  arr.forEach(x => { if (x && x.bad) { const idx = Number(x.i) || 0; const t = frames[idx] ? frames[idx].t : idx * every; ranges.push({ start: Math.max(0, t - every / 2), end: t + every / 2 }); } });
  // đúng chủ đề? — cần đa số frame "rel"; <35% coi là lạc đề (giữ return là MẢNG, gắn thêm cờ)
  ranges.offTopic = (topic && arr.length) ? (arr.filter(x => x && x.rel).length < Math.max(1, Math.ceil(arr.length * 0.35))) : false;
  return ranges;
}

/* ══ DÒ ĐIỂM CHUYỂN CẢNH ══════════════════════════════════════════════════
   Trước đây điểm cắt chọn theo tỉ lệ vàng — nghĩa là ĐOÁN, chỉ tránh được chỗ
   Vision báo xấu. Cắt trúng giữa một cú lia máy hay giữa lúc đang zoom thì
   clip vào timeline bị giật, người xem thấy ngay.

   ffmpeg có sẵn bộ lọc dò chuyển cảnh, không cần thư viện ngoài (Fractal dùng
   scenedetect của Python — phải cài thêm, Nova thì đã đóng gói ffmpeg rồi).
   Quét một lượt, lấy về danh sách giây có đổi góc máy.                       */
function _mocChuyenCanh(file, mediaDur, nguong = 0.30) {
  return new Promise((res) => {
    // Quét ở khung nhỏ cho nhanh — chỉ cần biết CHỖ đổi cảnh, không cần nét.
    const a = ['-i', file, '-filter:v', `select='gt(scene,${nguong})',showinfo`, '-f', 'null', '-'];
    const cp = spawn(FFMPEG, a, { windowsHide: true });
    let err = '';
    const hetGio = setTimeout(() => { try { cp.kill(); } catch (_) {} }, 45000);
    cp.stderr.on('data', (d) => { err += d; });
    cp.on('close', () => {
      clearTimeout(hetGio);
      const moc = [];
      for (const m of err.matchAll(/pts_time:([0-9.]+)/g)) {
        const t = parseFloat(m[1]);
        if (Number.isFinite(t) && t > 0.4 && (!mediaDur || t < mediaDur - 0.4)) moc.push(+t.toFixed(2));
      }
      res([...new Set(moc)].sort((x, y) => x - y));
    });
    cp.on('error', () => { clearTimeout(hetGio); res([]); });
  });
}

/* Chọn điểm cắt BÁM theo chuyển cảnh: bắt đầu ngay sau một lần đổi góc máy,
   và trọn vẹn trong một cảnh quay — không vắt qua lần đổi kế tiếp.
   Không tìm được mốc nào hợp thì trả null để lùi về cách cũ.                 */
function _catTheoCanh(moc, mediaDur, clipDur, banned) {
  if (!Array.isArray(moc) || moc.length < 2) return null;
  const cam = (t) => (banned || []).some((b) => t < (b.end || 0) && (t + clipDur) > (b.start || 0));
  const hop = [];
  for (let i = 0; i < moc.length; i++) {
    const batDau = moc[i] + 0.15;                  // nhích qua đúng khung chuyển, tránh dính frame nhoè
    const ketCanh = (i + 1 < moc.length) ? moc[i + 1] : mediaDur;
    const daiCanh = ketCanh - moc[i];
    if (daiCanh < clipDur + 0.3) continue;          // cảnh quay ngắn hơn clip cần → bỏ
    if (batDau + clipDur > mediaDur - 0.2) continue;
    if (cam(batDau)) continue;                      // đè lên dải Vision cấm
    hop.push({ t: +batDau.toFixed(2), dai: daiCanh });
  }
  if (!hop.length) return null;
  // Ưu tiên cảnh quay DÀI nhất — dư dải nhất, ít rủi ro dính đuôi chuyển cảnh.
  hop.sort((a, b) => b.dai - a.dai);
  return hop[0].t;
}

// Chọn sourceStart thông minh (né banned)
function smartStart(mediaDur, sceneDur, banned) {
  return pickSmartSourceStart({ mediaDurationSeconds: mediaDur, clipDurationSeconds: sceneDur, blockedRangesSeconds: banned || [], maxBlockedOverlapRatio: 0.1 });
}

module.exports = { visualQuery, scoreCandidates, bannedRanges, smartStart, durOf, _mocChuyenCanh, _catTheoCanh, claudeChat, locRac };
