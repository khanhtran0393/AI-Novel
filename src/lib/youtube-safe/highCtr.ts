/**
 * High-CTR packaging helpers for YouTube audio/story channels.
 *
 * Product scope (MVP — no fake CTR% claims):
 * - 4 thumbnail composition presets (prompt lock)
 * - 5 psychological title formulas (variants)
 * - Mobile title discipline (≤70 chars preferred)
 * - Overlay text 2–4 words (must not repeat full title)
 * - Pack readiness checklist (heuristic, not predicted CTR)
 */

import { clipAtWordBoundary } from './text';

/** Soft mobile cutoff — YouTube app truncates roughly here */
export const YOUTUBE_MOBILE_TITLE_MAX = 70;
/** Prefer punchy titles under this when candidates are equal */
export const YOUTUBE_MOBILE_TITLE_SOFT = 65;
/** Hard field limit still 100 in store/API */
export const YOUTUBE_TITLE_HARD_MAX = 100;

export type ThumbCompositionId =
  | 'split_before_after'
  | 'hologram_ui'
  | 'scale_goliath'
  | 'emotion_zoom';

export type TitleFormulaId =
  | 'slap_face'
  | 'paradox'
  | 'night_horror'
  | 'hidden_master'
  | 'comfort_slice';

export interface ThumbCompositionPreset {
  id: ThumbCompositionId;
  /** Short chip label */
  shortLabel: string;
  labelVi: string;
  /** Injected into EN thumbnail prompt (composition lock) */
  enBlock: string;
  hintVi: string;
}

export interface TitleFormulaVariant {
  id: TitleFormulaId;
  labelVi: string;
  title: string;
}

export interface HighCtrCheckItem {
  id: string;
  label: string;
  ok: boolean;
  level: 'pass' | 'warn' | 'fail';
  detail?: string;
}

export interface HighCtrPackReport {
  items: HighCtrCheckItem[];
  passCount: number;
  total: number;
  /** All critical items pass (warn-only may fail) */
  ready: boolean;
  summary: string;
}

/** Dopamine / niche hook tokens — push early in title when present */
export const DOPAMINE_HOOK_TOKENS = [
  'phế vật',
  'trọng sinh',
  'hủy hôn',
  'thần cấp',
  'giấu nghề',
  'vả mặt',
  'thức tỉnh',
  'xuyên không',
  'hệ thống',
  'quỷ vương',
  'tông môn',
  'nông trường',
  'quán ăn',
  'đừng mở',
  '1h đêm',
  'quỳ',
  'bá đạo',
] as const;

export const THUMB_COMPOSITION_PRESETS: readonly ThumbCompositionPreset[] = [
  {
    id: 'split_before_after',
    shortLabel: 'Vả mặt',
    labelVi: 'Tương phản Before vs After (split screen)',
    hintVi: 'Trái: u ám / bị khinh · Phải: thức tỉnh hào quang',
    enBlock:
      'SPLIT-SCREEN before-vs-after composition: LEFT half ragged clothes, kneeling, humiliated, dark desaturated crushed; RIGHT half power awakening, golden aura explosion, triumphant stance; hard vertical divide, extreme contrast, face readable on both sides at mobile size',
  },
  {
    id: 'hologram_ui',
    shortLabel: 'Hologram',
    labelVi: 'Màn hình hệ thống neon (Hologram UI)',
    hintVi: 'Close-up mặt nhếch mép + bảng hologram neon trước mặt',
    enBlock:
      'tight face close-up with smug half-smile, neon hologram system UI panels floating in front (green/orange glow), interface reflections on eyes and skin, cyber HUD numbers, high contrast dark background, single clear focal face',
  },
  {
    id: 'scale_goliath',
    shortLabel: 'Áp đảo',
    labelVi: 'Bối cảnh áp đảo (Scale & Goliath)',
    hintVi: 'NV nhỏ quay lưng · quái vật/tập đoàn khổng lồ phía trước',
    enBlock:
      'extreme scale contrast: tiny protagonist back-to-camera facing a colossal monster OR mega-corporation titan silhouette filling the sky, dread and imminent conflict, wide 16:9 cinematic frame, clear silhouette readability at phone size',
  },
  {
    id: 'emotion_zoom',
    shortLabel: 'Biểu cảm',
    labelVi: 'Điểm tò mò biểu cảm (High Emotion Zoom)',
    hintVi: 'Cận ánh mắt phẫn nộ/tuyệt vọng + vật phẩm phát sáng',
    enBlock:
      'extreme close-up eyes full of rage or despair, one mysterious glowing artifact in hand catching key light, shallow depth of field, emotional micro-expression readable at thumbnail size, negative space for short overlay text',
  },
] as const;

