/**
 * Labyrinth public surface — multi-layer tamper cascade + decoys.
 * Not a license issue path. See docs/LABYRINTH.md.
 */

export * from './types';
export {
  recordTamperSignal,
  getRecentTamperSignals,
  clearTamperSignalsForTests,
  getLabyrinthPublicStatus,
  bumpSession,
  getOrCreateSession,
  sessionHasTamper,
} from './signals';
export {
  CASCADE_ROOT,
  CASCADE_LAYER_MESSAGES,
  isStickyCascadeContext,
  originToLayer,
  isTamperOrigin,
  classifyAntiTamperReasons,
  resolveCascadeLayer,
  denyThroughCascade,
  sessionKeyFromRequest,
  originFromErrorMessage,
} from './cascade';
export {
  touchDecoySurface,
  unlockProLocal,
  applyLicenseDatFile,
  deriveModuleKeyFromToken,
  forceOpenEntitlementMode,
  detectDecoyCrackEnv,
  DECOY_CRACK_ENV_NAMES,
} from './decoyUnlock';
