/**
 * Free + Trial product limits (client + server safe — no fs).
 * Server authority for daily counters: freeQuota.ts (file vault by HWID+day).
 *
 * Free: unchanged product caps (600 words · 2 chapters · 3/day).
 * Trial: Pro-equivalent features · 5/day per free-style bucket · max 10 chapters ·
 *        no word/chapter length cap · 7 days (AINOVEL_TRIAL_DAYS default).
 * Pro: unlimited (no vault metering — LICENSE_ONE_PATH).
 */

import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';

/** Hard product caps for Free tier (LOCKED product — do not change without product OK) */
export const FREE_LIMITS = {
  /** Max target + content words per chapter */
  maxWordsPerChapter: 600,
  /** Max chapters in a Free project */
  maxChapters: 2,
  /** Max successful uses per Free feature bucket per calendar day (local HWID) */
  dailyUsesPerFeature: 3,
} as const;

/**
 * Trial caps — Pro feature matrix, metered free-style buckets only.
 */
export const TRIAL_LIMITS = {
  /** Max target + content words per chapter (Trial) */
  maxWordsPerChapter: 3000,
  maxChapters: 10,
  dailyUsesPerFeature: 5,
  /** Default trial length (days) — env AINOVEL_TRIAL_DAYS overrides */
  days: 7,
} as const;

export type TierLimits = {
  maxWordsPerChapter: number;
  maxChapters: number;
  dailyUsesPerFeature: number;
};

export function limitsForMeteredTier(
  tier: 'free' | 'trial' | 'pro' | string,
): TierLimits | null {
  if (tier === 'free') {
    return {
      maxWordsPerChapter: FREE_LIMITS.maxWordsPerChapter,
      maxChapters: FREE_LIMITS.maxChapters,
      dailyUsesPerFeature: FREE_LIMITS.dailyUsesPerFeature,
    };
  }
  if (tier === 'trial') {
    return {
      maxWordsPerChapter: TRIAL_LIMITS.maxWordsPerChapter,
      maxChapters: TRIAL_LIMITS.maxChapters,
      dailyUsesPerFeature: TRIAL_LIMITS.dailyUsesPerFeature,
    };
  }
  return null;
}

/** True if tier has a finite word/chapter length cap (Free + Trial; Pro no) */
export function tierHasWordCap(tier: string): boolean {
  return tier === 'free' || tier === 'trial';
}

/** Max words per chapter for a metered tier (0/null = unlimited) */
export function maxWordsForTier(tier: string): number {
  if (tier === 'free') return FREE_LIMITS.maxWordsPerChapter;
  if (tier === 'trial') return TRIAL_LIMITS.maxWordsPerChapter;
  return Number.POSITIVE_INFINITY;
}

/**
 * Content hard-stop for write/continue = selected (clamped) goal + 20%.
 * Matches wordBand ceiling so Free/Trial don't toast at exact 600/3000 while
 * Quality Gate still asks for more within the +20% band.
 */
export const TIER_WORD_HEADROOM_RATIO = 1.2;

/** Ceiling words allowed on disk for a metered tier (goal×1.2 of tier max). */
export function contentWordCeilingForTier(tier: string): number {
  const max = maxWordsForTier(tier);
  if (!Number.isFinite(max)) return Number.POSITIVE_INFINITY;
  return Math.round(max * TIER_WORD_HEADROOM_RATIO);
}

/**
 * Effective Setup word goal for Quality Gate / write UI — always clamp Free/Trial
 * so badge never demands 4250 while Free caps at 600.
 * Authority = user's so_tu_chuong (not a fixed constant).
 */
export function effectiveSetupWordGoal(
  so_tu_chuong: unknown,
  flags: { is_pro?: boolean; is_trial?: boolean; is_vip?: boolean },
): number {
  const tier = resolveMeteredTierFromFlags(flags);
  return normalizeSetupScaleForTier(1, so_tu_chuong, tier).so_tu_chuong;
}

/**
 * Full write plan before gen kịch bản:
 * - goal = so_tu user đã set (clamp gói)
 * - min/max = band 0.92 / 1.20 of goal
 * Dùng preflight + continue + quality — cấm hardcode 4250.
 */
export type WriteWordPlan = {
  tier: 'free' | 'trial' | 'pro';
  /** User Setup so_tu_chuong after tier clamp */
  goal: number;
  min: number;
  max: number;
  source: string;
};

export function resolveWriteWordPlan(
  so_tu_chuong: unknown,
  flags: { is_pro?: boolean; is_trial?: boolean; is_vip?: boolean },
): WriteWordPlan {
  const tier = resolveMeteredTierFromFlags(flags);
  const goal = normalizeSetupScaleForTier(1, so_tu_chuong, tier).so_tu_chuong;
  // Inline band math — avoid importing pipeline into commercial (cycle risk)
  const min = Math.round(goal * 0.92);
  const max = Math.round(goal * 1.2);
  return {
    tier,
    goal,
    min,
    max,
    source: `setup.so_tu_chuong=${goal}·tier=${tier}`,
  };
}

