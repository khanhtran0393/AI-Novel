/**
 * Detached app-work runner.
 *
 * RULE: GUI (React/Electron chrome) is display-only.
 * Any batch or long job MUST go through scheduleAppWork so:
 *  - click handlers only schedule (return immediately)
 *  - work starts after paint (Worker/utilityProcess heartbeat when available)
 *  - HTTP waits use offThreadFetch (Electron utilityProcess / Web Worker)
 *  - store persist stringify/IPC is muted during batch mutations
 *  - progress emits are throttled (no re-render thrash)
 *  - jobs survive remount (module-level registry)
 *
 * True off-GUI network: @/lib/appWork/offThreadHost (utilityProcess + Worker).
 * scheduleAppWork `run` may still touch Zustand on apply-result only — not for HTTP wait.
 */

import {
  beginPersistMute,
  endPersistMute,
  yieldToUi,
} from '@/store/persistStorage';
import type {
  AppWorkControl,
  AppWorkKind,
  AppWorkListener,
  AppWorkSnapshot,
  AppWorkStatus,
  ScheduleAppWorkOptions,
} from './types';

const works = new Map<string, AppWorkSnapshot>();
const cancelFlags = new Map<string, boolean>();
const listeners = new Set<AppWorkListener>();

/** Throttle UI fan-out — rapid progress must not re-render whole workspace. */
const UI_EMIT_MIN_MS = 250;
let lastUiEmitAt = 0;
let uiEmitTimer: ReturnType<typeof setTimeout> | null = null;

