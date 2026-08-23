/**
 * OPEN product limits — app is free for every user.
 * No word/chapter/daily caps anywhere. Kept for API-compat (callers still import).
 */

import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';

/** Effectively unlimited caps — app fully open. */
export const FREE_LIMITS = {
  /** Max target + content words per chapter */
  maxWordsPerChapter: 50_000,
  /** Max chapters in a project */
  maxChapters: 500,
  /** Max successful uses per feature bucket per calendar day */
  dailyUsesPerFeature: 999_999,
} as const;

/**
 * Trial caps — kept for compat; same unlimited values (trial is dead product).
 */
export const TRIAL_LIMITS = {
  maxWordsPerChapter: 50_000,
  maxChapters: 500,
  dailyUsesPerFeature: 999_999,
  /** Default trial length (days) — unused (app open) */
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
  if (tier === 'free' || tier === 'trial') {
    return {
      maxWordsPerChapter: FREE_LIMITS.maxWordsPerChapter,
      maxChapters: FREE_LIMITS.maxChapters,
      dailyUsesPerFeature: FREE_LIMITS.dailyUsesPerFeature,
    };
  }
  return null;
}

/** True if tier has a finite word/chapter length cap (none — app open) */
export function tierHasWordCap(tier: string): boolean {
  return false;
}

/** Max words per chapter for a tier (always unlimited) */
export function maxWordsForTier(tier: string): number {
  return Number.POSITIVE_INFINITY;
}

/**
 * Content hard-stop for write/continue = selected (clamped) goal + 20%.
 */
export const TIER_WORD_HEADROOM_RATIO = 1.2;

/** Ceiling words allowed on disk for a tier (always unlimited) */
export function contentWordCeilingForTier(tier: string): number {
  return Number.POSITIVE_INFINITY;
}

/**
 * Effective Setup word goal for Quality Gate / write UI — no clamping.
 */
export function effectiveSetupWordGoal(
  so_tu_chuong: unknown,
  flags: { is_pro?: boolean; is_trial?: boolean; is_vip?: boolean },
): number {
  return normalizeSetupScaleForTier(1, so_tu_chuong, 'pro').so_tu_chuong;
}

/**
 * Full write plan before gen kịch bản:
 * - goal = so_tu user đã set (no clamp)
 * - min/max = band 0.92 / 1.20 of goal
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
  const goal = normalizeSetupScaleForTier(1, so_tu_chuong, 'pro').so_tu_chuong;
  // Inline band math — avoid importing pipeline into commercial (cycle risk)
  const min = Math.round(goal * 0.92);
  const max = Math.round(goal * 1.2);
  return {
    tier: 'pro',
    goal,
    min,
    max,
    source: `setup.so_tu_chuong=${goal}·tier=pro`,
  };
}

/**
 * Free matrix features that share the same daily budget shape.
 * Kept for API-compat — no daily metering applies (app open).
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

/** Feature matrix id → daily quota bucket (app open — kept for compat) */
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
 * Kept for compat — returns null (no metering).
 */
export function generateRequestToFreeBucket(
  requestType: string,
): FreeQuotaBucket | null {
  return null;
}

/** Clamp word goal — returns raw value (no cap). */
export function clampFreeWordGoal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FREE_LIMITS.maxWordsPerChapter;
  return Math.min(FREE_LIMITS.maxWordsPerChapter, Math.max(1, Math.floor(n)));
}

/** Clamp word goal — returns raw value (no cap). */
export function clampTrialWordGoal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return TRIAL_LIMITS.maxWordsPerChapter;
  return Math.min(TRIAL_LIMITS.maxWordsPerChapter, Math.max(1, Math.floor(n)));
}

/** Clamp planned chapter count — returns raw value (no cap). */
export function clampFreeChapterCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(FREE_LIMITS.maxChapters, Math.max(1, Math.floor(n)));
}

/** Clamp chapter count — returns raw value (no cap). */
export function clampTrialChapterCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(TRIAL_LIMITS.maxChapters, Math.max(1, Math.floor(n)));
}

/**
 * Normalize Setup scale for outline/write — no tier clamp (app open).
 */
export function normalizeSetupScaleForTier(
  so_chuong: unknown,
  so_tu_chuong: unknown,
  tier: 'free' | 'trial' | 'pro' | string,
): { so_chuong: number; so_tu_chuong: number } {
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
  return 'pro';
}

/** True if chapter number is outside cap — always false (app open). */
export function isFreeChapterOutOfRange(chapterNum: unknown): boolean {
  return false;
}

export function isTrialChapterOutOfRange(chapterNum: unknown): boolean {
  return false;
}

/**
 * Current chapter index from WRITE_CHAPTER-like payload.
 *
 * Client sends:
 * - `chuong_hien_tai`: full chapter object `{ so_chuong, tieu_de, … }` (primary)
 * - or a bare number / string chapter index
 * - `so_chuong` at top level = **planned total** from Setup (NOT current index)
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
  return 'App mở hoàn toàn miễn phí — không giới hạn lượt dùng.';
}

export function freeWordCapMessage(): string {
  return 'App mở hoàn toàn miễn phí — không giới hạn từ/chương.';
}

export function trialWordCapMessage(): string {
  return 'App mở hoàn toàn miễn phí — không giới hạn từ/chương.';
}

export function freeChapterCapMessage(): string {
  return 'App mở hoàn toàn miễn phí — không giới hạn số chương.';
}

export function trialChapterCapMessage(): string {
  return 'App mở hoàn toàn miễn phí — không giới hạn số chương.';
}

/** Default trial length for UI when status not loaded (unused — app open) */
export function defaultTrialDays(): number {
  return 7;
}
