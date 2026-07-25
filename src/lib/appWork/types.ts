/**
 * App work — GUI is display-only; heavy/batch jobs run on detached flows.
 */

export type AppWorkKind =
  | 'tts'
  | 'image'
  | 'video'
  | 'prompt'
  | 'write'
  | 'outline'
  | 'character'
  | 'export'
  | 'other';

export type AppWorkStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export type AppWorkSnapshot = {
  id: string;
  kind: AppWorkKind;
  title: string;
  status: AppWorkStatus;
  /** 0–100 */
  progress: number;
  /** Short status for UI chrome */
  message: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** Optional correlation for support */
  correlationId?: string;
  meta?: Record<string, unknown>;
};

export type AppWorkListener = (works: AppWorkSnapshot[]) => void;

export type ScheduleAppWorkOptions<T> = {
  id?: string;
  kind: AppWorkKind;
  title: string;
  /** When true (default), mute zustand stringify/IPC for whole run */
  mutePersist?: boolean;
  /** Yield paint before first heavy step (default true) */
  yieldBeforeStart?: boolean;
  correlationId?: string;
  meta?: Record<string, unknown>;
  /** Actual work — never call heavy sync from React onClick */
  run: (ctl: AppWorkControl) => Promise<T>;
  onDone?: (result: T) => void;
  onError?: (err: Error) => void;
};

export type AppWorkControl = {
  id: string;
  /** Update progress/message (throttled to UI listeners) */
  setProgress: (progress: number, message?: string) => void;
  setMessage: (message: string) => void;
  /** Cooperative cancel flag */
  isCancelled: () => boolean;
  /** Yield so Electron/React can paint */
  yieldUi: () => Promise<void>;
};
