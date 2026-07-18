/**
 * Single source of truth for chapter word band = Setup so_tu_chuong.
 * Aligns Quality Gate + engine rules (no dual 3000–6000 vs 4250×0.92 fight).
 */
import { DEFAULT_WORD_GOAL } from '@/lib/storyWriting';

export type WordBand = {
  goal: number;
  /** Hard floor — same as evaluateWordGate wordMin (92%) */
  min: number;
  /** Soft ceiling for rules warning/error band */
  max: number;
  source: string;
};

/** Setup goal → unified min/max used by Quality Gate + rules checker */
export function wordBandFromSetupGoal(wordGoal?: number): WordBand {
  const goal =
    typeof wordGoal === 'number' && Number.isFinite(wordGoal) && wordGoal > 0
      ? Math.round(wordGoal)
      : DEFAULT_WORD_GOAL;
  return {
    goal,
    min: Math.round(goal * 0.92),
    max: Math.round(goal * 1.25),
    source: `setup.so_tu_chuong=${goal}`,
  };
}
