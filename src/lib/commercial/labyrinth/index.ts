/**
 * Labyrinth public surface — multi-layer tamper cascade + decoys + bypass probes.
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
export {
  isMirageModeEnabled,
  shouldServeMirage,
  buildMirageSuccessBody,
  recordMirageServed,
  type MirageFeatureHint,
} from './mirage';
export {
  runWrongFeaturePath,
  listWrongPathHandlers,
  toMirageExtras,
  type WrongPathRunResult,
} from './wrongPath';
export {
  setLabyrinthClientShadow,
  isLabyrinthClientShadow,
  getLabyrinthClientShadowReason,
  executeClientWrongPremium,
} from './clientShadow';
export {
  evaluateBypassProbes,
  getBypassProbePublicStatus,
  bypassFindingsAsReasons,
  type BypassProbeReport,
  type BypassProbeFinding,
} from './bypassProbe';
export {
  evaluateClientBypassProbes,
  applyClientBypassProbes,
  type ClientBypassFinding,
} from './clientBypassProbe';
