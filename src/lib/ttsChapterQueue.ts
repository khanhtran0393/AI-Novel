/**
 * Module-level chapter TTS queue — survives React remounts / tab switches.
 * Optional Electron persistence of snapshot.
 */

export type ChapterQueueJob = {
  sceneIndex: number;
  text: string;
  title: string;
};

/** Browser-safe: parallel scene count by TTS platform (active engines only). */
export function resolveChapterTtsConcurrency(platform: string): number {
  const p = (platform || '').toLowerCase();
  // Omni + Vina share GPU/VRAM (4GB class) — always serial scenes
  if (p === 'vina_voice' || p === 'omnivoice_local' || p === 'la_studio') return 1;
  if (p === 'edge_tts' || p === 'piper') return 3;
  if (p === 'gemini_tts' || p === 'tiktok_tts' || p === 'capcut_tts') return 2;
  return 1;
}

export type ChapterQueueSnapshot = {
  running: boolean;
  cancelled: boolean;
  chapter: number;
  progress: number;
  status: string;
  ok: number;
  fail: number;
  skipped: number;
  total: number;
  currentIndex: number;
  currentTitle: string;
  errors: string[];
  failedIndexes: number[];
  startedAt?: number;
  finishedAt?: number;
  lastResult?: { ok: number; fail: number; skipped: number };
};

type Listener = (s: ChapterQueueSnapshot) => void;

const IDLE: ChapterQueueSnapshot = {
  running: false,
  cancelled: false,
  chapter: 0,
  progress: 0,
  status: '',
  ok: 0,
  fail: 0,
  skipped: 0,
  total: 0,
  currentIndex: 0,
  currentTitle: '',
  errors: [],
  failedIndexes: [],
};

let state: ChapterQueueSnapshot = { ...IDLE };
const listeners = new Set<Listener>();
let runToken = 0;

/** Throttle UI listeners — rapid emit thrashing re-renders entire workspace. */
const UI_EMIT_MIN_MS = 200;
let lastUiEmitAt = 0;
let uiEmitTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUiSnap: ChapterQueueSnapshot | null = null;

/** Debounce disk IPC — writeFileSync on main process freezes Electron chrome. */
const DISK_PERSIST_MS = 1500;
let diskPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDiskSnap: ChapterQueueSnapshot | null = null;

function cloneSnap(): ChapterQueueSnapshot {
  return {
    ...state,
    errors: [...state.errors],
    failedIndexes: [...state.failedIndexes],
  };
}

function notifyListeners(snap: ChapterQueueSnapshot) {
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  }
}

function scheduleDiskPersist(snap: ChapterQueueSnapshot, immediate = false) {
  pendingDiskSnap = snap;
  if (immediate) {
    if (diskPersistTimer) {
      clearTimeout(diskPersistTimer);
      diskPersistTimer = null;
    }
    void persistQueueSnapshot(snap);
    pendingDiskSnap = null;
    return;
  }
  if (diskPersistTimer) return;
  diskPersistTimer = setTimeout(() => {
    diskPersistTimer = null;
    const s = pendingDiskSnap;
    pendingDiskSnap = null;
    if (s) void persistQueueSnapshot(s);
  }, DISK_PERSIST_MS);
}

function emit(opts?: { force?: boolean; flushDisk?: boolean }) {
  const force = opts?.force === true;
  const snap = cloneSnap();
  pendingUiSnap = snap;

  const now = Date.now();
  const due = force || now - lastUiEmitAt >= UI_EMIT_MIN_MS;
  if (due) {
    if (uiEmitTimer) {
      clearTimeout(uiEmitTimer);
      uiEmitTimer = null;
    }
    lastUiEmitAt = now;
    pendingUiSnap = null;
    notifyListeners(snap);
  } else if (!uiEmitTimer) {
    uiEmitTimer = setTimeout(() => {
      uiEmitTimer = null;
      const s = pendingUiSnap || cloneSnap();
      pendingUiSnap = null;
      lastUiEmitAt = Date.now();
      notifyListeners(s);
    }, UI_EMIT_MIN_MS);
  }

  scheduleDiskPersist(snap, opts?.flushDisk === true);
}

async function persistQueueSnapshot(snap: ChapterQueueSnapshot) {
  if (typeof window === 'undefined') return;
  const api = window.ainovelTools;
  if (!api?.setTtsQueue) return;
  try {
    await api.setTtsQueue(snap);
  } catch {
    /* ignore */
  }
}

/**
 * Mark queue busy immediately so the button shows "Đang gen…" before preflight/warm.
 * Call before any heavy sync work; pair with clearChapterQueuePrepare on early exit.
 */
