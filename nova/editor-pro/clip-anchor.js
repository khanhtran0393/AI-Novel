// Gác chất lượng cho bước tìm clip (học từ video-creator của Fractal):
//   1) HỒ SƠ ĐỘ CỤ THỂ — trước khi tìm: gỡ từ trừu tượng khỏi truy vấn + ghim tên riêng của cảnh vào.
//   2) ANCHOR MATCHING — sau khi tìm: bỏ ứng viên có tiêu đề không dính gì tới cảnh.
// Thuần toán, KHÔNG gọi AI, KHÔNG tải gì → chạy được cả ở luồng tự động (vốn tắt vision cho nhanh).
// Nguyên tắc xuyên suốt: chỉ LỌC BỚT, không bao giờ để trắng tay — hết ứng viên thì trả lại danh sách gốc.
'use strict';

// ── Từ dừng: bỏ khi so khớp token (gồm cả tiếng Việt vì lời thoại là tiếng Việt) ──
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on',
  'or', 'the', 'this', 'that', 'these', 'those', 'to', 'with', 'was', 'were', 'are', 'his', 'her', 'its',
  'và', 'của', 'là', 'có', 'các', 'một', 'những', 'này', 'đó', 'cho', 'với', 'trong', 'ra', 'vào', 'khi',
  'thì', 'mà', 'ở', 'đã', 'sẽ', 'được', 'bị', 'như', 'về', 'từ', 'đến', 'sau', 'trước', 'rồi', 'nữa',
  'cũng', 'rất', 'nhưng', 'nên', 'người', 'việc', 'điều',
]);

// ── Danh từ QUAY ĐƯỢC: có mấy từ này thì truy vấn chắc chắn còn tìm ra hình ──
const CONCRETE_WORDS = new Set([
  'airport', 'airplane', 'plane', 'runway', 'harbor', 'harbour', 'port', 'terminal', 'gate', 'crane',
  'truck', 'cargo', 'container', 'ship', 'boat', 'train', 'railway', 'station', 'helicopter', 'car',
  'traffic', 'highway', 'road', 'street', 'bridge', 'tunnel', 'overpass', 'crowd', 'queue', 'market',
  'store', 'mall', 'factory', 'warehouse', 'office', 'desk', 'laptop', 'screen', 'phone', 'device',
  'kitchen', 'table', 'door', 'window', 'stairs', 'room', 'house', 'building', 'temple', 'castle',
  'ruins', 'excavation', 'statue', 'monument', 'courtyard', 'village', 'farm', 'field', 'tractor',
  'forest', 'tree', 'mountain', 'river', 'lake', 'ocean', 'sea', 'beach', 'desert', 'dunes', 'snow',
  'rain', 'storm', 'cloud', 'fire', 'smoke', 'ash', 'dust', 'rubble', 'flood', 'sky', 'sunrise',
  'sunset', 'hospital', 'ward', 'nurse', 'doctor', 'soldier', 'army', 'horse', 'sword', 'armor',
  'battlefield', 'flag', 'ceremony', 'parade', 'motorcade', 'podium', 'conference', 'briefing',
  'newspaper', 'headline', 'archive', 'newsreel', 'camera', 'paparazzi', 'barrier', 'barricade',
  'book', 'map', 'letter', 'coin', 'money', 'gold', 'food', 'cooking', 'walking', 'running', 'riding',
]);

// ── Từ "đại diện thị giác": dùng được trong truy vấn nhưng KHÔNG tự đứng làm tên riêng ──
const PROXY_WORDS = new Set([
  'scene', 'clip', 'footage', 'archival', 'gameplay', 'trailer', 'aerial', 'view', 'exterior',
  'interior', 'closeup', 'close', 'up', 'wide', 'shot', 'timelapse', 'slow', 'motion', 'stock',
  'broll', 'documentary', 'cinematic', 'drone', 'pov', 'background',
]);

// ── Từ TRỪU TƯỢNG / nhiễu: gỡ khỏi truy vấn vì không quay ra hình được ──
const ABSTRACT_WORDS = new Set([
  'outage', 'scandal', 'controversy', 'crisis', 'ultimatum', 'panic', 'collapse', 'debate', 'policy',
  'probe', 'lawsuit', 'rumor', 'rumour', 'rumors', 'rumours', 'leak', 'tension', 'standoff', 'chaos',
  'turmoil', 'backlash', 'drama', 'negotiation', 'sanction', 'tariff', 'shutdown', 'boycott', 'feud',
  'lesson', 'lessons', 'motivation', 'motivational', 'resilience', 'mindset', 'freedom', 'destiny',
  'story', 'stories', 'explained', 'breakdown', 'analysis', 'update', 'commentary', 'reaction',
  'review', 'recap', 'timeline', 'topic', 'issue', 'concept', 'meaning', 'truth', 'legacy', 'impact',
  'importance', 'significance', 'mystery', 'secret', 'secrets', 'reason', 'reasons',
  'disaster', 'tragedy', 'aftermath', 'incident', 'situation', 'consequence', 'consequences',
  'success', 'failure', 'influence', 'era', 'moment', 'moments', 'journey', 'struggle',
]);