const FORMULA_META: Record<
  TitleFormulaId,
  { labelVi: string; build: (core: string, stake: string, n: string) => string }
> = {
  slap_face: {
    labelVi: 'Vả mặt / Trọng sinh',
    build: (core, stake, n) => {
      // Label-like weak phrase — strip leading pronouns to avoid "Chê hắn hắn…"
      let weak = clipAtWordBoundary(core || 'phế vật', 18)
        .replace(/^(hắn|nàng|cô|anh|hắn ta)\s+/i, '')
        .trim();
      if (!weak || weak.length < 4) weak = 'phế vật';
      const boom = clipAtWordBoundary(stake || 'cả tông môn phải quỳ', 22)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      return `Chê hắn ${weak.charAt(0).toLowerCase()}${weak.slice(1)} — ${n} năm sau ${boom.charAt(0).toLowerCase()}${boom.slice(1)}`.replace(
        /\s+/g,
        ' ',
      );
    },
  },
  paradox: {
    labelVi: 'Quy tắc nghịch lý',
    build: (core, stake, _n) => {
      let act = clipAtWordBoundary(core || 'bị đánh chết', 20)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      if (/siết|dao|máu/i.test(act)) act = 'bị dồn đến đường cùng';
      const reward = clipAtWordBoundary(stake || 'mạnh gấp trăm lần', 24)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      const rewardPhrase = /quỳ|giết|bí mật/i.test(reward)
        ? 'mạnh hơn kẻ dồn hắn'
        : reward.charAt(0).toLowerCase() + reward.slice(1);
      return `Mỗi lần ${act.charAt(0).toLowerCase()}${act.slice(1)}, hắn lại ${rewardPhrase}`.replace(
        /\s+/g,
        ' ',
      );
    },
  },
  night_horror: {
    labelVi: 'Cảnh báo đêm khuya',
    build: (core, stake, _n) => {
      let rules = clipAtWordBoundary(stake || core || 'quy tắc sinh tồn kỳ quái', 34)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      if (/quỳ xin|thế giới phải/i.test(rules) && !/quy tắc|bí mật|hầm|đêm/i.test(rules)) {
        rules = clipAtWordBoundary(core || 'bí mật trong hầm', 34);
      }
      return `Đừng mở video này lúc 1h đêm: ${rules.charAt(0).toLowerCase()}${rules.slice(1)}`.replace(
        /\s+/g,
        ' ',
      );
    },
  },
  hidden_master: {
    labelVi: 'Giấu nghề / Ẩn thân',
    build: (core, stake, _n) => {
      let weak = clipAtWordBoundary(core || 'kẻ yếu nhất', 18)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      if (/siết|dao|máu/i.test(weak)) weak = 'kẻ yếu nhất';
      let reveal = clipAtWordBoundary(stake || 'quỷ vương xuất hiện', 28)
        .replace(/^(hắn|nàng)\s+/i, '')
        .trim();
      if (/quỳ xin tha/i.test(reveal)) reveal = 'bí mật trong hầm lộ ra';
      return `Giả làm ${weak.charAt(0).toLowerCase()}${weak.slice(1)}, đến khi ${reveal.charAt(0).toLowerCase()}${reveal.slice(1)}`.replace(
        /\s+/g,
        ' ',
      );
    },
  },
  comfort_slice: {
    labelVi: 'Ẩm thực / Nông trường',
    build: (core, stake, _n) => {
      // Keep comfort formula readable even on dark scripts
      const foodish = /quán|ăn|nông|ruộng|mì|cơm|tiên giới/i.test(core + stake);
      const act = foodish ? clipAtWordBoundary(core, 22) : 'mở quán ăn ở tiên giới';
      const auth = /vua|đế|tông/i.test(stake)
        ? clipAtWordBoundary(stake, 26)
        : 'đế vương cũng xếp hàng';
      return `Xuyên không ${act.charAt(0).toLowerCase()}${act.slice(1)}, ${auth.charAt(0).toLowerCase()}${auth.slice(1)}`.replace(
        /\s+/g,
        ' ',
      );
    },
  },
};

