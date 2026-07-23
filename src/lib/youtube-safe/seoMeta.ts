import {
  psychLawOrder,
  scoreTitleAgainstPsychLaws,
  detectPsychLawInTitle,
  type ThumbBias,
} from '../youtubePsych55';
import { clipAtWordBoundary } from './text';
import {
  YOUTUBE_MOBILE_TITLE_MAX,
  YOUTUBE_TITLE_HARD_MAX,
  buildFiveTitleFormulas,
  compositionPromptBlock,
  enforceMobileTitle,
  frontLoadHookKeywords,
  scoreTitleMobileDiscipline,
  type ThumbCompositionId,
} from './highCtr';
import {
  buildStyleCtrTitleCandidates,
  getStyleEngineProfile,
  resolveStyleEngineFromSetupPayload,
  resolveStyleEngineProfile,
  styleEngineTitleScoreBoost,
  type StyleEngineProfile,
} from '../styleEngineProfiles';
import { composeMatrix, matrixScoreMotifs, normKey as matrixNormKey } from '../matrixEngine';

export type StyleEngineSeoOpts = {
  chu_de?: string;
  phong_cach?: string;
  genre?: string;
  styleEngineId?: string | null;
};

function resolveSeoStyleProfile(
  opts?: StyleEngineSeoOpts | null,
): StyleEngineProfile | null {
  if (!opts) return null;
  if (opts.styleEngineId) {
    const byId = getStyleEngineProfile(opts.styleEngineId);
    if (byId) return byId;
  }
  if (opts.chu_de || opts.phong_cach) {
    return resolveStyleEngineProfile(opts.chu_de, opts.phong_cach);
  }
  if (opts.genre) {
    return resolveStyleEngineFromSetupPayload({ genre: opts.genre });
  }
  return null;
}

/**
 * Heuristic nhẹ: chấm narrative psych cục bộ (0–100) để log / tín hiệu phụ.
 * Không thay Editor AI.
 */
export function scoreNarrativePsychScript(script: string): {
  score: number;
  flags: string[];
  openScore: number;
  endScore: number;
  threatDensity: number;
} {
  const text = (script || '').normalize('NFC').trim();
  const flags: string[] = [];
  if (!text) {
    return { score: 0, flags: ['empty'], openScore: 0, endScore: 0, threatDensity: 0 };
  }

  const sentences = text
    .replace(/\[CẢNH[^\]]*\]/gi, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);

  const head = sentences.slice(0, 3).join(' ');
  const tail = sentences.slice(-3).join(' ');
  const openScore = scorePsychologicalPull(head);
  const endScore = scorePsychologicalPull(tail);

  let threatHits = 0;
  for (const s of sentences) {
    if (scorePsychologicalPull(s) >= 4) threatHits++;
  }
  const threatDensity = sentences.length
    ? Math.round((threatHits / sentences.length) * 100)
    : 0;

  if (openScore < 2) flags.push('weak_open_pattern_interrupt');
  if (endScore < 2 && !/[?…]$/.test(tail.trim())) flags.push('weak_open_loop_ending');
  if (/^(gió|mặt trời|hoàng hôn|bình minh|sương|trăng)/i.test(head.trim())) {
    flags.push('poetic_open');
  }
  if (/đừng bỏ lỡ|like\s*\·?\s*subscribe|sai một bước là mất tất cả/i.test(text)) {
    flags.push('seo_slogan_in_prose');
  }

  let score = 55;
  score += Math.min(20, openScore * 3);
  score += Math.min(15, endScore * 2);
  score += Math.min(15, Math.floor(threatDensity / 5));
  if (flags.includes('poetic_open')) score -= 15;
  if (flags.includes('weak_open_pattern_interrupt')) score -= 10;
  if (flags.includes('weak_open_loop_ending')) score -= 8;
  if (flags.includes('seo_slogan_in_prose')) {
    score -= 35; // SEO slogan trong prose = lỗi nặng
    score = Math.min(score, 55);
  }
  score = Math.max(0, Math.min(100, score));

  return { score, flags, openScore, endScore, threatDensity };
}

/**
 * ── Công thức tâm lý học YouTube (địa phương hóa VI) ──────────────────────
 * 1. Curiosity Gap (Loewenstein) — khoảng trống thông tin “biết một phần”
 * 2. Zeigarnik / Open Loop — việc dở dang khó quên → giữ watch time
 * 3. Loss Aversion (Kahneman) — sợ mất > mong được
 * 4. FOMO — sợ bỏ lỡ / bị loại khỏi vòng “người hiểu chuyện”
 * 5. Pattern Interrupt — mở bằng xung đột, không thơ tả cảnh
 * 6. Specificity — số / chi tiết cụ thể tăng tin cậy
 * 7. PAS (Problem → Agitate → Solution/CTA) — khung Description
 * 8. Emotional high-arousal — đe dọa, bí mật, phản bội, sống còn
 */

/** Lexicon kích hoạt cảm xúc / đe dọa (drama · suspense — genre-agnostic) */
const PSYCH_THREAT_RE =
  /chết|giết|máu|đau|sợ|hối|mất|cướp|phản bội|bí mật|giấu|trốn|chạy|đuổi|còn lại|cuối cùng|không còn|tuyệt|tuyệt vọng|cô đơn|đói|lạnh|bóng tối|xác|quái|virus|sống sót|cách ly|cấm|nguy hiểm|đe dọa|thù|hận|dối|lừa|bẫy|sụp|sụp đổ|tan|nát|vỡ|khóc|la|thét|câm|im lặng|không ai|mọi người|hắn|nàng|ta phải|đừng|không được|phải chết|chỉ còn/i;

const PSYCH_CURIOSITY_RE =
  /tại sao|vì sao|làm sao|liệu|có phải|không ngờ|thật ra|sự thật|bí mật|chưa ai|không ai biết|bỗng|bất ngờ|hóa ra|thì ra|nhưng|mà|nếu|khi ấy|lúc đó|trước khi|sau khi/i;

