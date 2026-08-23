/**
 * P1 — TTS stage preflight (hard-fail platform/voice/scene/quality).
 */
import { evaluateMediaPreflight, assertMediaPreflight } from './mediaPreflight';
import { ensureChapterQuality } from './ensureQuality';
import { getChapterQuality } from './pipelineStore';
import { formatQualityGateReasons } from './qualityGate';
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
  scriptMode?: string;
  /** Block when quality is not mediaReady (default true for saved/generated TTS). */
  hardQuality?: boolean;
};

/**
 * Run media preflight for TTS + ensure quality snapshot.
 * Throws on block (platform / voice / empty scene / Quality Gate).
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
    scriptMode: input.scriptMode,
    force: true,
  });

  const hardQuality = input.hardQuality !== false;
  const pf = evaluateMediaPreflight({
    stage: 'tts',
    chapter: input.chapter,
    sceneIndex: input.sceneIndex,
    sceneText: input.sceneText,
    ttsPlatform: input.platform,
    ttsVoice: input.voice,
    chu_de: input.chu_de,
    phong_cach: input.phong_cach,
    requireQualityGate: false,
  });

  const q = getChapterQuality(input.chapter);
  if (hardQuality) {
    if (!q) {
      pf.issues.push({
        level: 'block',
        code: 'quality_missing',
        message: `Chua co Quality Gate ch${input.chapter}. Viet/commit chuong truoc khi Gen TTS.`,
      });
    } else if (!q.mediaReady) {
      const reasons = formatQualityGateReasons(q, {
        maxErrors: 4,
        maxWarnings: 1,
        includeMeta: false,
      });
      pf.issues.push({
        level: 'block',
        code: 'quality_blocked',
        message:
          `Quality Gate chan ch${input.chapter}: ${q.hardErrors} loi - viet tiep/sua truoc khi Gen TTS/Prompt/Anh/Video.\n` +
          (reasons || 'Bam badge Gate de xem nguyen nhan.'),
      });
    }
  } else {
    if (q && !q.mediaReady) {
      pf.issues.push({
        level: 'warn',
        code: 'quality_soft',
        message: `Quality Gate ch${input.chapter} chua media-ready (${q.hardErrors} loi) - dang cho phep TTS tam thoi.`,
      });
    } else if (!q) {
      pf.issues.push({
        level: 'info',
        code: 'quality_none',
        message: `Chua co Quality Gate ch${input.chapter} - da lazy-scan neu co noi dung.`,
      });
    }
  }

  const blocks = pf.issues.filter((i) => i.level === 'block');
  pf.ok = blocks.length === 0;
  pf.summary = pf.ok
    ? `Preflight tts ch${input.chapter}: OK`
    : `Preflight tts ch${input.chapter}: ${blocks.length} block - ${blocks[0]?.message || ''}`;

  assertMediaPreflight(pf);
  return pf;
}
