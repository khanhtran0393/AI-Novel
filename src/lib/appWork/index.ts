/**
 * App work layer — GUI display-only.
 * Network waits: Electron utilityProcess / Web Worker (offThreadHost).
 * @see runner.ts · offThreadHost.ts
 */

export type {
  AppWorkKind,
  AppWorkStatus,
  AppWorkSnapshot,
  AppWorkListener,
  AppWorkControl,
  ScheduleAppWorkOptions,
} from './types';

export {
  scheduleAppWork,
  fireAppWork,
  runGuiSafePool,
  subscribeAppWork,
  getAppWorks,
  getAppWork,
  getActiveAppWorks,
  cancelAppWork,
  isAppWorkCancelled,
  yieldToUi,
} from './runner';

export {
  offThreadFetch,
  offThreadHttpBatch,
  isOffThreadElectronReady,
  resolveAbsoluteApiUrl,
  parseOffThreadJson,
} from './offThreadHost';

export { offThreadFetchResponse } from './offThreadFetchCompat';
