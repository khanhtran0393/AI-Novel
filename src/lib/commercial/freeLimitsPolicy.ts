/**
 * Free-tier product limits (client + server safe — no fs).
 * Server authority for daily counters: freeQuota.ts (file vault by HWID+day).
 *
 * Scope: Free only. Trial/Pro unlimited within their feature matrix.
 * Pro daily metering remains out-of-scope (LICENSE_ONE_PATH).
 */

import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';

/** Hard product caps for Free tier */
export const FREE_LIMITS = {
  /** Max target + content words per chapter */
  maxWordsPerChapter: 600,
  /** Max chapters in a Free project */
  maxChapters: 2,
  /** Max successful uses per Free feature bucket per calendar day (local HWID) */
  dailyUsesPerFeature: 3,
} as const;

/**
 * Free matrix features that share the same daily budget shape (3/day each).
 * Matches Free group in PRICING_PLANS / FEATURE_MATRIX (minTier free).
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

/** Feature matrix id → daily quota bucket (Free only) */
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
 * Map /api/generate requestType → Free daily bucket.
 * Returns null if the request is not Free-metered (or paid-only elsewhere).
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

/** Clamp word goal for Free (and normalize invalid) */
export function clampFreeWordGoal(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FREE_LIMITS.maxWordsPerChapter;
  return Math.min(FREE_LIMITS.maxWordsPerChapter, Math.max(1, Math.floor(n)));
}

/** Clamp planned chapter count for Free setup */
export function clampFreeChapterCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(FREE_LIMITS.maxChapters, Math.max(1, Math.floor(n)));
}

/** True if chapter number is outside Free cap (1..maxChapters) */
export function isFreeChapterOutOfRange(chapterNum: unknown): boolean {
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) return true;
  return n > FREE_LIMITS.maxChapters;
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
): string {
  const label = FREE_BUCKET_LABELS[bucket] || bucket;
  return (
    `Gói Free: «${label}» đã dùng ${used}/${limit} lượt hôm nay. ` +
    `Mở Trial (3 ngày) hoặc Pro để không giới hạn. Nhấp logo → Bản quyền.`
  );
}

export function freeWordCapMessage(): string {
  return (
    `Gói Free: mỗi chương tối đa ${FREE_LIMITS.maxWordsPerChapter} từ. ` +
    `Nâng Trial/Pro để viết dài hơn. Nhấp logo → Bản quyền.`
  );
}

export function freeChapterCapMessage(): string {
  return (
    `Gói Free: tối đa ${FREE_LIMITS.maxChapters} chương / dự án. ` +
    `Nâng Trial/Pro để mở thêm. Nhấp logo → Bản quyền.`
  );
}