export function beginChapterQueuePrepare(
  chapterNumber: number,
  status = 'Đang chuẩn bị TTS chương…',
): void {
  if (state.running && !state.status.startsWith('Đang chuẩn bị')) return;
  state = {
    ...IDLE,
    running: true,
    cancelled: false,
    chapter: chapterNumber,
    status,
    startedAt: Date.now(),
  };
  emit({ force: true, flushDisk: true });
}

/** Abort prepare phase without a full queue run (preflight fail, warm fail, …). */
export function clearChapterQueuePrepare(status = ''): void {
  if (!state.running) {
    if (status) {
      state = { ...state, status };
      emit({ force: true });
    }
    return;
  }
  // Only clear if we never entered real worker loop (total still 0)
  if (state.total > 0) return;
  state = {
    ...IDLE,
    status: status || state.status,
    finishedAt: Date.now(),
    lastResult: state.lastResult,
  };
  emit({ force: true, flushDisk: true });
}

export function getChapterQueueState(): ChapterQueueSnapshot {
  return {
    ...state,
    errors: [...state.errors],
    failedIndexes: [...state.failedIndexes],
  };
}

export function subscribeChapterQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(getChapterQueueState());
  return () => listeners.delete(fn);
}

export function cancelChapterQueue(): void {
  if (!state.running) return;
  // Prepare phase (total===0): stop immediately so GUI unlocks
  if (state.total === 0) {
    state = {
      ...IDLE,
      status: 'Đã dừng (chuẩn bị)',
      finishedAt: Date.now(),
      lastResult: state.lastResult,
    };
    emit({ force: true, flushDisk: true });
    return;
  }
  state = { ...state, cancelled: true, status: 'Đang dừng…' };
  emit({ force: true, flushDisk: true });
}

/** Show a notice on the chapter TTS status bar even when queue is idle. */
export function setChapterQueueNotice(status: string, patch?: Partial<ChapterQueueSnapshot>): void {
  state = {
    ...state,
    ...patch,
    status: status || state.status,
  };
  emit({ force: true });
}

export type StartChapterQueueParams = {
  chapterNumber: number;
  jobs: ChapterQueueJob[];
  skipExisting: boolean;
  /**
   * Parallel scenes (Edge/Piper benefit). Zero-Shot ONNX: keep 1 — warm daemon
   * is single-GPU / single-process sequential.
   */
  concurrency?: number;
  /** Initial skipped count (e.g. preflight-blocked) */
  initialSkipped?: number;
  initialErrors?: string[];
  hasExistingAudio: (sceneIndex: number) => boolean;
  deductCredit: () => boolean;
  generateOne: (job: ChapterQueueJob) => Promise<void>;
  onItemStart?: (job: ChapterQueueJob, index: number) => void;
  onItemDone?: (job: ChapterQueueJob, index: number) => void;
  onItemFail?: (job: ChapterQueueJob, index: number, error: string) => void;
  onItemSkip?: (job: ChapterQueueJob, index: number) => void;
  onComplete?: (result: {
    ok: number;
    fail: number;
    skipped: number;
    failedIndexes: number[];
    errors: string[];
    cancelled: boolean;
  }) => void;
};

/**
 * Start chapter queue. If already running, rejects.
 * Supports worker-pool concurrency (default 1).
 */