/**
 * Free matrix features that share the same daily budget shape.
 * Matches Free group in PRICING_PLANS / FEATURE_MATRIX (minTier free).
 * Trial meters the same buckets (higher daily limit).
 */
export type FreeQuotaBucket =
  | 'write_chapter'
  | 'outline_ideas'
  | 'gen_prompt'
  | 'gen_image'
  | 'tts_edge'
  | 'portable_export';

export const FREE_QUOTA_BUCKETS: FreeQuotaBucket[] = [
  'write_chapter',
  'outline_ideas',
  'gen_prompt',
  'gen_image',
  'tts_edge',
  'portable_export',
];

export const FREE_BUCKET_LABELS: Record<FreeQuotaBucket, string> = {
  write_chapter: 'Viết / sửa kịch bản',
  outline_ideas: 'Outline / Ideas / Setup AI',
  gen_prompt: 'Gen Prompt Studio',
  gen_image: 'Gen ảnh',
  tts_edge: 'TTS Edge / Piper',
  portable_export: 'Project portable export',
};

/** Feature matrix id → daily quota bucket (Free + Trial) */
export function featureIdToFreeBucket(
  featureId: CommercialFeatureId,
): FreeQuotaBucket | null {
  switch (featureId) {
    case 'write_chapter':
      return 'write_chapter';
    case 'outline_ideas':
      return 'outline_ideas';
    case 'gen_prompt':
      return 'gen_prompt';
    case 'gen_image':
      return 'gen_image';
    case 'tts_edge':
      return 'tts_edge';
    case 'portable_export':
      return 'portable_export';
    default:
      return null;
  }
}

/**
 * Map /api/generate requestType → Free/Trial daily bucket.
 * Returns null if the request is not metered.
 */
export function generateRequestToFreeBucket(
  requestType: string,
): FreeQuotaBucket | null {
  switch (requestType) {
    case 'WRITE_CHAPTER':
    case 'REVISE_CHAPTER':
    case 'EVALUATE_CHAPTER':
    case 'COMMIT_MEMORY':
    case 'EXPAND_SCENE':
    case 'REWRITE_SCENE':
      return 'write_chapter';
    case 'GENERATE_IDEAS':
    case 'GENERATE_IDEA':
    case 'ANALYZE_YOUTUBE_PLOT':
    case 'GENERATE_OUTLINE':
    case 'GENERATE_CHAPTER_OUTLINE':
    case 'PLAN_ARC':
    case 'IMPORT_FOUNDATION':
    case 'SUMMARIZE_SCRIPT_OUTLINE':
    case 'COMPRESS_CONTEXT':
      return 'outline_ideas';
    case 'GENERATE_IMAGE_PROMPT':
    case 'REGENERATE_PROMPT':
    case 'EXTRACT_CHARACTERS':
    case 'GENERATE_CHARACTER_PROMPT':
    case 'GENERATE_CHARACTER_PROMPT_ONLY':
    case 'ANALYZE_VISUAL_DNA':
      return 'gen_prompt';
    default:
      return null;
  }
}

/** Clamp word goal for Free only */
export function clampFreeWordGoal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FREE_LIMITS.maxWordsPerChapter;
  return Math.min(FREE_LIMITS.maxWordsPerChapter, Math.max(1, Math.floor(n)));
}

/** Clamp word goal for Trial (≤3000) */
export function clampTrialWordGoal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return TRIAL_LIMITS.maxWordsPerChapter;
  return Math.min(TRIAL_LIMITS.maxWordsPerChapter, Math.max(1, Math.floor(n)));
}

/** Clamp planned chapter count for Free */
export function clampFreeChapterCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(FREE_LIMITS.maxChapters, Math.max(1, Math.floor(n)));
}

/** Clamp chapter count for Trial (max 10) */
export function clampTrialChapterCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(TRIAL_LIMITS.maxChapters, Math.max(1, Math.floor(n)));
}

/**
 * Normalize Setup scale for outline/write — Free/Trial must NOT be forced to 4250/10.
 * Bug class: so_tu < 500 was rewritten to 4250 (broke Free min 100 · max 600).
 */
export function normalizeSetupScaleForTier(
  so_chuong: unknown,
  so_tu_chuong: unknown,
  tier: 'free' | 'trial' | 'pro' | string,
): { so_chuong: number; so_tu_chuong: number } {
  const t = String(tier || 'free').toLowerCase();
  if (t === 'free') {
    return {
      so_chuong: clampFreeChapterCount(so_chuong),
      so_tu_chuong: clampFreeWordGoal(so_tu_chuong),
    };
  }
  if (t === 'trial') {
    return {
      so_chuong: clampTrialChapterCount(so_chuong),
      so_tu_chuong: clampTrialWordGoal(so_tu_chuong),
    };
  }
  const ch = Number(so_chuong);
  const words = Number(so_tu_chuong);
  return {
    so_chuong:
      Number.isFinite(ch) && ch >= 1 ? Math.min(500, Math.round(ch)) : 10,
    so_tu_chuong:
      Number.isFinite(words) && words >= 100
        ? Math.min(50_000, Math.round(words))
        : 4250,
  };
}

