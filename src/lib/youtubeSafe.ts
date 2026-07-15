/**
 * YouTube-safe production: gates, humanize, audio/visual studio helpers,
 * export pack (chapters, cut plan, hook).
 */

export { YOUTUBE_PSYCH_55, detectPsychLawInTitle } from './youtubePsych55';
export {
  LEGACY_HOOK_SCENE_INDEX,
  YOUTUBE_HOOK_DEFAULT_DURATION_SEC,
  YOUTUBE_HOOK_SCENE_INDEX,
  YOUTUBE_THUMB_SCENE_INDEX,
  isHookSceneIndex,
  migrateHookAssetKeys,
  scenePromptCode,
} from './youtube-safe/assets';
export {
  DEFAULT_FATIGUE_WORDS,
  DEFAULT_FORBIDDEN_WORDS,
  DEFAULT_YOUTUBE_SAFE,
  HIGH_RISK_TTS_PLATFORMS,
  SHOT_SCALE_CYCLE,
  mergeYoutubeSafe,
  resolveUserRules,
  type EditorVerdict,
  type YoutubeSafeConfig,
} from './youtube-safe/config';
export {
  DEFAULT_HUMAN_JOKE_ASIDES,
  buildHumanJokeAsideBlock,
  countHumanJokeAsides,
  injectHumanJokeAsides,
  isHumanJokeAsideInner,
} from './youtube-safe/humanJokes';
export {
  buildAudioReadabilityBlock,
  buildHumanizeScriptBlock,
  buildNarrativePsychBlock,
  buildSpeechFingerprintBlock,
} from './youtube-safe/humanize';
export {
  applyShotScaleToPrompt,
  buildShotDiversityBlock,
  checkImagePathReuse,
  emotionPitchOffset,
  enforceShotGraphOnPrompts,
  injectBreathPauses,
} from './youtube-safe/mediaRules';
export {
  evaluateYoutubeTtsGate,
  type TtsGateInput,
  type TtsGateResult,
} from './youtube-safe/ttsGate';
export { clipAtWordBoundary } from './youtube-safe/text';
export {
  buildCutPlan,
  buildYoutubeChapters,
  cleanYoutubeChapterLabel,
  motionBudgetScore,
} from './youtube-safe/timeline';
export {
  buildYoutubeChecklist,
  summarizeChecklist,
  type YoutubeChecklistItem,
} from './youtube-safe/checklist';
// Explicit named re-exports (Node 24 native type-strip breaks bare `export *` for some importers)
export {
  YOUTUBE_META_PASS_SCORE,
  buildClickThumbnailLine,
  buildSeoDescription,
  buildSeoTags,
  buildSeoTitleFromHook,
  blendThumbPromptWithCompetitorDna,
  buildThumbnailPrompt,
  COMPETITOR_THUMB_DNA_MARKER,
  extractHookFromScript,
  generateYoutubeMetaWithQA,
  normalizeHashtagField,
  pickBestSeoTitle,
  sanitizeSeoTitle,
  sanitizeThumbnailLine,
  scoreNarrativePsychScript,
  scorePsychologicalPull,
  scoreSeoDescription,
  scoreSeoTitle,
  scoreThumbnailLine,
  scoreYoutubeMetaFields,
  stripCompetitorThumbDna,
  toHashtag,
  type YoutubeFieldScores,
} from './youtube-safe/seoMeta';
export * from './youtube-safe/seoMeta';
export type { YoutubeExportPack } from './youtube-safe/exportPack';
