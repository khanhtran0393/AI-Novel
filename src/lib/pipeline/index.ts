/**
 * Pipeline packages P0–P2 public API.
 */

export * from './types';
export {
  evaluateChapterQuality,
  assertChapterMediaReady,
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
export { wordBandFromSetupGoal, type WordBand } from './wordBand';
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