export async function startChapterQueue(
  params: StartChapterQueueParams,
): Promise<{
  ok: number;
  fail: number;
  skipped: number;
  cancelled: boolean;
  failedIndexes: number[];
  errors: string[];
}> {
  // Allow transition from beginChapterQueuePrepare (running + total===0).
  // Block only when a real worker loop is already active (total > 0).
  if (state.running && state.total > 0) {
    throw new Error('Đang có job TTS chương chạy nền. Hãy dừng trước.');
  }

  const token = ++runToken;
  const total = params.jobs.length;
  const concurrency = Math.max(
    1,
    Math.min(4, Number.isFinite(Number(params.concurrency)) ? Math.trunc(Number(params.concurrency)) : 1),
  );
  state = {
    ...IDLE,
    running: true,
    cancelled: false,
    chapter: params.chapterNumber,
    total,
    progress: 0,
    status: `Bắt đầu ${total} cảnh${concurrency > 1 ? ` · song song ${concurrency}` : ''}…`,
    ok: 0,
    fail: 0,
    skipped: params.initialSkipped || 0,
    errors: [...(params.initialErrors || [])],
    failedIndexes: [],
    startedAt: state.startedAt || Date.now(),
  };
  emit({ force: true, flushDisk: true });

  try {
    let nextIndex = 0;
    let creditStop = false;
    let finished = 0;

    const bumpProgress = (title: string) => {
      const progressed = Math.min(100, Math.round((finished / Math.max(1, total)) * 100));
      state = {
        ...state,
        progress: progressed,
        status: title,
      };
      emit();
    };

    const runOne = async (j: number) => {
      if (token !== runToken || state.cancelled || creditStop) return;
      const job = params.jobs[j];
      state = {
        ...state,
        currentIndex: j,
        currentTitle: job.title,
        status: `Nền ${j + 1}/${total}: ${job.title}${concurrency > 1 ? ` ·×${concurrency}` : ''}`,
      };
      emit();
      params.onItemStart?.(job, j);

      if (params.skipExisting && params.hasExistingAudio(job.sceneIndex)) {
        finished += 1;
        state = {
          ...state,
          skipped: state.skipped + 1,
        };
        bumpProgress(`Bỏ qua ${job.title} (đã có audio)`);
        params.onItemSkip?.(job, j);
        return;
      }

      if (!params.deductCredit()) {
        creditStop = true;
        state = {
          ...state,
          fail: state.fail + 1,
          failedIndexes: [...state.failedIndexes, job.sceneIndex],
          errors: [...state.errors, `${job.title}: hết tín dụng`],
          status: 'Hết tín dụng — dừng queue',
        };
        emit();
        params.onItemFail?.(job, j, 'hết tín dụng');
        return;
      }

      try {
        await params.generateOne(job);
        if (token !== runToken) return;
        finished += 1;
        state = {
          ...state,
          ok: state.ok + 1,
        };
        bumpProgress(`Xong ${job.title}`);
        params.onItemDone?.(job, j);
      } catch (e) {
        if (token !== runToken) return;
        finished += 1;
        const msg = e instanceof Error ? e.message : String(e);
        state = {
          ...state,
          fail: state.fail + 1,
          failedIndexes: [...state.failedIndexes, job.sceneIndex],
          errors: [...state.errors, `${job.title}: ${msg}`],
        };
        bumpProgress(`Lỗi ${job.title}`);
        params.onItemFail?.(job, j, msg);
      }
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        if (token !== runToken || state.cancelled || creditStop) break;
        const j = nextIndex++;
        if (j >= params.jobs.length) break;
        await runOne(j);
      }
    });
    await Promise.all(workers);
    void finished;

    const cancelled = state.cancelled;
    const result = {
      ok: state.ok,
      fail: state.fail,
      skipped: state.skipped,
      failedIndexes: [...state.failedIndexes],
      errors: [...state.errors],
      cancelled,
    };

    state = {
      ...state,
      running: false,
      finishedAt: Date.now(),
      progress: cancelled ? state.progress : 100,
      status: cancelled
        ? `Dừng · OK ${result.ok} · lỗi ${result.fail} · bỏ qua ${result.skipped}`
        : `Xong · OK ${result.ok} · lỗi ${result.fail} · bỏ qua ${result.skipped}`,
      lastResult: {
        ok: result.ok,
        fail: result.fail,
        skipped: result.skipped,
      },
    };
    emit({ force: true, flushDisk: true });

    params.onComplete?.(result);
    return {
      ok: result.ok,
      fail: result.fail,
      skipped: result.skipped,
      cancelled: result.cancelled,
      failedIndexes: result.failedIndexes,
      errors: result.errors,
    };
  } catch (e) {
    state = {
      ...state,
      running: false,
      finishedAt: Date.now(),
      status: e instanceof Error ? e.message : String(e),
    };
    emit({ force: true, flushDisk: true });
    throw e;
  }
}

/** Restore snapshot from Electron after reload (display only — does not resume mid-job) */
export async function hydrateChapterQueueFromDisk(): Promise<void> {
  if (typeof window === 'undefined') return;
  const api = window.ainovelTools;
  if (!api?.getTtsQueue) return;
  try {
    const snap = (await api.getTtsQueue()) as Partial<ChapterQueueSnapshot> | null;
    if (!snap || typeof snap !== 'object') return;
    // Never mark as running after reload (process was killed)
    const wasRunning = snap.running === true;
    const prevStatus = typeof snap.status === 'string' ? snap.status : '';
    state = {
      ...IDLE,
      chapter: Number(snap.chapter) || 0,
      progress: Number(snap.progress) || 0,
      ok: Number(snap.ok) || 0,
      fail: Number(snap.fail) || 0,
      skipped: Number(snap.skipped) || 0,
      total: Number(snap.total) || 0,
      currentIndex: Number(snap.currentIndex) || 0,
      currentTitle: typeof snap.currentTitle === 'string' ? snap.currentTitle : '',
      errors: Array.isArray(snap.errors) ? snap.errors.map(String) : [],
      failedIndexes: Array.isArray(snap.failedIndexes)
        ? snap.failedIndexes.map(Number)
        : [],
      lastResult: snap.lastResult,
      startedAt: snap.startedAt,
      finishedAt: snap.finishedAt,
      running: false,
      cancelled: false,
      status: wasRunning
        ? `(Phiên trước) ${prevStatus || 'đã dừng khi tắt app'}`
        : prevStatus,
    };
    emit();
  } catch {
    /* ignore */
  }
}