// ═══════════════ tiện ích ═══════════════
function normalizeText(v) {
  return String(v || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeToken(v) {
  return String(v || '').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '').replace(/^-+|-+$/g, '').trim();
}
function tokenize(v, { minLength = 2, removeStopwords = true } = {}) {
  return normalizeText(v).split(' ').filter(t => t && t.length >= minLength && !(removeStopwords && STOPWORDS.has(t)));
}
function dedupe(values, cap = 8) {
  const out = [], seen = new Set();
  for (const v of (Array.isArray(values) ? values : [])) {
    const t = String(v || '').trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

// ═══════════════ 1. HỒ SƠ ĐỘ CỤ THỂ ═══════════════

// Chỉ coi là TÊN RIÊNG khi ≤5 từ và có ít nhất 1 token viết hoa/có số (hoặc viết tắt toàn hoa).
// Nhờ vậy "Trần Hưng Đạo", "Titanic", "NASA" được ghim; còn "người dân", "cuộc chiến" thì không.
function isEntityLike(value) {
  const text = String(value || '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  if (words.some(w => /^[\p{Lu}\p{N}][\p{L}\p{N}'’-]*$/u.test(w))) return true;
  if (words.length === 1 && /^[\p{Lu}\p{N}-]{3,}$/u.test(words[0])) return true;
  return false;
}

// Gỡ từ trừu tượng khỏi truy vấn. Gỡ sạch mà rỗng thì trả lại nguyên bản (thà tìm rộng còn hơn không tìm).
function cleanQuery(query) {
  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { query: '', stripped: [] };
  const stripped = [], kept = [];
  for (const w of words) {
    if (ABSTRACT_WORDS.has(normalizeToken(w))) stripped.push(w); else kept.push(w);
  }
  const out = kept.join(' ').trim();
  if (!out) return { query: words.join(' '), stripped: [] };
  return { query: out, stripped };
}

// Truy vấn còn tín hiệu nhìn thấy được không (chỉ để ghi log/cảnh báo, không dùng để chặn).
function hasVisualSignal(query) {
  const toks = tokenize(query, { removeStopwords: true });
  return toks.some(t => CONCRETE_WORDS.has(t) || PROXY_WORDS.has(t));
}

// Xét hồ sơ CHO TỪNG CẢNH: chỉ giữ tên riêng thật sự xuất hiện trong lời thoại/prompt của cảnh đó.
//   2 tên cùng có mặt → entity_pair · 1 tên → primary_entity · không tên nào → broad (tìm rộng như cũ)
// Đây là chỗ then chốt: cảnh nói về tảng băng thì không bị ép thêm chữ "Southampton".
function resolveProfile({ entities = [], sceneText = '', hint = '' } = {}) {
  const pool = dedupe(entities, 12).filter(isEntityLike);
  if (!pool.length) return { mode: 'broad', active: [], pool: [] };
  const hay = normalizeText([sceneText, hint].filter(Boolean).join(' '));
  const hit = pool.filter(e => hay.includes(normalizeText(e)));
  if (hit.length >= 2) return { mode: 'entity_pair', active: hit.slice(0, 2), pool };
  if (hit.length === 1) return { mode: 'primary_entity', active: hit.slice(0, 1), pool };
  return { mode: 'broad', active: [], pool };
}

// Ghim tên riêng vào ĐẦU truy vấn, biết tránh lặp:
//   "Titanic Southampton" + "Southampton dock 1912" → "Titanic Southampton dock 1912"
//   (không phải "Titanic Southampton Southampton dock 1912")
function prependPinned(query, phrase) {
  const text = String(query || '').trim().replace(/\s+/g, ' ');
  const entity = String(phrase || '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return entity;
  if (!entity) return text;
  if (text.toLowerCase().includes(entity.toLowerCase())) return text;   // đã có sẵn → không ghim đè
  const ew = entity.split(/\s+/).filter(Boolean), qw = text.split(/\s+/).filter(Boolean);
  let overlap = 0;
  for (let size = Math.min(ew.length, qw.length); size >= 1; size--) {
    if (ew.slice(ew.length - size).join(' ').toLowerCase() === qw.slice(0, size).join(' ').toLowerCase()) { overlap = size; break; }
  }
  if (overlap > 0) return ew.concat(qw.slice(overlap)).join(' ').replace(/\s+/g, ' ').trim();
  return `${entity} ${text}`.replace(/\s+/g, ' ').trim();
}

function applyProfile(query, profile) {
  const p = profile || {};
  const act = Array.isArray(p.active) ? p.active : [];
  if (p.mode === 'broad' || !act.length) return String(query || '').trim();
  let out = String(query || '').trim();
  if (act.length >= 2) { out = prependPinned(out, act[1]); out = prependPinned(out, act[0]); }
  else out = prependPinned(out, act[0]);
  return out;
}

// ═══════════════ 2. ANCHOR MATCHING ═══════════════

// Khớp neo: trùng nguyên cụm → nhận ngay; còn lại đếm token chồng lấn.
// Neo dài (≥4 token) đòi 2 token trùng, neo ngắn chỉ cần 1 — neo ngắn vốn đã cụ thể.
function computeAnchorMatch(haystackText, anchorText) {
  const hay = normalizeText(haystackText), anchor = normalizeText(anchorText);
  if (!hay || !anchor) return { matched: false, reason: 'empty_text', overlap: 0, required: 0 };
  if (hay.includes(anchor)) return { matched: true, reason: 'exact_phrase', overlap: anchor.split(' ').length, required: 1 };
  const at = tokenize(anchor, { minLength: 2, removeStopwords: true });
  if (!at.length) return { matched: false, reason: 'anchor_empty', overlap: 0, required: 0 };
  const ht = new Set(tokenize(hay, { minLength: 2, removeStopwords: false }));
  let overlap = 0;
  for (const t of at) if (ht.has(t)) overlap++;
  const required = at.length >= 4 ? 2 : 1;
  return { matched: overlap >= required, reason: overlap >= required ? 'token_overlap' : 'no_overlap', overlap, required };
}

// Dựng danh sách neo cho 1 cảnh: tên riêng đang ghim + cụm hình.
// Là phép HOẶC — clip Pexels chung chung vẫn qua được nhờ neo "cụm hình", không bị tên riêng loại oan.
function buildAnchors({ keyword = '', entities = [], hint = '' } = {}) {
  const out = [];
  (Array.isArray(entities) ? entities : []).forEach(e => { if (e) out.push(String(e)); });
  if (keyword) out.push(String(keyword));
  if (hint) {
    const t = tokenize(hint, { removeStopwords: true }).filter(x => CONCRETE_WORDS.has(x));
    if (t.length) out.push(t.slice(0, 3).join(' '));
  }
  return dedupe(out, 5);
}

function analyzeCandidate(candidate, anchors) {
  const c = candidate || {};
  const title = String(c.title || c.name || '').trim();
  const haystack = [title, String(c.source || ''), String(c.channel || c.channelName || '')].filter(Boolean).join(' ').trim();
  if (!haystack) return { matched: false, reason: 'empty_candidate', anchor: '', title };
  const list = (Array.isArray(anchors) ? anchors : []).map(a => String(a || '').trim()).filter(Boolean);
  if (!list.length) return { matched: true, reason: 'no_anchors', anchor: '', title };
  for (const a of list) {
    const r = computeAnchorMatch(haystack, a);
    if (r.matched) return { matched: true, reason: r.reason, anchor: a, overlap: r.overlap, title };
  }
  return { matched: false, reason: 'no_overlap', anchor: '', title };
}

// Lọc ứng viên. Nếu lọc xong TRẮNG TAY thì trả lại nguyên danh sách + cờ starved
// → thà nhận clip chưa chắc khớp còn hơn cảnh trống.
function filterByAnchors(candidates, anchors, { sampleLimit = 5 } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const anchorList = (Array.isArray(anchors) ? anchors : []).map(a => String(a || '').trim()).filter(Boolean);
  if (!list.length || !anchorList.length) return { kept: list, dropped: 0, starved: false, samples: [] };
  const kept = [], samples = [];
  for (const c of list) {
    const r = analyzeCandidate(c, anchorList);
    if (r.matched) kept.push(c);
    else if (samples.length < sampleLimit) samples.push({ title: r.title.slice(0, 70), reason: r.reason });
  }
  if (!kept.length) return { kept: list, dropped: 0, starved: true, samples };
  return { kept, dropped: list.length - kept.length, starved: false, samples };
}

module.exports = {
  // hồ sơ độ cụ thể
  isEntityLike, cleanQuery, hasVisualSignal, resolveProfile, prependPinned, applyProfile,
  // anchor matching
  computeAnchorMatch, buildAnchors, analyzeCandidate, filterByAnchors,
  // dùng lại ở nơi khác
  normalizeText, tokenize, CONCRETE_WORDS, ABSTRACT_WORDS,
};
