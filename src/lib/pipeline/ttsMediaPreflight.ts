/**
 * P1 — TTS stage preflight (hard-fail platform/voice/scene; quality soft-warn).
 */
import { evaluateMediaPreflight, assertMediaPreflight } from './mediaPreflight';
import { ensureChapterQuality } from './ensureQuality';
import { getChapterQuality } from './pipelineStore';
import type { MediaPreflightResult } from './types';

export type TtsMediaPreflightInput = {
  chapter: number;
  sceneIndex?: number;
  sceneText: string;
  platform?: string;
  voice?: string;
  chu_de?: string;
  phong_cach?: string;
  chapterContent?: string;
  characterNames?: string[];
  wordGoal?: number;
  userRules?: { forbidden_words?: string; fatigue_words?: string };
  editorVerdict?: string;
  /** Block when quality not mediaReady (default false — warn only) */
  hardQuality?: boolean;
};

/**
 * Run media preflight for TTS + ensure quality snapshot.
 * Throws on block (platform / voice / empty scene).
 */
export function assertTtsMediaPreflight(
  input: TtsMediaPreflightInput,
): MediaPreflightResult {
  ensureChapterQuality({
    chapter: input.chapter,
    content: input.chapterContent,
    characterNames: input.characterNames,
    wordGoal: input.wordGoal,
    userRules: input.userRules,
    editorVerdict: input.editorVerdict,
  });

  const pf = evaluateMediaPreflight({
    stage: 'tts',
    chapter: input.chapter,
    sceneIndex: input.sceneIndex,
    sceneText: input.sceneText,
    ttsPlatform: input.platform,
    ttsVoice: input.voice,
    chu_de: input.chu_de,
    phong_cach: input.phong_cach,
    requireQualityGate: input.hardQuality === true,
  });

  // Soft quality warn when not hard-blocking
  if (input.hardQuality !== true) {
    const q = getChapterQuality(input.chapter);
    if (q && !q.mediaReady) {
      pf.issues.push({
        level: 'warn',
        code: 'quality_soft',
        message: `Quality Gate ch${input.chapter} chưa media-ready (${q.hardErrors} lỗi) — TTS vẫn chạy; Gen Prompt/Ảnh/Video sẽ chặn.`,
      });
    } else if (!q) {
      pf.issues.push({
        level: 'info',
        code: 'quality_none',
        message: `Chưa có Quality Gate ch${input.chapter} — đã lazy-scan nếu có nội dung.`,
      });
    }
  }

  assertMediaPreflight(pf);
  return pf;
}
