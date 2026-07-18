/**
 * Lazy Quality Gate from existing chapter body (legacy projects without finish re-run).
 */
import { evaluateChapterQuality } from './qualityGate';
import { getChapterQuality, setChapterQuality } from './pipelineStore';
import type { ChapterQualityReport } from './types';

export function ensureChapterQuality(input: {
  chapter: number;
  content?: string;
  characterNames?: string[];
  wordGoal?: number;
  userRules?: { forbidden_words?: string; fatigue_words?: string };
  editorVerdict?: string;
  force?: boolean;
}): ChapterQualityReport | null {
  if (!input.force) {
    const existing = getChapterQuality(input.chapter);
    if (existing) return existing;
  }
  const body = (input.content || '').trim();
  if (!body) return getChapterQuality(input.chapter);
  const report = evaluateChapterQuality({
    chapter: input.chapter,
    content: body,
    characterNames: input.characterNames,
    wordGoal: input.wordGoal,
    userRules: input.userRules,
    editorVerdict: input.editorVerdict,
  });
  setChapterQuality(report);
  return report;
}
