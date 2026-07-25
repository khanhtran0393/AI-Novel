/**
 * Client progress for image/video gen — optimized to avoid UI jank.
 * - Flow: ONE shared poll of /api/flow/queue for all active gens
 * - Prefer server `progressMessage` / `step` (real captcha/submit/poll)
 * - Non-Flow: slow asymptotic estimate
 */
import { API } from '@/contracts';

export type MediaGenProgress = {
  percent: number;
  phase: string;
};

export function phaseForFlowProgress(
  p: number,
  kind: 'image' | 'video',
): string {
  if (p <= 0) return 'Chờ…';
  if (p < 10) return 'Xếp hàng…';
  if (p < 25) return kind === 'image' ? 'Chuẩn bị…' : 'Chuẩn bị video…';
  if (p < 45) return kind === 'image' ? 'Gửi prompt…' : 'Gửi video…';
  if (p < 75) return kind === 'image' ? 'Flow đang vẽ…' : 'Flow render…';
  if (p < 95) return 'Tải file…';
  return 'Hoàn tất';
}

/** Map queue step → short VN label when progressMessage missing. */
export function phaseForFlowStep(
  step: string | undefined,
  kind: 'image' | 'video',
  percent: number,
): string {
  switch (String(step || '')) {
    case 'queued':
      return 'Hàng đợi Flow…';
    case 'account':
      return 'Gắn profile Google…';
    case 'captcha':
      return 'Xác minh reCAPTCHA / chặn bot…';
    case 'submit':
      return kind === 'image' ? 'Gửi gen ảnh…' : 'Gửi gen video…';
    case 'poll':
      return kind === 'image' ? 'Google đang vẽ…' : 'Google đang render…';
    case 'download':
      return 'Tải file về máy…';
    case 'saving':
      return 'Lưu file vào app…';
    case 'done':
      return 'Xong';
    case 'error':
      return 'Lỗi';
    default:
      return phaseForFlowProgress(percent, kind);
  }
}

type FlowTaskLite = {
  kind?: string;
  status?: string;
  progress?: number;
  chapterNum?: number;
  sceneIndex?: number;
  promptIndex?: number;
  attempts?: number;
  step?: string;
  progressMessage?: string;
  error?: string;
  queueAhead?: number;
  id?: string;
};

type FlowSub = {
  kind: 'image' | 'video';
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  onUpdate: (p: MediaGenProgress) => void;
  lastPercent: number;
  lastPhase: string;
};

const flowSubs = new Map<string, FlowSub>();
let flowTimer: ReturnType<typeof setInterval> | null = null;
let flowInFlight = false;

function shouldEmit(
  sub: { lastPercent: number; lastPhase: string },
  next: MediaGenProgress,
): boolean {
  if (next.phase !== sub.lastPhase) return true;
  if (next.percent === 100 || next.percent === 0) return true;
  // Chỉ re-render khi % nhảy ≥ 4 (tránh giật mỗi 1%)
  return Math.abs(next.percent - sub.lastPercent) >= 4;
}

async function tickFlowShared(): Promise<void> {
  if (flowInFlight || flowSubs.size === 0) return;
  flowInFlight = true;
  try {
    // Off-GUI poll — Worker/utilityProcess so progress ticks don't freeze chrome
    const { offThreadFetchResponse } = await import(
      '@/lib/appWork/offThreadFetchCompat'
    );
    const res = await offThreadFetchResponse(API.flowQueue, {
      method: 'GET',
      cache: 'no-store',
    } as RequestInit);
    const data = (await res.json().catch(() => ({}))) as {
      tasks?: FlowTaskLite[];
      queue?: { tasks?: FlowTaskLite[] };
    };
    const tasks: FlowTaskLite[] = Array.isArray(data.tasks)
      ? data.tasks
      : Array.isArray(data.queue?.tasks)
        ? data.queue.tasks
        : [];
    if (!tasks.length) return;

    for (const sub of flowSubs.values()) {
      const t = [...tasks].reverse().find(
        (x) =>
          x.kind === sub.kind &&
          Number(x.chapterNum) === sub.chapterNum &&
          Number(x.sceneIndex) === sub.sceneIndex &&
          Number(x.promptIndex) === sub.promptIndex,
      );
      if (!t) continue;
      const raw = Number(t.progress);
      let percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
      if (t.status === 'pending') percent = Math.max(percent, 3);
      if (t.status === 'running') percent = Math.max(percent, 8);
      if (t.status === 'done') percent = 100;
      if (t.status === 'failed') percent = Math.min(percent || 0, 99);
      const attempt =
        typeof t.attempts === 'number' && t.attempts > 1
          ? ` · thử ${t.attempts}`
          : '';
      const aheadN =
        typeof t.queueAhead === 'number' && t.queueAhead > 0
          ? t.queueAhead
          : 0;
      const aheadLabel =
        t.status === 'pending' && aheadN > 0
          ? ` · còn ${aheadN} trước bạn`
          : '';
      // Prefer server VN line (captcha / poll / error detail) over coarse % buckets
      const serverMsg = String(t.progressMessage || t.error || '')
        .replace(/\s+/g, ' ')
        .trim();
      let basePhase = '';
      if (t.status === 'failed') {
        basePhase = serverMsg
          ? serverMsg.slice(0, 96)
          : `Lỗi${attempt || ''}`;
      } else if (t.status === 'pending') {
        basePhase =
          serverMsg ||
          (aheadN > 0
            ? `Hàng đợi Flow — còn ${aheadN} job trước bạn…`
            : 'Hàng đợi…');
      } else if (t.status === 'done') {
        basePhase = 'Xong — đã lưu file';
      } else {
        basePhase =
          serverMsg ||
          phaseForFlowStep(t.step, sub.kind, percent);
      }
      if (
        aheadLabel &&
        t.status === 'pending' &&
        !basePhase.includes('trước bạn')
      ) {
        basePhase = `${basePhase}${aheadLabel}`;
      }
      const phase =
        t.status === 'failed' || t.status === 'done'
          ? basePhase
          : `${basePhase}${attempt}`;
      const next: MediaGenProgress = {
        percent: Math.round(percent),
        phase: phase.slice(0, 120),
      };
      if (!shouldEmit(sub, next)) continue;
      sub.lastPercent = next.percent;
      sub.lastPhase = next.phase;
      try {
        sub.onUpdate(next);
      } catch {
        /* ignore subscriber errors */
      }
    }
  } catch {
    /* ignore poll errors */
  } finally {
    flowInFlight = false;
  }
}

