/**
 * Module-level chapter TTS queue — survives React remounts / tab switches.
 * Optional Electron persistence of snapshot.
 */

export type ChapterQueueJob = {
  sceneIndex: number;
  text: string;
  title: string;
};

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

function emit() {
  const snap = { ...state, errors: [...state.errors], failedIndexes: [...state.failedIndexes] };
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  }
  // Persist snapshot to Electron when available (best-effort)
  void persistQueueSnapshot(snap);
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
  state = { ...state, cancelled: true, status: 'Đang dừng…' };
  emit();
}

export type StartChapterQueueParams = {
  chapterNumber: number;
  jobs: ChapterQueueJob[];
  skipExisting: boolean;
  /** Initial skipped count (e.g. preflight-blocked) */
  initialSkipped?: number;
  initialErrors?: string[];
  hasExistingAudio: (sceneIndex: number) => boolean;
  deductCredit: () => boolean;
  generateOne: (job: ChapterQueueJob) => Promise<void>;
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
 */
export async function startChapterQueue(
  params: StartChapterQueueParams,
): Promise<{ ok: number; fail: number; skipped: number }> {
  if (state.running) {
    throw new Error('Đang có job TTS chương chạy nền. Hãy dừng trước.');
  }

  const token = ++runToken;
  const total = params.jobs.length;
  state = {
    ...IDLE,
    running: true,
    cancelled: false,
    chapter: params.chapterNumber,
    total,
    progress: 0,
    status: `Bắt đầu ${total} cảnh…`,
    ok: 0,
    fail: 0,
    skipped: params.initialSkipped || 0,
    errors: [...(params.initialErrors || [])],
    failedIndexes: [],
    startedAt: Date.now(),
  };
  emit();

  try {
    for (let j = 0; j < params.jobs.length; j++) {
      if (token !== runToken) break;
      if (state.cancelled) {
        state = { ...state, status: 'Đã dừng bởi người dùng' };
        emit();
        break;
      }

      const job = params.jobs[j];
      state = {
        ...state,
        currentIndex: j,
        currentTitle: job.title,
        progress: Math.round((j / Math.max(1, total)) * 100),
        status: `Nền ${j + 1}/${total}: ${job.title}`,
      };
      emit();

      if (params.skipExisting && params.hasExistingAudio(job.sceneIndex)) {
        state = {
          ...state,
          skipped: state.skipped + 1,
          progress: Math.round(((j + 1) / Math.max(1, total)) * 100),
          status: `Bỏ qua ${job.title} (đã có audio)`,
        };
        emit();
        continue;
      }

      if (!params.deductCredit()) {
        state = {
          ...state,
          fail: state.fail + 1,
          failedIndexes: [...state.failedIndexes, job.sceneIndex],
          errors: [...state.errors, `${job.title}: hết tín dụng`],
          status: 'Hết tín dụng — dừng queue',
        };
        emit();
        break;
      }

      try {
        await params.generateOne(job);
        if (token !== runToken) break;
        state = {
          ...state,
          ok: state.ok + 1,
          progress: Math.round(((j + 1) / Math.max(1, total)) * 100),
          status: `Xong ${job.title}`,
        };
        emit();
      } catch (e) {
        if (token !== runToken) break;
        const msg = e instanceof Error ? e.message : String(e);
        state = {
          ...state,
          fail: state.fail + 1,
          failedIndexes: [...state.failedIndexes, job.sceneIndex],
          errors: [...state.errors, `${job.title}: ${msg}`],
          progress: Math.round(((j + 1) / Math.max(1, total)) * 100),
          status: `Lỗi ${job.title}`,
        };
        emit();
      }
    }

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
    emit();

    params.onComplete?.(result);
    return {
      ok: result.ok,
      fail: result.fail,
      skipped: result.skipped,
    };
  } catch (e) {
    state = {
      ...state,
      running: false,
      finishedAt: Date.now(),
      status: e instanceof Error ? e.message : String(e),
    };
    emit();
    throw e;
  }
}

/** Restore snapshot from Electron after reload (display only — does not resume mid-job) */
export async function hydrateChapterQueueFromDisk(): Promise<void> {
  if (typeof window === 'undefined') return;
  const api = window.ainovelTools;
  if (!api?.getTtsQueue) return;
  try {
    const snap = await api.getTtsQueue();
    if (!snap || typeof snap !== 'object') return;
    // Never mark as running after reload (process was killed)
    state = {
      ...IDLE,
      ...snap,
      running: false,
      cancelled: false,
      status: snap.running
        ? `(Phiên trước) ${snap.status || 'đã dừng khi tắt app'}`
        : snap.status || '',
    };
    emit();
  } catch {
    /* ignore */
  }
}
