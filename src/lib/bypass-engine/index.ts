export {
  BYPASS_FILTER_CATALOG,
  GRID_LAYOUT_OPTIONS,
  BYPASS_DEFAULTS,
  VARIANCE_RECOMMENDED,
  resolveActiveFilters,
  normalizeGridLayout,
  normalizeVariance,
  resolveBypassParams,
  buildBypassGraph,
  buildVideoFragmentsForCell,
  buildPostGridPhantomChain,
  buildGridCells,
  buildCellVideoCore,
  buildGridVideoFilterParts,
  buildAudioMaskComplexParts,
  turboWorkSize,
  joinVideoChain,
  scaleFlagsForMode,
  OVERLAY_FILTER,
  type BypassFilterId,
  type BypassProbeMeta,
  type BypassGraphBuild,
  type GridLayoutMode,
  type BypassParams,
  type BypassVarianceOpts,
  type VideoFragmentOpts,
} from './filters';

export {
  buildBypassEngineCommand,
  probeBypassInput,
  resolveProjectSaveRoot,
  resolveBypassOutputDir,
  buildBypassOutputPath,
  type BypassEngineRequest,
  type BypassEngineBuilt,
} from './buildCommand';

export {
  PHANTOM_PRESETS,
  getPhantomPreset,
  recommendPcForSelection,
  type PhantomPresetId,
  type PhantomPreset,
  type PhantomPcRecommendation,
} from './presets';

export {
  probeH264Nvenc,
  clearNvencProbeCache,
  resolveFfmpegForEncode,
  type NvencProbeResult,
} from '@/lib/ffmpeg/nvencProbe';

export { buildH264NvencArgs } from '@/lib/ffmpeg/nvencEncoderArgs';
export { listFfmpegCandidates, getPrimaryFfmpegPath } from '@/lib/ffmpeg/ffmpegPaths';
