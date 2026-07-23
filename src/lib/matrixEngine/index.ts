/**
 * Dynamic Matrix Engine — 30×30 compositional genre material + retention helpers.
 */

export {
  MATRIX_THEMES,
  MATRIX_STYLES,
  MATRIX_THEME_COUNT,
  MATRIX_STYLE_COUNT,
  MATRIX_COMBO_COUNT,
  nfcLabel,
  normKey,
  type CatalogItem,
} from './catalog';

export type {
  TopicVector,
  StyleVector,
  MatrixComposition,
  MatrixLayerFlags,
} from './types';

export { resolveTopicVector, listTopicCatalogNames } from './topicVectors';
export { resolveStyleVector, listStyleCatalogNames } from './styleVectors';
export {
  composeMatrix,
  composeMatrixFromPayload,
  type ComposeMatrixInput,
} from './compose';

export {
  buildMatrixWriteBlock,
  buildMatrixOutlineBlock,
  buildMatrixShotBlock,
  buildMatrixTtsHintBlock,
  matrixScoreMotifs,
  matrixThumbOverlaySuggestions,
} from './promptBlocks';

export {
  buildWaveRhythmBlock,
  buildCliffhangerBlock,
  buildEndScreenPromptHint,
  retentionModeLabel,
} from './retention';