function mintId(kind: AppWorkKind): string {
  return `work_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function listWorks(): AppWorkSnapshot[] {
  return [...works.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function notifyListeners(force = false) {
  const now = Date.now();
  const due = force || now - lastUiEmitAt >= UI_EMIT_MIN_MS;
  if (due) {
    if (uiEmitTimer) {
      clearTimeout(uiEmitTimer);
      uiEmitTimer = null;
    }
    lastUiEmitAt = now;
    const snap = listWorks();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (!uiEmitTimer) {
    uiEmitTimer = setTimeout(() => {
      uiEmitTimer = null;
      lastUiEmitAt = Date.now();
      const snap = listWorks();
      for (const fn of listeners) {
        try {
          fn(snap);
        } catch {
          /* ignore */
        }
      }
    }, UI_EMIT_MIN_MS);
  }
}

function patchWork(
  id: string,
  patch: Partial<AppWorkSnapshot>,
  opts?: { force?: boolean },
) {
  const prev = works.get(id);
  if (!prev) return;
  works.set(id, { ...prev, ...patch });
  notifyListeners(opts?.force === true);
}

export function subscribeAppWork(fn: AppWorkListener): () => void {
  listeners.add(fn);
  try {
    fn(listWorks());
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

export function getAppWorks(): AppWorkSnapshot[] {
  return listWorks();
}

export function getAppWork(id: string): AppWorkSnapshot | undefined {
  const w = works.get(id);
  return w ? { ...w } : undefined;
}

export function getActiveAppWorks(): AppWorkSnapshot[] {
  return listWorks().filter((w) => w.status === 'running' || w.status === 'queued');
}

export function cancelAppWork(id: string): void {
  cancelFlags.set(id, true);
  const w = works.get(id);
  if (w && (w.status === 'running' || w.status === 'queued')) {
    patchWork(id, { message: 'Đang dừng…' }, { force: true });
  }
}

export function isAppWorkCancelled(id: string): boolean {
  return cancelFlags.get(id) === true;
}

/**
 * Detach work from the current call stack (UI click / render).
 * Returns the work id immediately; `run` executes on a later turn.
 */
export function scheduleAppWork<T>(
  opts: ScheduleAppWorkOptions<T>,
): { id: string; promise: Promise<T> } {
  const id = opts.id || mintId(opts.kind);
  cancelFlags.set(id, false);

  const snap: AppWorkSnapshot = {
    id,
    kind: opts.kind,
    title: opts.title,
    status: 'queued',
    progress: 0,
    message: 'Đã xếp hàng — chờ luồng nền…',
    startedAt: Date.now(),
    correlationId: opts.correlationId,
    meta: opts.meta,
  };
  works.set(id, snap);
  notifyListeners(true);

  const mutePersist = opts.mutePersist !== false;
  const yieldBefore = opts.yieldBeforeStart !== false;

  const promise = new Promise<T>((resolve, reject) => {
    // Detach from React synthetic event / click stack via off-thread slot
    void enqueueOffGuiStart(async () => {
        if (cancelFlags.get(id)) {
          patchWork(
            id,
            {
              status: 'cancelled',
              message: 'Đã hủy',
              finishedAt: Date.now(),
            },
            { force: true },
          );
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }

        patchWork(
          id,
          {
            status: 'running',
            message: 'Đang chạy ngoài GUI (Worker/utilityProcess)…',
            progress: 1,
          },
          { force: true },
        );

        if (yieldBefore) {
          await yieldToUi();
        }

        if (mutePersist) beginPersistMute();
        try {
          if (cancelFlags.get(id)) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const ctl: AppWorkControl = {
            id,
            setProgress: (progress, message) => {
              const p = Math.max(0, Math.min(100, Math.round(progress)));
              patchWork(id, {
                progress: p,
                ...(message != null ? { message } : {}),
              });
            },
            setMessage: (message) => {
              patchWork(id, { message });
            },
            isCancelled: () => cancelFlags.get(id) === true,
            yieldUi: yieldToUi,
          };

          const result = await opts.run(ctl);

          if (cancelFlags.get(id)) {
            patchWork(
              id,
              {
                status: 'cancelled',
                message: 'Đã dừng',
                finishedAt: Date.now(),
              },
              { force: true },
            );
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }

          patchWork(
            id,
            {
              status: 'done',
              progress: 100,
              message: 'Xong',
              finishedAt: Date.now(),
            },
            { force: true },
          );
          try {
            opts.onDone?.(result);
          } catch {
            /* ignore */
          }
          resolve(result);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          const aborted =
            err.name === 'AbortError' ||
            /abort/i.test(err.message) ||
            cancelFlags.get(id) === true;
          const status: AppWorkStatus = aborted ? 'cancelled' : 'failed';
          patchWork(
            id,
            {
              status,
              message: aborted ? 'Đã dừng' : err.message.slice(0, 200),
              error: aborted ? undefined : err.message,
              finishedAt: Date.now(),
            },
            { force: true },
          );
          try {
            if (!aborted) opts.onError?.(err);
          } catch {
            /* ignore */
          }
          reject(err);
        } finally {
          if (mutePersist) endPersistMute();
          // Prune old finished works (keep last 12)
          const finished = listWorks().filter(
            (w) => w.status === 'done' || w.status === 'failed' || w.status === 'cancelled',
          );
          if (finished.length > 12) {
            for (const w of finished.slice(12)) {
              works.delete(w.id);
              cancelFlags.delete(w.id);
            }
            notifyListeners(true);
          }
        }
    });
  });

  return { id, promise };
}

/**
 * Start work after an off-GUI heartbeat (Worker postMessage).
 * Ensures we leave the React click stack; HTTP inside run should use offThreadFetch.
 */
function enqueueOffGuiStart(fn: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const run = () => {
      void fn().finally(() => resolve());
    };
    if (typeof Worker === 'undefined') {
      setTimeout(run, 0);
      return;
    }
    try {
      const src = `self.onmessage=()=>{self.postMessage('go');};`;
      const blob = new Blob([src], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      w.onmessage = () => {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        // After worker tick — still apply store on main, but click stack is gone
        setTimeout(run, 0);
      };
      w.onerror = () => {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
        setTimeout(run, 0);
      };
      w.postMessage('start');
    } catch {
      setTimeout(run, 0);
    }
  });
}

/**
 * Fire-and-forget schedule — for onClick. Errors go to onError / console.
 * GUI never awaits the heavy body on the click stack.
 */
export function fireAppWork<T>(opts: ScheduleAppWorkOptions<T>): string {
  const { id, promise } = scheduleAppWork(opts);
  void promise.catch((err) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.warn('[appWork]', opts.title, err);
  });
  return id;
}

/**
 * Run a list of items with concurrency + yield between items.
 * Always pair with scheduleAppWork or runWithPersistMuted from caller.
 */
export async function runGuiSafePool<TItem>(params: {
  items: TItem[];
  concurrency?: number;
  isCancelled?: () => boolean;
  worker: (item: TItem, index: number) => Promise<void>;
  onProgress?: (done: number, total: number, item: TItem) => void;
  /** Yield to UI after every N items (default 1) */
  yieldEvery?: number;
}): Promise<{ done: number; cancelled: boolean }> {
  const total = params.items.length;
  const concurrency = Math.max(
    1,
    Math.min(4, Number.isFinite(Number(params.concurrency)) ? Math.trunc(Number(params.concurrency)) : 1),
  );
  const yieldEvery = Math.max(1, Math.trunc(params.yieldEvery || 1));
  let next = 0;
  let done = 0;
  let cancelled = false;

  const runOne = async () => {
    while (true) {
      if (params.isCancelled?.()) {
        cancelled = true;
        return;
      }
      const i = next++;
      if (i >= total) return;
      const item = params.items[i];
      await params.worker(item, i);
      done += 1;
      params.onProgress?.(done, total, item);
      if (done % yieldEvery === 0) {
        await yieldToUi();
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runOne()));
  return { done, cancelled };
}

export { yieldToUi };