const PSYCH_QUESTION_RE = /\?|？/;
const PSYCH_NUMBER_RE = /\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|trăm|nghìn|vạn/i;
const PSYCH_DIALOGUE_RE = /["“”'']/;
const PSYCH_POETIC_FLAT_RE =
  /mặt trời|hoàng hôn|bình minh|gió nhẹ|mây trôi|lá rơi|trăng|sương mù|cảnh vật|phong cảnh|thiên nhiên|bầu trời xanh/i;

/** Gỡ thoại / dấu ngoặc — Title SEO không viết kiểu hội thoại */
function stripDialogueStyle(text: string): string {
  return (text || '')
    .normalize('NFC')
    .replace(/["“”''«»]/g, '')
    .replace(/^(?:hắn|nàng|cô ấy|anh ấy|tôi|ta|mày|cậu)\s+(?:nói|thì thầm|gào|hét|đáp|hỏi)[:：]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Template Title CTR — 55 quy luật tâm lý (youtubePsych55).
 * IRON B10: không nhồi title clickbait giả khi pack rỗng — caller hard-fail.
 */
function applySeoTitleFormula(
  kind: 'curiosity' | 'loss' | 'open' | 'fomo' | 'question' | 'stake',
  core: string,
  stake: string,
): string {
  const c = stripDialogueStyle(core).replace(/[.!…?]+$/g, '').trim();
  const s = stripDialogueStyle(stake).replace(/[.!…?]+$/g, '').trim();
  const stakeOk = s && s.length >= 6 && !c.toLowerCase().includes(s.toLowerCase().slice(0, 10));
  const shortC = clipAtWordBoundary(c, 48);
  const shortS = stakeOk ? clipAtWordBoundary(s, 32) : '';

  switch (kind) {
    case 'question':
      return shortC.endsWith('?')
        ? shortC
        : `Tại sao ${shortC.charAt(0).toLowerCase()}${shortC.slice(1)}? Câu trả lời đáng sợ hơn bạn nghĩ`;
    case 'loss': {
      const loss = shortS && /mất|chết|giết|hỏng|sụp|tan|không còn|hủy|sai/i.test(shortS)
        ? shortS.charAt(0).toLowerCase() + shortS.slice(1)
        : 'mất tất cả';
      return `${shortC} — sai một bước là ${loss}`;
    }
    case 'fomo':
      return `Đừng bỏ lỡ: ${shortC}${shortS ? `… ${shortS}` : ''}`;
    case 'open':
      return `${shortC}… và điều xảy ra sau đó không ai ngờ tới`;
    case 'stake':
      return shortS ? `${shortC} | ${shortS}` : `${shortC} — chi tiết khiến người xem rùng mình`;
    case 'curiosity':
    default:
      if (shortS) return `${shortC} — nhưng ${shortS.charAt(0).toLowerCase()}${shortS.slice(1)}`;
      return `Sự thật về ${shortC.charAt(0).toLowerCase()}${shortC.slice(1)}… không ai dám nói to`;
  }
}

function hashSeed(s: string): number {
  let h = 0;
  const t = (s || '').normalize('NFC');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function dedupeWords(t: string): string {
  return t
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\b[\p{L}\d]{3,}\b)(?:\s+\1\b)+/giu, '$1');
}

/** Fix grammar crashes from template + raw hook fragments (minimal, non-destructive) */
export function sanitizeSeoTitle(title: string): string {
  let t = (title || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  // Double question: "Tại sao ... vì sao ..."
  if (/tại\s+sao/i.test(t) && /vì\s+sao/i.test(t)) {
    t = t.replace(/\bvì\s+sao\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }
  // Broken self-ref template dumping full clauses
  t = t.replace(
    /^Bạn sẽ làm gì nếu\s+(.+)$/i,
    (_, body: string) => {
      const short = clipAtWordBoundary(String(body).replace(/\?.*$/, ''), 36);
      return short
        ? `Bạn có dám đối mặt ${short.charAt(0).toLowerCase()}${short.slice(1)} không?`
        : 'Bạn có dám xem đến cuối không?';
    },
  );
  // Collapse accidental mid-word upper chaos from older bad sanitizers (HỘi → Hội style rare)
  // Keep as-is otherwise — do NOT Title-Case mid-sentence Vietnamese.
  t = dedupeWords(t);
  // Sentence-case first character only
  if (t.length) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (t.length > 100) t = clipAtWordBoundary(t, 100);
  return t;
}

export function sanitizeThumbnailLine(line: string): string {
  let t = (line || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 30);
  // Reject pure stock with no content
  if (/^(đừng|cảnh báo|thì thầm|bạn dám)…?$/i.test(t) && t.length < 12) {
    return t;
  }
  // Capitalize first letter
  if (t && /^\p{Ll}/u.test(t)) {
    t = t.charAt(0).toLocaleUpperCase('vi-VN') + t.slice(1);
  }
  return t.slice(0, 30);
}

function motifOverlapPenalty(candidate: string, used: string[] | undefined): number {
  if (!used?.length) return 0;
  const c = candidate.toLowerCase().slice(0, 48);
  let pen = 0;
  for (const u of used) {
    const x = (u || '').toLowerCase().slice(0, 40);
    if (!x || x.length < 6) continue;
    if (c.includes(x.slice(0, 12)) || x.includes(c.slice(0, 12))) pen += 2.5;
  }
  return pen;
}

/** Sinh nhiều biến thể title từ 55 luật + chấm điểm */
function generateSeoTitleCandidates(
  hook: string,
  novelTitle?: string,
  opts?: {
    seed?: number;
    usedTitles?: string[];
    maxCandidates?: number;
  } & StyleEngineSeoOpts,
): string[] {
  const sentences = splitSentencesVi(stripDialogueStyle(hook || ''));
  const ranked = [...sentences]
    .map((s) => {
      let n = scorePsychologicalPull(s);
      // Prefer concrete sensory/threat beats over meta open-loop filler
      if (/tường|nứt|chạy|dao|chôn|khép|máu|sắt|rêu|hầm|chân thứ/i.test(s)) n += 3;
      if (/không ai kịp hiểu|chuyện gì đang xảy ra|không ai ngờ/i.test(s)) n -= 4;
      return { s, n };
    })
    .sort((a, b) => b.n - a.n);
  const core = clipAtWordBoundary(
    stripDialogueStyle(ranked[0]?.s || hook || ''),
    48,
  );
  const stake = extractStakeFragment(ranked[1]?.s || ranked[0]?.s || hook || '', 34);
  const seed = opts?.seed ?? hashSeed(hook + (novelTitle || ''));
  const laws = psychLawOrder(seed);
  const maxC = opts?.maxCandidates ?? 55;
  const out: string[] = [];
  const series = clipAtWordBoundary((novelTitle || '').trim(), 18);

  for (const law of laws) {
    if (out.length >= maxC) break;
    let t = law.title(core, stake || '');
    t = dedupeWords(t);
    if (
      series &&
      t.length + series.length + 3 <= 100 &&
      !t.toLowerCase().includes(series.toLowerCase().slice(0, 6))
    ) {
      // Attach series only on odd law ids for variety
      if (law.id % 3 === 0) t = `${t} | ${series}`;
    }
    if (t.length > 100) t = clipAtWordBoundary(t, 100);
    if (t.length >= 24) out.push(t);
  }

  // Legacy 6 as safety net
  if (out.length < 8) {
    const kinds: Array<'curiosity' | 'loss' | 'open' | 'fomo' | 'question' | 'stake'> = [
      'curiosity',
      'loss',
      'fomo',
      'open',
      'question',
      'stake',
    ];
    for (const k of kinds) {
      let t = dedupeWords(applySeoTitleFormula(k, core, stake));
      if (t.length > 100) t = clipAtWordBoundary(t, 100);
      if (t.length >= 24) out.push(t);
    }
  }

  // High-CTR: always inject 5 psychological title formulas (mobile-clipped)
  for (const v of buildFiveTitleFormulas({
    hook: hook || core,
    novelTitle,
    seed,
    mobileClip: true,
  })) {
    if (v.title.length >= 16) out.unshift(v.title);
  }

  // Style Engine niche CTR templates (Tu Tiên / Vả mặt / …)
  const styleProf = resolveSeoStyleProfile(opts);
  for (const t of buildStyleCtrTitleCandidates(styleProf, core)) {
    const cleaned = t.length > 100 ? clipAtWordBoundary(t, 100) : t;
    if (cleaned.length >= 16) out.unshift(cleaned);
  }

  // Matrix motifs when StyleEngine null — light candidate from topic×style material
  if (!styleProf && (opts?.chu_de || opts?.phong_cach || opts?.genre)) {
    const mx = composeMatrix({
      chu_de: opts.chu_de,
      phong_cach: opts.phong_cach,
      genre: opts.genre,
    });
    const motifs = matrixScoreMotifs(mx);
    if (motifs[0] && core.length >= 8) {
      const cand = clipAtWordBoundary(
        `${core.slice(0, 36)} — ${motifs[0]}`.normalize('NFC'),
        100,
      );
      if (cand.length >= 16) out.unshift(cand);
    }
  }

  return Array.from(new Set(out));
}

/** Score boost from matrix motifs (when StyleEngine miss or as additive). */
export function matrixTitleScoreBoost(
  title: string,
  opts?: StyleEngineSeoOpts | null,
): number {
  if (!opts?.chu_de && !opts?.phong_cach && !opts?.genre) return 0;
  const motifs = matrixScoreMotifs({
    chu_de: opts?.chu_de,
    phong_cach: opts?.phong_cach,
    genre: opts?.genre,
  });
  const t = matrixNormKey(title || '');
  if (!t) return 0;
  let hits = 0;
  for (const m of motifs) {
    if (t.includes(matrixNormKey(m))) hits += 1;
  }
  if (hits <= 0) return 0;
  return Math.min(1.8, 0.35 * hits + 0.2);
}

/** Pick best title: psych score + 55-law boost − motif penalty + seed diversity among top-K */
export function pickBestSeoTitle(
  hook: string,
  novelTitle?: string,
  opts?: { seed?: number; usedTitles?: string[] } & StyleEngineSeoOpts,
): { title: string; lawId?: number; lawName?: string } {
  const cands = generateSeoTitleCandidates(hook, novelTitle, opts);
  if (!cands.length) {
    throw new Error(
      'SEO title: khong sinh duoc candidate tu hook. Sua hook/kich ban roi gen lai.',
    );
  }
  const styleProf = resolveSeoStyleProfile(opts);
  const scored = cands.map((c) => {
    const cleaned = sanitizeSeoTitle(c);
    let sc = scoreSeoTitle(cleaned) + scoreTitleAgainstPsychLaws(cleaned);
    sc += styleEngineTitleScoreBoost(cleaned, styleProf);
    sc += matrixTitleScoreBoost(cleaned, opts);
    sc -= motifOverlapPenalty(cleaned, opts?.usedTitles);
    // Penalize awkward long "Vì sao [full narrative clause]"
    if (/^(vì|tại)\s+sao\s+/i.test(cleaned) && cleaned.length > 72) sc -= 1.2;
    if (/níu|cổ tay|thì thầm|mỉm cười/i.test(cleaned) && cleaned.length > 60) sc -= 0.8;
    // Prefer tension cores over soft gesture / trivial body beats
    if (/nứt|chết|chạy|bẫy|sụp|mất|bí mật|tường|khép|chôn|dao|chân thứ/i.test(cleaned)) sc += 0.8;
    if (/níu cổ tay|mỉm cười|nuốt nước bọt/i.test(cleaned)) sc -= 1.0;
    // Mobile CTR discipline: prefer ≤70 (YouTube app truncate)
    const mobile = scoreTitleMobileDiscipline(cleaned);
    sc += mobile.score * 0.12;
    if (cleaned.length >= 40 && cleaned.length <= YOUTUBE_MOBILE_TITLE_MAX) sc += 0.9;
    else if (cleaned.length > YOUTUBE_MOBILE_TITLE_MAX && cleaned.length <= 85) sc -= 0.2;
    if (cleaned.length > 95) sc -= 0.6;
    if (/^(chê|đừng mở|giả làm|xuyên không|mỗi lần)/i.test(cleaned)) sc += 0.5;
    const seed = opts?.seed ?? 0;
    sc += ((hashSeed(cleaned) + seed) % 7) * 0.12;
    return { c: cleaned, sc, law: detectPsychLawInTitle(cleaned) };
  });
  scored.sort((a, b) => b.sc - a.sc);
  // Among top 12 high-quality, rotate by seed for diversity
  const topK = scored.slice(0, Math.min(12, scored.length));
  const minKeep = topK[0].sc - 1.8;
  const pool = topK.filter((x) => x.sc >= minKeep);
  // Drop grammatically broken candidates
  const cleanPool = pool
    .map((p) => ({ ...p, c: sanitizeSeoTitle(p.c) }))
    .filter((p) => {
      if (!p.c || p.c.length < 20) return false;
      if (/tại\s+sao[\s\S]{0,50}vì\s+sao/i.test(p.c)) return false;
      if (/bạn sẽ làm gì nếu\s+\p{L}{3,}\s+\p{L}{3,}\s+\p{L}{3,}/iu.test(p.c) && p.c.length > 70)
        return false;
      // Reject dialogue dump / FOMO+thoại
      if (/["“”]/.test(p.c)) return false;
      if (/đừng bỏ lỡ:\s*(cô|anh|hắn|nàng)\b/i.test(p.c)) return false;
      if (/\bnơi\s+\p{L}+\s+vừa\s+vẽ/iu.test(p.c)) return false;
      if (/^(hắn|nàng|tôi|ta)\s+(nói|thì thầm|hỏi|đáp)/i.test(p.c)) return false;
      return true;
    });
  const finalPool = cleanPool.length ? cleanPool : pool.map((p) => ({ ...p, c: sanitizeSeoTitle(p.c) }));
  const pick = finalPool[(opts?.seed ?? 0) % finalPool.length] || scored[0];
  return {
    title: sanitizeSeoTitle(pick.c).slice(0, 100),
    lawId: pick.law?.id,
    lawName: pick.law?.nameVi,
  };
}

export function scorePsychologicalPull(text: string): number {
  const s = (text || '').normalize('NFC').trim();
  if (!s || s.length < 4) return 0;
  let n = 0;
  if (PSYCH_THREAT_RE.test(s)) n += 4;
  if (PSYCH_CURIOSITY_RE.test(s)) n += 3;
  if (PSYCH_QUESTION_RE.test(s)) n += 3;
  if (PSYCH_DIALOGUE_RE.test(s)) n += 2;
  if (PSYCH_NUMBER_RE.test(s)) n += 2;
  if (/[!…]/.test(s)) n += 1;
  // High-arousal verbs
  if (/chạy|đập|siết|kéo|vồ|bắn|chém|cắn|hét|rít|run|run rẩy/i.test(s)) n += 2;
  // Penalize flat landscape openers (anti pattern-interrupt)
  if (PSYCH_POETIC_FLAT_RE.test(s) && !PSYCH_THREAT_RE.test(s)) n -= 3;
  // Prefer mobile-thumb length for overlay candidates
  if (s.length <= 40) n += 1;
  if (s.length <= 28) n += 1;
  if (s.length > 120) n -= 1;
  return n;
}

/** Cắt stake ngắn (mất mát / đe dọa) từ câu để nhét title */
function extractStakeFragment(text: string, maxChars = 28): string {
  const s = (text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Ưu tiên mệnh đề sau "nhưng|mà|nếu|vì"
  const m = s.match(/(?:nhưng|mà|nếu|vì|bởi|khi|lúc)\s+([^,.!?…]{6,48})/i);
  const frag = (m?.[1] || s).trim();
  return clipAtWordBoundary(frag.replace(/^["'“”]+|["'“”]+$/g, ''), maxChars);
}

function splitSentencesVi(text: string): string[] {
  return (text || '')
    .normalize('NFC')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
}

/**
 * Cold-open hook ~30s — Pattern Interrupt + escalate + Open Loop (Zeigarnik).
 * ~140 wpm → ~70 words ≈ 30s.
 */
export function extractHookFromScript(
  script: string,
  opts?: {
    targetSec?: number;
    wpm?: number;
    /** Visual DNA / media style — required for non-empty thumbnailPrompt (B10: no invent) */
    visualDna?: string;
    characterHint?: string;
  } & StyleEngineSeoOpts,
): {
  hook: string;
  thumbnailLine: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
} {
  const targetSec = opts?.targetSec ?? 30;
  const wpm = opts?.wpm ?? 140;
  const targetWords = Math.max(55, Math.round((wpm * targetSec) / 60));
  const styleOpts: StyleEngineSeoOpts = {
    chu_de: opts?.chu_de,
    phong_cach: opts?.phong_cach,
    genre: opts?.genre,
    styleEngineId: opts?.styleEngineId,
  };

  const cleaned = (script || '')
    .normalize('NFC')
    .replace(/\[CẢNH[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return {
      hook: '',
      thumbnailLine: '',
      seoTitle: '',
      seoDescription: '',
      seoTags: '',
      thumbnailPrompt: '',
    };
  }

  const sentences = splitSentencesVi(cleaned);

  // Pattern Interrupt: bắt đầu từ câu xung đột đầu tiên (nửa đầu kịch bản),
  // tránh mở bằng thơ tả cảnh (score thấp).
  const searchLimit = Math.max(1, Math.ceil(sentences.length * 0.45));
  let startIdx = 0;
  let bestOpenScore = -99;
  for (let i = 0; i < searchLimit; i++) {
    const sc = scorePsychologicalPull(sentences[i]);
    if (sc > bestOpenScore) {
      bestOpenScore = sc;
      startIdx = i;
    }
    // Early exit nếu đã có xung đột mạnh ngay từ đầu
    if (i <= 2 && sc >= 5) {
      startIdx = i;
      break;
    }
  }
  // Nếu cả nửa đầu đều flat, mở từ câu 0 để giữ đúng dữ liệu gốc.
  if (bestOpenScore < 2) startIdx = 0;

  const picked: string[] = [];
  let words = 0;
  for (let i = startIdx; i < sentences.length; i++) {
    picked.push(sentences[i]);
    words += sentences[i].split(/\s+/).filter(Boolean).length;
    if (words >= targetWords) break;
  }

  let hook = picked.join(' ').trim();
  if (words < targetWords * 0.55) {
    const allWords = cleaned.split(/\s+/).filter(Boolean);
    hook = allWords.slice(0, targetWords).join(' ');
    if (allWords.length > targetWords) hook += '…';
  }

  // Zeigarnik / Open Loop: kết thúc dở dang — không “chốt” câu chuyện
  hook = applyOpenLoopEnding(hook, sentences, startIdx + picked.length);

  const thumbnailLine = buildClickThumbnailLine(hook, sentences);
  const seoTitle = buildSeoTitleFromHook(hook, thumbnailLine, undefined, styleOpts);
  const seoTags = buildSeoTags(hook);
  const seoDescription = buildSeoDescription({
    hook,
    thumbnailLine,
    tags: seoTags,
  });
  // B10: no invent Visual DNA — empty prompt if missing (caller supplies style)
  let thumbnailPrompt = '';
  const visualDna = (opts?.visualDna || '').trim();
  if (visualDna) {
    thumbnailPrompt = buildThumbnailPrompt({
      hook,
      thumbnailLine,
      visualDna,
      characterHint: opts?.characterHint,
      styleEngine: styleOpts,
    });
  }

  return { hook, thumbnailLine, seoTitle, seoDescription, seoTags, thumbnailPrompt };
}

/** Ép kết thúc open-loop: bỏ chốt êm, thêm khoảng trống thông tin */
function applyOpenLoopEnding(hook: string, allSentences: string[], nextIdx: number): string {
  let h = (hook || '').trim();
  if (!h) return h;

  // Bỏ kết êm “ổn thỏa”
  h = h.replace(/\s*(cuối cùng.*|mọi thứ yên bình.*|hắn mỉm cười.*)$/i, '').trim();

  // Nếu câu sau còn conflict → nhét mảnh cliff (curiosity gap)
  if (nextIdx < allSentences.length) {
    const next = allSentences[nextIdx];
    if (scorePsychologicalPull(next) >= 3) {
      const cliff = clipAtWordBoundary(next, 42);
      if (cliff && !h.includes(cliff.slice(0, 12))) {
        // Chỉ gợi, không kể hết
        const hint = clipAtWordBoundary(cliff, 28);
        if (!/[?…]$/.test(h)) h = `${h.replace(/[.!]+$/, '')}…`;
        h = `${h} ${hint}…`.replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Luôn để ngỏ nếu đang chốt bằng dấu chấm
  if (/[.!]$/.test(h) && !/[?…]$/.test(h)) {
    h = `${h.replace(/[.!]+$/, '')}…`;
  }
  // Câu mở loop nhẹ nếu thiếu tension cuối
  if (scorePsychologicalPull(h.slice(-80)) < 2 && !/[?…]$/.test(h)) {
    h = `${h}… và không ai kịp hiểu chuyện gì đang xảy ra.`;
  }
  return h.replace(/\s+/g, ' ').trim();
}

/** Ngưỡng pass Meta — dưới này phải viết lại */
export const YOUTUBE_META_PASS_SCORE = 8.5;

/**
 * SEO Title — template CTR tâm lý, KHÔNG thoại.
 * Prefer mobile ≤70; hard cap 100. Includes 5 formula candidates in pool.
 */
export function buildSeoTitleFromHook(
  hook: string,
  _thumbnailLine?: string,
  novelTitle?: string,
  opts?: {
    seed?: number;
    usedTitles?: string[];
    preferMobile?: boolean;
  } & StyleEngineSeoOpts,
): string {
  const preferMobile = opts?.preferMobile !== false;
  const picked = pickBestSeoTitle(hook, novelTitle, {
    seed: opts?.seed ?? hashSeed(hook + (novelTitle || '') + (_thumbnailLine || '')),
    usedTitles: opts?.usedTitles,
    chu_de: opts?.chu_de,
    phong_cach: opts?.phong_cach,
    genre: opts?.genre,
    styleEngineId: opts?.styleEngineId,
  });
  let title =
    picked.title ||
    clipAtWordBoundary(stripDialogueStyle(hook || ''), YOUTUBE_MOBILE_TITLE_MAX) ||
    'Sự thật không ai dám kể… xem đến cuối';
  title = frontLoadHookKeywords(sanitizeSeoTitle(title));
  if (preferMobile && title.length > YOUTUBE_MOBILE_TITLE_MAX) {
    const clipped = enforceMobileTitle(title, YOUTUBE_MOBILE_TITLE_MAX);
    // Keep clip if still substantial
    if (clipped.length >= 28) title = clipped;
  }
  return title.slice(0, YOUTUBE_TITLE_HARD_MAX);
}

/**
 * Thumbnail line ≤30 — 55 luật tò mò (cùng hệ title) + chấm psych pull.
 */
export function buildClickThumbnailLine(
  hook: string,
  sentences?: string[],
  opts?: { seed?: number; usedLines?: string[]; preferredBias?: ThumbBias },
): string {
  const MAX = 30;
  const sentencePool = [
    ...(sentences || []),
    ...splitSentencesVi(stripDialogueStyle(hook || '')),
  ].filter((s) => s.length >= 4);

  const ranked = [...sentencePool]
    .map((s) => {
      let n = scorePsychologicalPull(s);
      if (PSYCH_NUMBER_RE.test(s)) n += 2;
      if (PSYCH_THREAT_RE.test(s)) n += 2;
      if (PSYCH_DIALOGUE_RE.test(s)) n -= 3;
      if (s.length <= 30) n += 2;
      if (s.length > 50) n -= 2;
      return { s: stripDialogueStyle(s), n };
    })
    .sort((a, b) => b.n - a.n);

  const core = clipAtWordBoundary(ranked[0]?.s || stripDialogueStyle(hook || ''), 28);
  const stake = clipAtWordBoundary(ranked[1]?.s || ranked[0]?.s || '', 18);
  const seed = opts?.seed ?? hashSeed(hook + core);
  const laws = psychLawOrder(seed);

  type Cand = { line: string; score: number; lawId: number };
  const cands: Cand[] = [];

  for (const law of laws) {
    if (opts?.preferredBias && law.thumbBias !== opts.preferredBias && law.id % 4 !== seed % 4) {
      // still allow some off-bias for diversity
    }
    let line = law.thumb(core, stake || '');
    line = stripDialogueStyle(line).replace(/\s+/g, ' ').trim();
    // If law thumb is too generic (only ellipsis phrase), fuse with core fragment
    if (line.length < 8 || /…$/.test(line) && line.length < 14) {
      const frag = clipAtWordBoundary(core, MAX - 2);
      line = law.thumb(frag, stake || '');
      if (line.length < 8) {
        line = clipAtWordBoundary(`${law.thumb('', '').replace(/…$/, '')} ${frag}`.trim(), MAX);
      }
    }
    line = clipAtWordBoundary(line, MAX);
    if (line.length >= 6 && line.length <= MAX) {
      let sc = scoreThumbnailLine(line) + law.scoreBoost;
      if (opts?.preferredBias && law.thumbBias === opts.preferredBias) sc += 0.8;
      sc -= motifOverlapPenalty(line, opts?.usedLines);
      // Prefer open curiosity punctuation on thumb
      if (/[?…]$/.test(line)) sc += 0.5;
      cands.push({ line, score: sc, lawId: law.id });
    }
  }

  // Also score raw psych fragments from script
  for (const { s, n } of ranked.slice(0, 8)) {
    let frag = s.replace(/[.!]+$/g, '').trim();
    const comma = frag.search(/[,，]/);
    if (comma >= 8 && comma <= MAX) frag = frag.slice(0, comma);
    frag = clipAtWordBoundary(frag, MAX);
    if (frag.length >= 8 && frag.length <= MAX) {
      let line = frag;
      if (line.length <= MAX - 1 && !/[?…]$/.test(line)) {
        const withDots = `${line}…`;
        if (withDots.length <= MAX) line = withDots;
      }
      let sc = scoreThumbnailLine(line) + n * 0.15;
      sc -= motifOverlapPenalty(line, opts?.usedLines);
      cands.push({ line: line.slice(0, MAX), score: sc, lawId: 0 });
    }
  }

  // Seed jitter + top-K rotation (same idea as SEO title)
  for (const c of cands) {
    c.score += ((hashSeed(c.line) + seed) % 5) * 0.15;
  }
  cands.sort((a, b) => b.score - a.score);
  const topK = cands.slice(0, Math.min(10, cands.length));
  const minKeep = (topK[0]?.score ?? 0) - 2;
  const topPool = topK.filter((x) => x.score >= minKeep);
  let best =
    topPool[seed % Math.max(1, topPool.length)]?.line ||
    cands[0]?.line ||
    clipAtWordBoundary(stripDialogueStyle(hook || ''), MAX);
  best = clipAtWordBoundary(best, MAX);
  if (best.length >= 8 && best.length <= MAX - 1 && !/[?…]$/.test(best)) {
    const withDots = `${best}…`;
    if (withDots.length <= MAX) best = withDots;
  }
  return sanitizeThumbnailLine(best.slice(0, MAX));
}

/** Chấm Title 0–10: tò mò + hút click (không thoại) + kỷ luật mobile ≤70 */
export function scoreSeoTitle(title: string): number {
  const t = (title || '').normalize('NFC').trim();
  if (!t) return 0;
  let s = 3;
  const len = t.length;
  // Mobile-first: 40–70 is sweet spot; 71–100 still ok but weaker
  if (len >= 40 && len <= YOUTUBE_MOBILE_TITLE_MAX) s += 2.2;
  else if (len >= 28 && len < 40) s += 1;
  else if (len > YOUTUBE_MOBILE_TITLE_MAX && len <= 85) s += 0.8;
  else if (len > 85 && len <= 100) s += 0.2;
  else if (len < 28) s -= 2;
  if (len > 100) s -= 2;

  if (PSYCH_CURIOSITY_RE.test(t) || /sự thật|tại sao|nhưng|liệu|không ngờ/i.test(t)) s += 1.5;
  if (PSYCH_THREAT_RE.test(t) || /sai một bước|hối|đáng sợ|rùng mình/i.test(t)) s += 1.5;
  if (PSYCH_QUESTION_RE.test(t) || /[…]$/.test(t)) s += 1;
  if (PSYCH_NUMBER_RE.test(t)) s += 0.5;
  if (/đừng bỏ lỡ|fomo|không ai dám/i.test(t)) s += 1;
  if (/^(chê|đừng mở|giả làm|xuyên không|mỗi lần|phế vật|trọng sinh)/i.test(t)) s += 0.8;
  // Trừ điểm: kiểu hội thoại / trích thoại / dump thoại FOMO
  if (PSYCH_DIALOGUE_RE.test(t) || /^(hắn|nàng|tôi|ta)\s/i.test(t)) s -= 2.5;
  if (/^(cô|anh|chị|em)\s+(chỉ|nói|hỏi|thì thầm)/i.test(t)) s -= 2.5;
  // FOMO + dialogue clause is a hard product anti-pattern (must score < pass 8.5)
  if (/đừng bỏ lỡ:\s*(cô|anh|hắn|nàng)\b/i.test(t)) s -= 3.5;
  if (/\bnơi\s+\p{L}+\s+vừa\s+vẽ/iu.test(t)) s -= 2.5;
  if (/\b(nói|thì thầm|hỏi|đáp)\b/i.test(t) && t.length > 55) s -= 1.5;
  if (PSYCH_POETIC_FLAT_RE.test(t) && !PSYCH_THREAT_RE.test(t)) s -= 1.5;
  // Lặp cụm
  if (/(\b[\p{L}]{4,}\b).*\1/iu.test(t)) s -= 0.5;

  // 55 psych laws boost
  s += Math.min(2, scoreTitleAgainstPsychLaws(t));
  // Mobile discipline soft boost (never claims CTR%)
  s += Math.min(0.8, scoreTitleMobileDiscipline(t).score * 0.08);

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

/** Chấm Thumbnail line 0–10 */
export function scoreThumbnailLine(line: string): number {
  const t = (line || '').normalize('NFC').trim();
  if (!t) return 0;
  let s = 3;
  const len = t.length;
  if (len >= 10 && len <= 30) s += 2.5;
  else if (len > 30) s -= 2;
  else if (len < 8) s -= 1.5;

  if (PSYCH_THREAT_RE.test(t) || PSYCH_NUMBER_RE.test(t)) s += 1.5;
  if (PSYCH_CURIOSITY_RE.test(t) || /[?…]$/.test(t)) s += 1.5;
  if (PSYCH_DIALOGUE_RE.test(t)) s -= 2;
  if (PSYCH_POETIC_FLAT_RE.test(t)) s -= 1;
  // Quá ngắn kiểu 1–2 ký tự
  if (len <= 6) s -= 1;

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

/** Chấm Description: bám thumb + PAS + tò mò */
export function scoreSeoDescription(desc: string, thumbnailLine?: string): number {
  const d = (desc || '').normalize('NFC').trim();
  if (!d) return 0;
  let s = 3;
  if (d.length >= 180 && d.length <= 2500) s += 1.5;
  else if (d.length < 80) s -= 2;

  const thumb = (thumbnailLine || '').trim();
  if (thumb && d.toLowerCase().includes(thumb.replace(/…$/, '').toLowerCase().slice(0, 12))) {
    s += 2; // bám Thumbnail line
  } else if (thumb) {
    s -= 1;
  }

  if (/📌|chapters?|timeline|0:00/i.test(d)) s += 1;
  if (/#\p{L}/u.test(d) || /tags?:/i.test(d)) s += 0.5;
  if (/like|subscribe|theo dõi|đăng ký/i.test(d)) s += 0.5;
  if (PSYCH_CURIOSITY_RE.test(d) || PSYCH_THREAT_RE.test(d)) s += 1;
  if (/——\s*HOOK/i.test(d)) s -= 1.5;
  // Description không nên toàn thoại dài
  const quoteCount = (d.match(/["“”]/g) || []).length;
  if (quoteCount >= 4) s -= 1;

  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

export interface YoutubeFieldScores {
  title: number;
  thumbnail: number;
  description: number;
  average: number;
  pass: boolean;
}

export function scoreYoutubeMetaFields(params: {
  seoTitle: string;
  thumbnailLine: string;
  seoDescription: string;
}): YoutubeFieldScores {
  const title = scoreSeoTitle(params.seoTitle);
  const thumbnail = scoreThumbnailLine(params.thumbnailLine);
  const description = scoreSeoDescription(params.seoDescription, params.thumbnailLine);
  const average = Math.round(((title + thumbnail + description) / 3) * 10) / 10;
  return {
    title,
    thumbnail,
    description,
    average,
    pass:
      title >= YOUTUBE_META_PASS_SCORE &&
      thumbnail >= YOUTUBE_META_PASS_SCORE &&
      description >= YOUTUBE_META_PASS_SCORE,
  };
}

/**
 * Pipeline Meta: sinh → chấm → dưới 8.5 viết lại (tối đa vài vòng).
 * Tiêu chí: duyên hút + gợi tò mò người xem.
 */
export function generateYoutubeMetaWithQA(params: {
  script: string;
  novelTitle?: string;
  chaptersText?: string;
  maxRounds?: number;
  /** Anti-repeat: titles / thumb lines already used on channel */
  usedTitles?: string[];
  usedThumbLines?: string[];
  chapter?: number;
  /** Visual DNA / media style — required for thumbnail prompt (B10: no invent) */
  visualDna?: string;
  characterHint?: string;
} & StyleEngineSeoOpts): {
  hook: string;
  seoTitle: string;
  thumbnailLine: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
  scores: YoutubeFieldScores;
  rounds: number;
  titleLawId?: number;
  titleLawName?: string;
} {
  const maxRounds = params.maxRounds ?? 5;
  const visualDna = (params.visualDna || '').trim();
  if (!visualDna) {
    throw new Error(
      'Thieu visualDna (Visual DNA / Media Style) de generateYoutubeMetaWithQA. App khong tu bi a style thumbnail.',
    );
  }
  const styleOpts: StyleEngineSeoOpts = {
    chu_de: params.chu_de,
    phong_cach: params.phong_cach,
    genre: params.genre,
    styleEngineId: params.styleEngineId,
  };
  const base = extractHookFromScript(params.script, {
    targetSec: 30,
    wpm: 140,
    visualDna,
    characterHint: params.characterHint,
    ...styleOpts,
  });
  const seed0 = hashSeed(
    base.hook + (params.novelTitle || '') + String(params.chapter || 0),
  );

  let best = {
    hook: base.hook,
    seoTitle: base.seoTitle,
    thumbnailLine: base.thumbnailLine,
    seoDescription: base.seoDescription,
    seoTags: base.seoTags,
    thumbnailPrompt: base.thumbnailPrompt,
    scores: scoreYoutubeMetaFields({
      seoTitle: base.seoTitle,
      thumbnailLine: base.thumbnailLine,
      seoDescription: base.seoDescription,
    }),
    rounds: 1,
    titleLawId: undefined as number | undefined,
    titleLawName: undefined as string | undefined,
  };

  const biases: ThumbBias[] = [
    'curiosity',
    'threat',
    'open',
    'forbidden',
    'question',
    'loss',
    'time',
    'paradox',
    'identity',
    'number',
  ];

  for (let round = 1; round <= maxRounds; round++) {
    const seed = seed0 + round * 17;
    const picked = pickBestSeoTitle(base.hook, params.novelTitle, {
      seed,
      usedTitles: params.usedTitles,
      ...styleOpts,
    });
    let seoTitle = frontLoadHookKeywords(sanitizeSeoTitle(picked.title));
    if (seoTitle.length > YOUTUBE_MOBILE_TITLE_MAX) {
      const clipped = enforceMobileTitle(seoTitle, YOUTUBE_MOBILE_TITLE_MAX);
      if (clipped.length >= 28) seoTitle = clipped;
    }
    seoTitle = seoTitle.slice(0, YOUTUBE_TITLE_HARD_MAX);

    const sents = splitSentencesVi(base.hook);
    const thumbSeedHook =
      round > 1 ? sents[(round + seed) % Math.max(1, sents.length)] || base.hook : base.hook;
    let thumbnailLine = buildClickThumbnailLine(thumbSeedHook, sents, {
      seed: seed + 3,
      usedLines: params.usedThumbLines,
      preferredBias: biases[(round + seed) % biases.length],
    });
    // Prefer style engine overlay examples when thumb is weak / short
    const styleOverlays = resolveSeoStyleProfile(styleOpts)?.ctr.thumbTextExamples;
    if (styleOverlays?.length && (round === 1 || thumbnailLine.length < 8)) {
      const pick = styleOverlays[(seed + round) % styleOverlays.length];
      if (pick) thumbnailLine = pick.slice(0, 30);
    }
    thumbnailLine = thumbnailLine.slice(0, 30);

    const seoTags = normalizeHashtagField(base.seoTags || buildSeoTags(base.hook));
    let seoDescription = buildSeoDescription({
      hook: base.hook,
      thumbnailLine,
      tags: seoTags,
      chaptersText: params.chaptersText,
      novelTitle: params.novelTitle,
      chapter: params.chapter,
    });

    let scores = scoreYoutubeMetaFields({ seoTitle, thumbnailLine, seoDescription });
    if (scores.description < YOUTUBE_META_PASS_SCORE) {
      seoDescription = buildSeoDescription({
        hook: base.hook,
        thumbnailLine,
        tags: seoTags,
        chaptersText: params.chaptersText,
        novelTitle: params.novelTitle,
        chapter: params.chapter,
        forceThumbLead: true,
        strongerAgitate: true,
      });
      scores = scoreYoutubeMetaFields({ seoTitle, thumbnailLine, seoDescription });
    }

    // Diversity bonus vs previous best (avoid same title motif)
    if (best.seoTitle && seoTitle.slice(0, 18) === best.seoTitle.slice(0, 18)) {
      scores = {
        ...scores,
        average: Math.max(0, scores.average - 0.4),
        pass: false,
      };
    }

    const thumbnailPrompt = buildThumbnailPrompt({
      hook: base.hook,
      thumbnailLine,
      visualDna,
      characterHint: params.characterHint,
      styleEngine: styleOpts,
      psychBias: biases[(round + seed) % biases.length],
    });

    const pack = {
      hook: base.hook,
      seoTitle,
      thumbnailLine,
      seoDescription,
      seoTags,
      thumbnailPrompt,
      scores,
      rounds: round,
      titleLawId: picked.lawId,
      titleLawName: picked.lawName,
    };

    if (scores.average > best.scores.average) best = pack;
    if (scores.pass) return pack;
  }

  return best;
}

/** #truyệnaudio — no spaces inside tag */
export function toHashtag(raw: string): string {
  const body = (raw || '')
    .normalize('NFC')
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return body ? `#${body}` : '';
}

/** Normalize free text → "#a #b #c" */
export function normalizeHashtagField(input: string): string {
  if (!input?.trim()) return '';
  const parts = input
    .normalize('NFC')
    .split(/[\s,;|]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => p.split(/(?=#)/).map((x) => x.trim()).filter(Boolean));
  const tags = parts.map(toHashtag).filter(Boolean);
  return Array.from(new Set(tags)).join(' ');
}

const SEO_TAG_STOPWORDS = new Set(
  [
    'không',
    'muốn',
    'trời',
    'phải',
    'những',
    'được',
    'trong',
    'một',
    'như',
    'của',
    'và',
    'cho',
    'với',
    'cái',
    'này',
    'kia',
    'rồi',
    'thì',
    'là',
    'có',
    'bị',
    'đã',
    'sẽ',
    'vẫn',
    'lại',
    'cũng',
    'mình',
    'bạn',
    'hắn',
    'nàng',
    'anh',
    'chị',
    'em',
    'tôi',
    'rằng',
    'nhưng',
    'hoặc',
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
  ].map((s) => s.toLowerCase()),
);

export function buildSeoTags(text: string): string {
  const base = [
    'truyệnaudio',
    'kểchuyện',
    'kịchbản',
    'truyệnđêm',
    'audiobook',
    'novel',
  ];
  // Prefer multi-syllable / content words; never ship dialogue fillers as tags
  const words = (text || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter(
      (w) =>
        w.length >= 5 &&
        !SEO_TAG_STOPWORDS.has(w) &&
        !/^\d+$/.test(w),
    )
    .slice(0, 6);
  const unique = Array.from(new Set([...base, ...words]));
  return unique.map(toHashtag).filter(Boolean).slice(0, 12).join(' ');
}

/**
 * Description — viết LẠI theo Thumbnail line (lead tò mò).
 * PAS: Problem (thumb) → Agitate (tóm ý, KHÔNG dump thoại) → Chapters + CTA + Tags
 */
export function buildSeoDescription(params: {
  hook: string;
  thumbnailLine: string;
  tags?: string;
  chaptersText?: string;
  novelTitle?: string;
  chapter?: number;
  forceThumbLead?: boolean;
  strongerAgitate?: boolean;
}): string {
  const thumb = (params.thumbnailLine || '').trim().slice(0, 30);
  const hookClean = stripDialogueStyle(params.hook || '');
  const title = (params.novelTitle || '').trim();
  const ch = params.chapter;

  // Lead = Thumbnail line (bắt buộc khi forceThumbLead)
  const lead =
    thumb ||
    clipAtWordBoundary(hookClean.split(/[.!?…]/)[0] || hookClean, 30) ||
    'Đừng xem nếu bạn dễ mất ngủ…';

  // Agitate: paraphrase tension — không chép hội thoại dài
  const sents = splitSentencesVi(hookClean)
    .filter((s) => !PSYCH_DIALOGUE_RE.test(s) && scorePsychologicalPull(s) >= 2)
    .slice(0, 3);
  const body =
    sents.length > 0
      ? sents.map((s) => clipAtWordBoundary(stripDialogueStyle(s), 140)).join(' ')
      : clipAtWordBoundary(hookClean, 220);

  // Diversify stock agitate by seed (avoid same motif every video)
  const seed = hashSeed(thumb + hookClean + String(params.chapter || 0));
  const agitatePoolSoft = [
    'Mỗi manh mối mở ra lại kéo theo một cái bẫy mới — không có đường lui an toàn.',
    'Khoảng im lặng giữa hai nhịp thở chính là lúc mọi thứ có thể sụp.',
    'Càng biết thêm một chi tiết, cái giá phải trả càng rõ — và càng nặng.',
    'Họ không kể hết. Phần còn lại chỉ lộ ra khi bạn đi đến phút cuối.',
  ];
  const agitatePoolHard = [
    'Càng đi sâu, khoảng trống thông tin càng lớn — cái giá không còn chỉ là mạng sống.',
    'Phút tiếp theo có thể lật ngược mọi thứ bạn vừa tin.',
    'Một lựa chọn sai và toàn bộ chuỗi sự kiện sẽ khóa vĩnh viễn.',
    'Bí mật không “lộ từ từ” — nó vỡ ra đúng lúc không còn chỗ trốn.',
  ];
  const soft = agitatePoolSoft[seed % agitatePoolSoft.length];
  const hard = agitatePoolHard[(seed + 2) % agitatePoolHard.length];
  const agitate = params.strongerAgitate
    ? [body, hard, agitatePoolHard[(seed + 5) % agitatePoolHard.length]].join('\n')
    : [body, soft].join('\n');

  const seriesLine = title
    ? `Tác phẩm: ${title}${ch ? ` · Chương ${ch}` : ''}`
    : 'Series kể chuyện đêm — drama · narration';

  const lines = [
    lead,
    '',
    agitate,
    '',
    seriesLine,
    '',
    '📌 Timeline / Chapters:',
    params.chaptersText || '(Sinh TTS theo cảnh rồi Export Pack để có mốc thời gian.)',
    '',
    '🔥 Nếu bạn từng thức khuya vì không thể dừng — series này dành cho bạn.',
    '🔔 Like · Subscribe để không bỏ lỡ chương sau.',
    '💬 Comment: bạn đoán điều gì xảy ra tiếp theo?',
    '',
    'Tags:',
    normalizeHashtagField(params.tags || '') || params.tags || '',
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

/** Marker used when blending competitor DNA into a thumb gen prompt (gen-time). */
export const COMPETITOR_THUMB_DNA_MARKER = 'COMPETITOR THUMB DNA LOCK';

/**
 * Strip a previously baked competitor DNA block from a prompt so content stays editable.
 */
export function stripCompetitorThumbDna(prompt: string): string {
  const raw = String(prompt || '');
  if (!raw.includes(COMPETITOR_THUMB_DNA_MARKER)) return raw.trim();
  return raw
    .replace(
      new RegExp(
        `\\[?\\s*${COMPETITOR_THUMB_DNA_MARKER}[\\s\\S]*?\\]?\\s*$`,
        'i',
      ),
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Blend competitor thumbnail DNA into a content prompt at gen-time.
 * Keeps the story/subject of `thumbnailPrompt` and locks layout/style to competitor DNA.
 * Does not permanently mutate the stored prompt unless the caller saves the result.
 */
export function blendThumbPromptWithCompetitorDna(params: {
  thumbnailPrompt: string;
  competitorDna: string;
}): string {
  const base = stripCompetitorThumbDna(params.thumbnailPrompt || '');
  const dna = String(params.competitorDna || '').trim();
  if (!dna) return base;
  if (!base) {
    return [
      'YouTube thumbnail still, 16:9, high contrast, readable negative space for bold text overlay',
      `[${COMPETITOR_THUMB_DNA_MARKER}: match this visual/layout DNA EXACTLY — composition, crop, color grade, lighting, face scale, text-safe zones, contrast blocks: ${dna}]`,
    ].join(' ');
  }
  return [
    base,
    `[${COMPETITOR_THUMB_DNA_MARKER}: MATCH this competitor visual/layout DNA EXACTLY (composition grid, face crop ratio, color blocks, lighting recipe, grade, text-safe negative space, CTR micro-patterns). Keep the SUBJECT/STORY content of the prompt above unchanged — only clone the DNA, not the competitor's story: ${dna}]`,
  ].join(' ');
}

/** Cinematic EN prompt for thumbnail still (Whisk / Flux / MJ) — curiosity-biased */
export function buildThumbnailPrompt(params: {
  hook: string;
  thumbnailLine: string;
  visualDna?: string;
  characterHint?: string;
  psychBias?: ThumbBias;
  /** Optional competitor thumb DNA — preferred over visualDna when set */
  competitorThumbDna?: string;
  /**
   * High-CTR composition preset (split / hologram / scale / emotion zoom).
   * Locks layout in prompt — does not invent story content.
   */
  compositionId?: ThumbCompositionId | string | null;
  /** Style Engine niche composition (Setup chu_de/phong_cach) */
  styleEngine?: StyleEngineSeoOpts | null;
}): string {
  const mood = (params.thumbnailLine || params.hook || '').trim().slice(0, 120);
  if (!mood) {
    throw new Error('Thieu hook/thumbnailLine de tao thumbnail prompt.');
  }
  const competitor = params.competitorThumbDna?.trim() || '';
  const styleProf = resolveSeoStyleProfile(params.styleEngine);
  const dna =
    competitor ||
    params.visualDna?.trim() ||
    styleProf?.visual.visualDnaEn ||
    '';
  if (!dna) {
    throw new Error('Thieu visualDna de tao thumbnail prompt.');
  }
  const char = params.characterHint?.trim() || '';
  const bias = params.psychBias || 'curiosity';
  const biasLook: Record<ThumbBias, string> = {
    threat: 'high-stakes danger cue, clenched jaw, edge of frame threat shadow',
    curiosity: 'eyes toward off-screen secret, partial reveal, mystery light slit',
    number: 'clear focal subject, space for bold short overlay text',
    question: 'raised brows, incomplete gesture, freeze mid-action',
    forbidden: 'door ajar / sealed document vibe, hush atmosphere, low key',
    identity: 'tight face readable at mobile size, intimate portrait tension',
    time: 'motion blur edge, countdown urgency, frozen second',
    paradox: 'visual contradiction in one frame, uncanny pairing',
    scale: 'tiny human vs vast ruin OR extreme close detail of huge stake',
    social: 'crowd silhouette vs one person, isolation in group',
    loss: 'empty hands, broken object, aftermath silence',
    open: 'composition leads eye off-frame, unfinished action',
  };
  const biasText = biasLook[bias];
  if (!biasText) {
    throw new Error(`Thumbnail psychBias khong hop le: ${bias}`);
  }
  const composition = compositionPromptBlock(params.compositionId);
  const styleComp = styleProf?.ctr.thumbCompositionHintEn?.trim();
  const styleGrade = styleProf?.visual.colorGrade?.trim();
  const core = [
    `YouTube thumbnail still, 16:9, high contrast, readable negative space for bold text overlay`,
    `dramatic key light, shallow depth, emotional face readable at small size`,
    composition ? `COMPOSITION LOCK: ${composition}` : undefined,
    styleComp ? `STYLE ENGINE COMPOSITION: ${styleComp}` : undefined,
    styleGrade ? `color grade: ${styleGrade}` : undefined,
    `click-curiosity bias (${bias}): ${biasText}`,
    char || undefined,
    `scene mood / overlay intent: ${mood}`,
    competitor
      ? undefined
      : dna,
    `no clutter, no watermark, no UI chrome, no illegible tiny text painted in image`,
    // Overlay text is applied in CapCut/editor — do not bake long title into pixels
    `leave clean text-safe zone for 2-4 word overlay only; do NOT paint full video title into the image`,
  ]
    .filter(Boolean)
    .join(', ');
  if (competitor) {
    return blendThumbPromptWithCompetitorDna({
      thumbnailPrompt: core,
      competitorDna: competitor,
    });
  }
  return core;
}