/** Resolve commercial tier from store-like flags (client). */
export function resolveMeteredTierFromFlags(flags: {
  is_pro?: boolean;
  is_trial?: boolean;
  is_vip?: boolean;
}): 'free' | 'trial' | 'pro' {
  if (flags.is_trial) return 'trial';
  if (flags.is_pro || flags.is_vip) return 'pro';
  return 'free';
}

/** True if chapter number is outside Free cap (1..maxChapters) */
export function isFreeChapterOutOfRange(chapterNum: unknown): boolean {
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) return true;
  return n > FREE_LIMITS.maxChapters;
}

export function isTrialChapterOutOfRange(chapterNum: unknown): boolean {
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) return true;
  return n > TRIAL_LIMITS.maxChapters;
}

/**
 * Current chapter index from WRITE_CHAPTER-like payload.
 *
 * Client sends:
 * - `chuong_hien_tai`: full chapter object `{ so_chuong, tieu_de, … }` (primary)
 * - or a bare number / string chapter index
 * - `so_chuong` at top level = **planned total** from Setup (NOT current index)
 *
 * Must NOT `Number(chuong_hien_tai)` when it is an object — that is NaN and
 * falsely trips Trial/Free max-chapters (bug: gen chapter 1 → "tối đa 10 chương").
 */
export function resolveWriteChapterNum(
  payload: Record<string, unknown> | null | undefined,
): number {
  const p = payload || {};
  const cur = p.chuong_hien_tai;
  if (cur != null && typeof cur === 'object' && !Array.isArray(cur)) {
    const n = Number((cur as { so_chuong?: unknown }).so_chuong);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  if (typeof cur === 'number' || typeof cur === 'string') {
    const n = Number(cur);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  for (const key of ['chapterNum', 'chapter', 'current_chapter'] as const) {
    const n = Number(p[key]);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  // Do not fall back to top-level so_chuong — that field is total planned chapters.
  return 1;
}

/** Simple word count (VN/EN space-separated + CJK runs) — matches engine spirit */
export function countContentWords(text: string): number {
  const s = String(text || '').trim();
  if (!s) return 0;
  const cjk = s.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const rest = s
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim();
  const latin = rest ? rest.split(/\s+/).filter(Boolean).length : 0;
  return latin + cjkCount;
}

export function freeQuotaExhaustedMessage(
  bucket: FreeQuotaBucket,
  used: number,
  limit: number,
  tier: 'free' | 'trial' = 'free',
): string {
  const label = FREE_BUCKET_LABELS[bucket] || bucket;
  if (tier === 'trial') {
    return (
      `Gói Trial: «${label}» đã dùng ${used}/${limit} lượt hôm nay. ` +
      `Pro không giới hạn lượt. Nhấp logo → Bản quyền.`
    );
  }
  return (
    `Gói Free: «${label}» đã dùng ${used}/${limit} lượt hôm nay. ` +
    `Mở Trial (${TRIAL_LIMITS.days} ngày) hoặc Pro. Nhấp logo → Bản quyền.`
  );
}

export function freeWordCapMessage(): string {
  const goal = FREE_LIMITS.maxWordsPerChapter;
  return (
    `Gói Free: cổng từ toàn chương tối đa ~${goal} từ (Setup số từ/chương). ` +
    `Nâng Trial (≤${TRIAL_LIMITS.maxWordsPerChapter} từ) hoặc Pro. Nhấp logo → Bản quyền.`
  );
}

export function trialWordCapMessage(): string {
  const goal = TRIAL_LIMITS.maxWordsPerChapter;
  return (
    `Gói Trial: cổng từ toàn chương tối đa ~${goal} từ (Setup số từ/chương). ` +
    `Nâng Pro để không giới hạn. Nhấp logo → Bản quyền.`
  );
}

export function freeChapterCapMessage(): string {
  return (
    `Gói Free: tối đa ${FREE_LIMITS.maxChapters} chương / dự án. ` +
    `Nâng Trial (≤${TRIAL_LIMITS.maxChapters} chương) hoặc Pro. Nhấp logo → Bản quyền.`
  );
}

export function trialChapterCapMessage(): string {
  return (
    `Gói Trial: tối đa ${TRIAL_LIMITS.maxChapters} chương / dự án. ` +
    `Nâng Pro để không giới hạn. Nhấp logo → Bản quyền.`
  );
}

/** Default trial length for UI when status not loaded */
export function defaultTrialDays(): number {
  const n = Number(process.env.AINOVEL_TRIAL_DAYS || TRIAL_LIMITS.days);
  if (!Number.isFinite(n) || n <= 0) return TRIAL_LIMITS.days;
  return Math.min(30, Math.floor(n));
}
