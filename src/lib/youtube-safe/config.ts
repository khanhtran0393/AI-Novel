export const DEFAULT_FORBIDDEN_WORDS =
  'đáng chú ý là, nhìn chung, có thể nói rằng, không thể phủ nhận, trong bối cảnh hiện nay, nói một cách dễ hiểu, tóm lại là, nói tóm lại';

export const DEFAULT_FATIGUE_WORDS =
  'không khỏi, dường như, bất chợt, bỗng nhiên, ánh mắt sâu thẳm, trái tim thắt lại, không khí như đông đặc, trong tích tắc, lướt qua tâm trí, một cảm giác khó tả, ánh lên quyết tâm, nuốt nước bọt, siết chặt nắm đấm';

export const HIGH_RISK_TTS_PLATFORMS = new Set(['tiktok_tts', 'edge_tts']);

export const SHOT_SCALE_CYCLE = [
  'wide establishing shot, full environment, subject small in frame',
  'medium shot, waist-up character, layered depth',
  'close-up face or hands, shallow depth of field, emotional detail',
  'extreme insert detail of object/prop/surface texture',
  'over-the-shoulder or dutch tension angle',
] as const;

export type EditorVerdict = 'accept' | 'rewrite' | 'polish' | string | undefined;

export interface YoutubeSafeConfig {
  enforceEditorGate: boolean;
  applyLoudnorm: boolean;
  humanizeScript: boolean;
  lockSeriesVoice: boolean;
  /** Require author checkbox "đã sửa tay" before TTS */
  requireHumanEdit: boolean;
  /** Insert breath pauses in script before TTS */
  injectBreathPauses: boolean;
  /** Pink-noise room tone under voice */
  roomTone: boolean;
  /** Mix optional BGM bed (needs bgmPath or auto low bed) */
  bgmMix: boolean;
  bgmPath: string;
  /** Offset pitch slightly from scene emotion */
  emotionTts: boolean;
  /** Auto AUDIO_READABILITY pass after polish/rewrite */
  autoAudioReadability: boolean;
  /** Enforce shot scale cycle on image prompts */
  enforceShotGraph: boolean;
  /** Block reusing same image file path across slots */
  enforceAntiReuse: boolean;
  /** Target % of beats that should be video (warn only) */
  motionBudgetPct: number;
}

export const DEFAULT_YOUTUBE_SAFE: YoutubeSafeConfig = {
  enforceEditorGate: true,
  applyLoudnorm: true,
  humanizeScript: true,
  lockSeriesVoice: true,
  requireHumanEdit: true,
  injectBreathPauses: true,
  roomTone: true,
  bgmMix: false,
  bgmPath: '',
  emotionTts: true,
  autoAudioReadability: true,
  enforceShotGraph: true,
  enforceAntiReuse: true,
  motionBudgetPct: 25,
};

export function mergeYoutubeSafe(
  partial?: Partial<YoutubeSafeConfig> | null,
): YoutubeSafeConfig {
  return { ...DEFAULT_YOUTUBE_SAFE, ...(partial || {}) };
}

export function resolveUserRules(userRules?: {
  forbidden_words?: string;
  fatigue_words?: string;
}): { forbidden_words: string; fatigue_words: string } {
  return {
    forbidden_words: (userRules?.forbidden_words || '').trim() || DEFAULT_FORBIDDEN_WORDS,
    fatigue_words: (userRules?.fatigue_words || '').trim() || DEFAULT_FATIGUE_WORDS,
  };
}
