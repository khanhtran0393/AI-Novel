/** Flow-bridge public barrel — each symbol re-exported exactly once. */
export {
  ensureBridgeStarted,
  getBridgeSnapshot,
  getBridgeSnapshotAsync,
  isBridgeRunning,
  isAdoptedExternalBridge,
  runGenerateOne,
  enqueueGenerateOne,
  getQueueTask,
  findQueueTaskByCoords,
  requestViaExtension,
  commandExtension,
  getProjectId,
  setProjectId,
  setActiveAccountId,
  createFlowProject,
  syncAccountIdentity,
  inheritAccountSession,
  scheduleInheritAccountSession,
  setAccountFlowKey,
  getAccountFlowKey,
  openProjectInBrowser,
  applyAccountIdentity,
  getQueue,
  getLiveAccounts,
  purgeDeletedAccountRuntime,
  beginFreshProfileLogin,
} from './bridgeServer';
export {
  writeSessionBundle,
  loadSessionBundle,
  profileHasBrowserSession,
} from './sessionInherit';
export type { SessionBundle } from './sessionInherit';
export {
  proxyAsAccount,
  downloadAsAccount,
  refreshAccountAfterTask,
} from './accountProxy';
export type { ProxyAsAccountOpts, ProxyAsAccountResult } from './accountProxy';
export {
  loadProjects,
  upsertProject,
  getActiveProjectId,
  setActiveProjectId,
} from './projectStore';
export type { FlowProject } from './projectStore';
export { FLOW_WS_PORT, FLOW_HTTP_PORT, FLOW_DEFAULTS } from './config';
export {
  normalizeProxyServer,
  resolveAccountProxyServer,
} from './resolveAccountProxy';
export {
  classifyFlowError,
  describeFlowError,
  formatFlowTaskError,
  isPermanentFlowFailure,
} from './flowRuntimeErrors';
export type { FlowErrorDetail } from './flowRuntimeErrors';
export {
  markAccountBusy,
  markAccountFree,
  isAccountBusy,
  scheduleFlowRuntimeRecycle,
} from './flowRuntimeRecycle';
export { applyFlowTaskStep, flowStepLabel } from './flowRuntimeSteps';
export {
  FLOW_IMAGE_MODELS,
  FLOW_VIDEO_MODELS,
  FLOW_QUALITY_PRESETS,
  FLOW_VIDEO_DURATIONS_SEC,
  FLOW_DEFAULT_VIDEO_DURATION_SEC,
  FLOW_VIDEO_ASPECT_RATIOS,
  FLOW_CATALOG_META,
  estimateTaskCredits,
  findFlowModel,
  clampFlowVideoDuration,
  getModelDurations,
  resolveFlowImageModelName,
  resolvePortraitModel,
  resolveFirstLastModel,
  listFlowVideoModelsForUi,
  listFlowImageModelsForUi,
  flowModelUserHint,
  flowVideoFamilyBadge,
  flowVideoFamilyBadgeVi,
  flowModelGooglePackage,
  formatFlowCreditsPart,
  formatFlowModelDropdownLabel,
  flowVideoModelRequirements,
  formatFlowVideoModelPickToast,
} from './modelCatalog';
export type { FlowVideoModelRequirement } from './modelCatalog';
export {
  FLOW_SCENE_PIPELINE_PRESETS,
  resolveFlowVideoModelForScene,
  assertFlowVideoModelForScene,
  recommendFlowSceneModels,
} from './flowSceneMode';
export type {
  FlowScenePipelinePreset,
  FlowSceneVideoContext,
  FlowSceneModeResult,
} from './flowSceneMode';
export { loadFlowOps, saveFlowOps, applyAgentInstructions } from './opsStore';
export { applyCameraToPrompt, cameraFromScaleIndex } from './cameraPrompt';
export type { CameraShot } from './cameraPrompt';
export { runFlowAgentPlan } from './flowAgent';
export {
  resolveCastIngredientPaths,
  resolvePrimaryCastReference,
} from './castIngredients';
export { getFlowMediaId, setFlowMediaId } from './mediaIdIndex';
export { bootstrapFlow, getBrowserCatalog } from './bootstrap';
export type { BootstrapResult } from './bootstrap';
export {
  resolveBrowser,
  listDetectedBrowsers,
  portableChromiumInstallHint,
} from './browserResolver';
export type { FlowBrowserEngine, ResolvedBrowser } from './browserResolver';
export { ensurePortableBrowser } from './ensurePortableBrowser';
export type {
  EnsureBrowserResult,
  EnsureBrowserProgress,
} from './ensurePortableBrowser';
export {
  FACE_LOCK_SYSTEM_PROMPT,
  injectFaceLockPrompt,
  fileToBase64,
} from './promptInjector';
export {
  closeLoginSessionAfterCapture,
  launchChrome,
  getChromeSessionInfo,
  listSessions,
  profileDirForAccount,
  accountRootDir,
  sourceExtensionDir,
  ensureIsolatedAccountProfile,
  ensureAccountExtension,
  getSession,
  isProfileBrowserAlive,
  countChromeForProfile,
  reconcileLoginBrowserClosed,
  killChromeForProfile,
  killChromeByPathNeedles,
  killAllFlowBrowsers,
  registerFlowBrowserShutdownHooks,
  purgeAccountProfile,
  listOrphanProfileDirs,
} from './chromeSession';
export type {
  BridgeSnapshot,
  FlowAccount,
  FlowTask,
  FlowExecutionMode,
} from './types';