const FORMULA_ORDER: TitleFormulaId[] = [
  'slap_face',
  'paradox',
  'night_horror',
  'hidden_master',
  'comfort_slice',
];

const OVERLAY_STOCK = [
  'CHÊ TÔI YẾU?',
  'CỨU TÔI VỚI!',
  'HỆ THỐNG MỞ!',
  '3 NĂM SAU…',
  'ĐỪNG MỞ!',
  'HẮN THỨC TỈNH',
  'QUỲ XIN THA',
  'BÍ MẬT LỘ',
  'MỘT ĐÊM…',
  'KHÔNG AI NGỜ',
] as const;

function nfc(s: string): string {
  return (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function hashSeed(s: string): number {
  let h = 0;
  const t = nfc(s);
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function stripTags(script: string): string {
  return nfc(script).replace(/\[CẢNH[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function splitSentencesVi(text: string): string[] {
  return stripTags(text)
    .split(/(?<=[.!?…])\s+|[;；]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** Strip quotes / dialogue speaker noise for title formula cores */
function cleanTitleFragment(raw: string): string {
  let s = nfc(raw)
    .replace(/["“”'']/g, '')
    .replace(/^(?:hắn|nàng|cô|anh|tôi|ta)\s+(?:nói|thì thầm|gào|hét|đáp|hỏi)[:：]?\s*/i, '')
    .replace(/^(?:nếu|khi|mà|và|rồi)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Prefer noun-ish threat chunks over pure conditionals
  if (/^không mở|^mở cửa|^cô ấy chết/i.test(s) && s.length < 28) {
    return s;
  }
  return s;
}

function extractCoreStake(hook: string): { core: string; stake: string } {
  const sentences = splitSentencesVi(hook);
  const pool = (sentences.length ? sentences : [nfc(hook)].filter(Boolean)).map(cleanTitleFragment);
  const scored = pool.map((s) => {
    let n = 0;
    if (/phế|yếu|khinh|hủy|chết|đánh|sợ|quỳ|mất|bí mật|hệ thống|thức tỉnh|quỷ|vua|tông|dao|máu|hầm/i.test(s))
      n += 3;
    if (/\d+/.test(s)) n += 1;
    if (s.length >= 12 && s.length <= 55) n += 1;
    // Penalize pure conditional / soft glue
    if (/^(nếu|khi|và|rồi)\b/i.test(s)) n -= 2;
    if (/thì thầm|nói rằng/i.test(s)) n -= 2;
    return { s, n };
  });
  scored.sort((a, b) => b.n - a.n);
  // Prefer threat/secret stake over conditional cores when ranking ties
  const threat = scored.find((x) => /bí mật|giết|chết|dao|máu|hầm|quỷ/i.test(x.s));
  const coreRaw =
    scored.find((x) => /phế|yếu|khinh|hủy|siết|dao/i.test(x.s))?.s ||
    scored[0]?.s ||
    hook ||
    'phế vật bị khinh';
  const stakeRaw =
    threat?.s ||
    scored.find((x) => x.s !== coreRaw)?.s ||
    scored[0]?.s ||
    'cả thế giới phải quỳ';
  const core = clipAtWordBoundary(cleanTitleFragment(coreRaw), 36);
  let stake = clipAtWordBoundary(cleanTitleFragment(stakeRaw), 32);
  if (stake.toLowerCase() === core.toLowerCase()) {
    stake = clipAtWordBoundary('cả thế giới phải quỳ xin tha', 32);
  }
  return { core: core || 'bí mật bị giấu', stake: stake || 'thức tỉnh thần cấp' };
}

function pickYears(seed: number): string {
  const opts = ['3', '7', '10', '100'];
  return opts[seed % opts.length];
}

/** Clip title for mobile feed (word boundary). */
export function enforceMobileTitle(
  title: string,
  max = YOUTUBE_MOBILE_TITLE_MAX,
): string {
  let t = nfc(title);
  if (!t) return t;
  if (t.length <= max) return t;
  t = clipAtWordBoundary(t, max);
  // Prefer ending with … or ? when truncated mid-thought
  if (t.length >= 12 && !/[?…!]$/.test(t)) {
    const withDots = `${t.replace(/[,:;—\-]+$/g, '').trim()}…`;
    if (withDots.length <= max) t = withDots;
  }
  return t.slice(0, max);
}

/**
 * If a dopamine token exists in the title but not in the first ~5 words,
 * try to surface a short token prefix (non-destructive when impossible).
 */
export function frontLoadHookKeywords(title: string): string {
  const t = nfc(title);
  if (!t) return t;
  const lower = t.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const head = words.slice(0, 5).join(' ').toLowerCase();

  let found: string | null = null;
  for (const tok of DOPAMINE_HOOK_TOKENS) {
    if (lower.includes(tok) && !head.includes(tok)) {
      found = tok;
      break;
    }
  }
  if (!found) return t;

  // Already starts with related punch — leave alone
  if (/^(chê|đừng|giả làm|xuyên không|mỗi lần)/i.test(t)) return t;

  const prefix = found
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('vi-VN') + w.slice(1))
    .join(' ');
  const merged = `${prefix}: ${t}`;
  return enforceMobileTitle(merged, YOUTUBE_MOBILE_TITLE_MAX);
}

export function scoreTitleMobileDiscipline(title: string): {
  charCount: number;
  mobileOk: boolean;
  softOk: boolean;
  hasDopamineHook: boolean;
  hookInFirstFiveWords: boolean;
  score: number;
} {
  const t = nfc(title);
  const charCount = t.length;
  const mobileOk = charCount > 0 && charCount <= YOUTUBE_MOBILE_TITLE_MAX;
  const softOk = charCount > 0 && charCount <= YOUTUBE_MOBILE_TITLE_SOFT;
  const lower = t.toLowerCase();
  const head = t.split(/\s+/).filter(Boolean).slice(0, 5).join(' ').toLowerCase();

  let hasDopamineHook = false;
  let hookInFirstFiveWords = false;
  for (const tok of DOPAMINE_HOOK_TOKENS) {
    if (lower.includes(tok)) {
      hasDopamineHook = true;
      if (head.includes(tok)) hookInFirstFiveWords = true;
    }
  }
  // Formula openers also count as hook-front
  if (/^(chê|đừng mở|giả làm|xuyên không|mỗi lần)/i.test(t)) {
    hasDopamineHook = true;
    hookInFirstFiveWords = true;
  }

  let score = 4;
  if (mobileOk) score += 3;
  else if (charCount <= 85) score += 1;
  else score -= 1;
  if (softOk) score += 1;
  if (hasDopamineHook) score += 1.5;
  if (hookInFirstFiveWords) score += 1;
  if (charCount < 24) score -= 2;
  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

  return {
    charCount,
    mobileOk,
    softOk,
    hasDopamineHook,
    hookInFirstFiveWords,
    score,
  };
}

export function getThumbCompositionPreset(
  id: string | null | undefined,
): ThumbCompositionPreset | null {
  if (!id) return null;
  return THUMB_COMPOSITION_PRESETS.find((p) => p.id === id) || null;
}

export function compositionPromptBlock(id: string | null | undefined): string {
  return getThumbCompositionPreset(id)?.enBlock || '';
}

/**
 * Five title variants from fixed psychological formulas.
 * Always returns 5 entries (NFC, mobile-clipped ≤70).
 */
export function buildFiveTitleFormulas(params: {
  hook: string;
  novelTitle?: string;
  seed?: number;
  /** When true (default), clip each title to mobile max */
  mobileClip?: boolean;
}): TitleFormulaVariant[] {
  const hook = nfc(params.hook);
  if (!hook) {
    return FORMULA_ORDER.map((id) => ({
      id,
      labelVi: FORMULA_META[id].labelVi,
      title: '',
    }));
  }
  const { core, stake } = extractCoreStake(hook);
  const seed = params.seed ?? hashSeed(hook + (params.novelTitle || ''));
  const years = pickYears(seed);
  const mobile = params.mobileClip !== false;

  return FORMULA_ORDER.map((id, i) => {
    const raw = FORMULA_META[id].build(core, stake, years);
    let title = nfc(raw);
    // Light series attach only for comfort / slap when room
    const series = clipAtWordBoundary(nfc(params.novelTitle || ''), 14);
    if (series && (id === 'comfort_slice' || (id === 'slap_face' && i === 0))) {
      if (title.length + series.length + 3 <= YOUTUBE_MOBILE_TITLE_MAX) {
        title = `${title} | ${series}`;
      }
    }
    title = frontLoadHookKeywords(title);
    if (mobile) title = enforceMobileTitle(title, YOUTUBE_MOBILE_TITLE_MAX);
    else title = enforceMobileTitle(title, YOUTUBE_TITLE_HARD_MAX);
    // Sentence case first char
    if (title) title = title.charAt(0).toLocaleUpperCase('vi-VN') + title.slice(1);
    return {
      id,
      labelVi: FORMULA_META[id].labelVi,
      title,
    };
  }).filter((v) => v.title.length >= 12);
}

/**
 * Overlay suggestions: 2–4 words (or short punch), must not equal/substring-dump the title.
 */
export function suggestThumbOverlayTexts(params: {
  seoTitle: string;
  hook?: string;
  thumbnailLine?: string;
  max?: number;
}): string[] {
  const max = Math.max(2, Math.min(8, params.max ?? 4));
  const title = nfc(params.seoTitle).toLowerCase();
  const hook = nfc(params.hook || '');
  const line = nfc(params.thumbnailLine || '');
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    let t = nfc(raw)
      .replace(/["""'']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return;
    // Cap words 2–4 (allow short !/? phrases)
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length > 4) t = words.slice(0, 4).join(' ');
    if (words.length < 1) return;
    if (t.length > 28) t = clipAtWordBoundary(t, 28);
    // Uppercase display for overlay punch
    const display = t.toLocaleUpperCase('vi-VN');
    const key = display.toLowerCase();
    if (seen.has(key)) return;
    // Must not repeat full title or long title chunk
    if (title && (title.includes(key) || key.includes(title.slice(0, 18)))) return;
    if (title && key.length >= 10 && title.includes(key.slice(0, 10))) return;
    seen.add(key);
    out.push(display);
  };

  // From existing thumbnail line first (if short enough)
  if (line) {
    const w = line.split(/\s+/).filter(Boolean);
    if (w.length <= 4) push(line);
    else push(w.slice(0, 3).join(' '));
  }

  // Dynamic from hook
  if (/hệ thống|system/i.test(hook + title)) push('HỆ THỐNG MỞ!');
  if (/phế|yếu|khinh/i.test(hook + title)) push('CHÊ TÔI YẾU?');
  if (/cứu|chết|nguy/i.test(hook)) push('CỨU TÔI VỚI!');
  if (/năm sau|trọng sinh|thức tỉnh/i.test(hook + title)) push('3 NĂM SAU…');
  if (/đêm|ma|quỷ|1h/i.test(hook + title)) push('ĐỪNG MỞ!');
  if (/giấu|giả làm|yếu nhất/i.test(hook + title)) push('HẮN THỨC TỈNH');

  for (const s of OVERLAY_STOCK) {
    if (out.length >= max) break;
    push(s);
  }

  return out.slice(0, max);
}

/** True when overlay is short punch and does not clone title */
export function isValidThumbOverlay(overlay: string, seoTitle: string): boolean {
  const o = nfc(overlay);
  const title = nfc(seoTitle).toLowerCase();
  if (!o) return false;
  const words = o.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (o.length > 30) return false;
  const ol = o.toLowerCase();
  if (title && (ol === title || (ol.length >= 12 && title.includes(ol)))) return false;
  return true;
}

/**
 * Pack readiness — heuristic only. Never claim predicted CTR %.
 */
export function evaluateHighCtrPack(params: {
  seoTitle: string;
  thumbnailLine: string;
  thumbnailPrompt?: string;
  compositionId?: string | null;
  seoTitleVariantsCount?: number;
}): HighCtrPackReport {
  const title = nfc(params.seoTitle);
  const line = nfc(params.thumbnailLine);
  const prompt = nfc(params.thumbnailPrompt || '');
  const mobile = scoreTitleMobileDiscipline(title);
  const composition = getThumbCompositionPreset(params.compositionId);
  const overlayOk = isValidThumbOverlay(line, title) || line.length === 0;

  const items: HighCtrCheckItem[] = [
    {
      id: 'title_mobile',
      label: mobile.mobileOk
        ? `Title mobile OK (${mobile.charCount}/${YOUTUBE_MOBILE_TITLE_MAX})`
        : `Title dài mobile (${mobile.charCount}>${YOUTUBE_MOBILE_TITLE_MAX})`,
      ok: mobile.mobileOk,
      level: !title ? 'fail' : mobile.mobileOk ? 'pass' : 'warn',
      detail: mobile.mobileOk
        ? undefined
        : 'Rút ≤70 ký tự để tránh bị cắt … trên YouTube app',
    },
    {
      id: 'title_hook',
      label: mobile.hasDopamineHook
        ? mobile.hookInFirstFiveWords
          ? 'Hook keyword đầu title'
          : 'Có hook keyword (nên đẩy lên đầu)'
        : 'Thiếu từ khóa hook dopamine',
      ok: mobile.hasDopamineHook,
      level: mobile.hasDopamineHook
        ? mobile.hookInFirstFiveWords
          ? 'pass'
          : 'warn'
        : 'warn',
    },
    {
      id: 'thumb_composition',
      label: composition
        ? `Bố cục thumb: ${composition.shortLabel}`
        : 'Chưa chọn bố cục thumb (4 preset)',
      ok: !!composition,
      level: composition ? 'pass' : 'warn',
      detail: composition?.hintVi,
    },
    {
      id: 'thumb_prompt_focus',
      label:
        prompt.length > 40
          ? composition && prompt.toLowerCase().includes(composition.id.replace(/_/g, ''))
            ? 'Thumb prompt có composition'
            : composition && prompt.includes(composition.enBlock.slice(0, 24))
              ? 'Thumb prompt khóa bố cục'
              : 'Thumb prompt có nội dung'
          : 'Thiếu thumb prompt',
      ok: prompt.length > 40,
      level: prompt.length > 40 ? 'pass' : 'warn',
    },
    {
      id: 'overlay_discipline',
      label: !line
        ? 'Chưa có chữ đè thumb (2–4 từ)'
        : overlayOk
          ? `Chữ đè OK (${line.split(/\s+/).length} từ)`
          : 'Chữ đè lặp title / quá dài',
      ok: !!line && overlayOk,
      level: !line ? 'warn' : overlayOk ? 'pass' : 'fail',
      detail: 'Chữ thumb ≠ title; 2–4 từ kích tò mò',
    },
    {
      id: 'title_thumb_pair',
      label: title && line ? 'Title + thumb line bổ trợ' : 'Thiếu cặp title/thumb',
      ok: !!(title && line && !title.toLowerCase().includes(line.toLowerCase().slice(0, 12))),
      level:
        title && line
          ? title.toLowerCase().includes(line.toLowerCase().replace(/…$/, '').slice(0, 10))
            ? 'warn'
            : 'pass'
          : 'warn',
      detail: 'Tránh copy nguyên title lên ảnh',
    },
  ];

  // Optional: variants available
  if (typeof params.seoTitleVariantsCount === 'number') {
    items.push({
      id: 'title_formulas',
      label:
        params.seoTitleVariantsCount >= 5
          ? 'Đủ 5 công thức title'
          : `Title variants: ${params.seoTitleVariantsCount}/5`,
      ok: params.seoTitleVariantsCount >= 5,
      level: params.seoTitleVariantsCount >= 5 ? 'pass' : 'warn',
    });
  }

  const passCount = items.filter((i) => i.ok).length;
  const criticalFail = items.some((i) => i.level === 'fail');
  const ready = !criticalFail && passCount >= Math.ceil(items.length * 0.6);
  const summary = ready
    ? `Pack CTR-ready ${passCount}/${items.length} (heuristic — không dự đoán CTR%)`
    : `Pack chưa sẵn ${passCount}/${items.length} — sửa title/thumb/overlay`;

  return { items, passCount, total: items.length, ready, summary };
}