/** Poll cadence: 2s — enough for captcha/step UI; 1.2s re-render thrash on multi-slot gen. */
export const MEDIA_GEN_PROGRESS_INTERVAL_MS = 2000;

function ensureFlowTimer(): void {
  if (flowTimer) return;
  flowTimer = setInterval(() => void tickFlowShared(), MEDIA_GEN_PROGRESS_INTERVAL_MS);
}

function stopFlowTimerIfIdle(): void {
  if (flowSubs.size === 0 && flowTimer) {
    clearInterval(flowTimer);
    flowTimer = null;
  }
}

/**
 * Subscribe to shared Flow queue poll. One network poll for all concurrent gens.
 */
export function startFlowProgressPoll(opts: {
  kind: 'image' | 'video';
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  onUpdate: (p: MediaGenProgress) => void;
}): () => void {
  const id = `${opts.kind}:${opts.chapterNum}:${opts.sceneIndex}:${opts.promptIndex}:${Date.now().toString(36)}`;
  flowSubs.set(id, {
    kind: opts.kind,
    chapterNum: opts.chapterNum,
    sceneIndex: opts.sceneIndex,
    promptIndex: opts.promptIndex,
    onUpdate: opts.onUpdate,
    lastPercent: -1,
    lastPhase: '',
  });
  ensureFlowTimer();
  // First tick after a short delay (avoid pile-up with request start)
  setTimeout(() => void tickFlowShared(), 400);
  return () => {
    flowSubs.delete(id);
    stopFlowTimerIfIdle();
  };
}

/** Non-Flow: slow estimate; only emit when % changes by ≥3. */
export function startIndeterminateProgress(opts: {
  kind: 'image' | 'video';
  onUpdate: (p: MediaGenProgress) => void;
}): () => void {
  const t0 = Date.now();
  let lastPercent = -1;
  let lastPhase = '';
  opts.onUpdate({
    percent: 5,
    phase: opts.kind === 'image' ? 'Gọi API ảnh…' : 'Gọi API video…',
  });
  lastPercent = 5;
  lastPhase = opts.kind === 'image' ? 'Gọi API ảnh…' : 'Gọi API video…';

  const id = setInterval(() => {
    const sec = (Date.now() - t0) / 1000;
    const percent = Math.min(88, Math.round(5 + 83 * (1 - Math.exp(-sec / 28))));
    let phase =
      opts.kind === 'image' ? 'Đang sinh ảnh…' : 'Đang sinh video…';
    if (sec < 5) phase = 'Gửi request…';
    else if (sec > 45) phase = 'Chờ API…';
    if (percent === lastPercent && phase === lastPhase) return;
    if (Math.abs(percent - lastPercent) < 3 && phase === lastPhase) return;
    lastPercent = percent;
    lastPhase = phase;
    opts.onUpdate({ percent, phase });
  }, MEDIA_GEN_PROGRESS_INTERVAL_MS);
  return () => clearInterval(id);
}

/** Skip React setState when progress is effectively unchanged. */
export function progressUnchanged(
  prev: MediaGenProgress | undefined,
  next: MediaGenProgress,
): boolean {
  if (!prev) return false;
  return prev.percent === next.percent && prev.phase === next.phase;
}
