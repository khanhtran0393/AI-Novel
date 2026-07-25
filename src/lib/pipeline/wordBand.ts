/**
 * Single source of truth for chapter word band = Setup so_tu_chuong.
 *
 * Cổng từ = độ dài TOÀN BỘ kịch bản chương (user so_tu_chuong), không phải
 * “cắt giữa chừng khi chạm trần”.
 *
 * Policy:
 * - Goal: full-chapter target = setup.so_tu_chuong (tier-clamped)
 * - Floor: 92% of goal — chapter incomplete below this
 * - Soft max: +20% — quality overshoot band only (không abort narrative)
 */
import { DEFAULT_WORD_GOAL } from '@/lib/storyWriting';

/** Hard floor ratio for word-gate / continue */
export const WORD_FLOOR_RATIO = 0.92;
/** Soft overshoot of full-chapter goal (+20%) — quality only */
export const WORD_CEILING_RATIO = 1.2;

export type WordBand = {
  goal: number;
  /** Hard floor — same as evaluateWordGate wordMin (92%) */
  min: number;
  /** Soft overshoot band (= goal × 1.20) */
  max: number;
  source: string;
};

/**
 * Setup goal → unified min/max for the FULL chapter script.
 * @param wordGoal — user-selected so_tu_chuong (tier-clamped). No silent 4250.
 */
export function wordBandFromSetupGoal(wordGoal?: number): WordBand {
  const goal =
    typeof wordGoal === 'number' && Number.isFinite(wordGoal) && wordGoal > 0
      ? Math.round(wordGoal)
      : DEFAULT_WORD_GOAL;
  return {
    goal,
    min: Math.round(goal * WORD_FLOOR_RATIO),
    max: Math.round(goal * WORD_CEILING_RATIO),
    source: `setup.so_tu_chuong=${goal}·full-chapter`,
  };
}

/** Soft overshoot band for a chosen full-chapter goal */
export function wordContentCeiling(wordGoal: number): number {
  return wordBandFromSetupGoal(wordGoal).max;
}

/**
 * Stop auto-continue when full chapter OK, or hard over max (anti 200%+).
 */
export function shouldStopWordGateContinue(params: {
  wordCount: number;
  sceneCount: number;
  band: WordBand;
  minScenes: number;
}): { stop: boolean; reason: string } {
  const { wordCount, sceneCount, band, minScenes } = params;
  const wordsOk = wordCount >= band.min;
  const scenesOk = sceneCount >= minScenes;
  if (wordCount > band.max) {
    return {
      stop: true,
      reason: `Vượt trần cổng từ ${wordCount}/${band.goal} (max ${band.max} = +20%) — dừng bù.`,
    };
  }
  if (wordCount >= band.goal && scenesOk) {
    return {
      stop: true,
      reason: `Đủ mục tiêu toàn chương: ${wordCount}/${band.goal} từ · ${sceneCount} cảnh.`,
    };
  }
  if (wordsOk && scenesOk) {
    return {
      stop: true,
      reason: `Đủ sàn cổng từ: ${wordCount}/${band.min}–${band.goal} · ${sceneCount} cảnh.`,
    };
  }
  return {
    stop: false,
    reason: !wordsOk
      ? `Chưa đủ toàn chương: ${wordCount}/${band.min} từ (mục tiêu ${band.goal})`
      : `Chưa đủ phân cảnh: ${sceneCount}/${minScenes}`,
  };
}
