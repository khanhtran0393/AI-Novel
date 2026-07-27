/**
 * Pipeline packages P0–P2 public API.
 */

export * from './types';
export {
  evaluateChapterQuality,
  assertChapterMediaReady,
  formatQualityGateReasons,
  formatQualityGateTitle,
  type QualityGateInput,
} from './qualityGate';
export {
  extractForeshadowCandidates,
  mergeForeshadowLedger,
  buildForeshadowPromptBlock,
  buildMemoryPromptBlock,
  enrichMemoryAfterCommit,
  lorebookWithMemoryPack,
} from './memoryAfterCommit';
export {
  setChapterQuality,
  getChapterQuality,
  getAllChapterQuality,
  getForeshadowLedger,
  setForeshadowLedger,
  getMemoryPack,
  getLongformConfig,
  setLongformConfig,
  getArcFlags,
  markArcSummaryDone,
  markArcReviewDone,
  markVolumeSummaryDone,
  openArcEndWindow,
  subscribePipelineStore,
  getPipelineStoreVersion,
  exportPipelineSnapshot,
  importPipelineSnapshot,
  clearPipelineStore,
  type PipelinePortableSnapshot,
} from './pipelineStore';
export {
  wordBandFromSetupGoal,
  wordContentCeiling,
  shouldStopWordGateContinue,
  WORD_FLOOR_RATIO,
  WORD_CEILING_RATIO,
  type WordBand,
} from './wordBand';
export { assertTtsMediaPreflight, type TtsMediaPreflightInput } from './ttsMediaPreflight';
export {
  evaluateMediaPreflight,
  assertMediaPreflight,
  assertReadyForMedia,
  type MediaPreflightInput,
} from './mediaPreflight';
export {
  resolveLongformConfig,
  computeArcBoundary,
  buildLayeredRouteExtras,
  formatArcLabel,
} from './longformArc';
export {
  createStageBatchJob,
  runStageBatch,
  retryStageBatch,
  readStageMeta,
  type StageItemSpec,
  type StageJobMeta,
} from './sceneStageQueue';
export { ensureChapterQuality } from './ensureQuality';
export {
  evaluateVideoReady,
  evaluateSceneMediaReady,
  resolveVideoReadySceneIndices,
  hasMediaPath,
  audioDurationSec,
  videoReadyFingerprint,
  type VideoReadyInput,
  type VideoReadyReport,
  type VideoReadyStation,
  type VideoReadyStationId,
  type StationStatus,
  type SceneMediaReady,
} from './videoReady';
