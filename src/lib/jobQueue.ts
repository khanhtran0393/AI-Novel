/**
 * Client-side batch job queue for image/TTS/media work.
 * Pause / cancel / retry-failed without One-click full chapter pipeline.
 * Each job/item carries correlationId for support + structured logs.
 */

/** Local id mint — avoid pulling requestContext → @/secrets into lightweight clients/tests */
function newCorrelationId(prefix = 'job'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type JobKind = 'image' | 'tts' | 'video' | 'thumb' | 'other';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export type BatchJobItem = {
  id: string;
  label: string;
  kind: JobKind;
  status: JobStatus;
  error?: string;
  /** Request correlation for this item (API x-correlation-id) */
  correlationId?: string;
  /** Optional resume payload for retry */
  meta?: Record<string, unknown>;
};

export type BatchJob = {
  id: string;
  title: string;
  kind: JobKind;
  status: JobStatus;
  /** Parent correlation id for the whole batch */
  correlationId: string;
  createdAt: number;
  updatedAt: number;
  items: BatchJobItem[];
  concurrency: number;
  /** Index cursor for sequential runners */
  cursor: number;
};

type QueueListener = () => void;
export type BatchJobRunner = (item: BatchJobItem, job: BatchJob) => Promise<void>;

const jobs = new Map<string, BatchJob>();
const listeners = new Set<QueueListener>();
const abortFlags = new Map<string, { cancel: boolean; pause: boolean }>();
/** Keep runner so Retry failed can re-run without re-creating the job */
const runners = new Map<string, BatchJobRunner>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeJobQueue(fn: QueueListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listJobs(): BatchJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(id: string): BatchJob | undefined {
  return jobs.get(id);
}

export function createBatchJob(params: {
  title: string;
  kind: JobKind;
  items: Array<{ label: string; kind?: JobKind; meta?: Record<string, unknown> }>;
  concurrency?: number;
  correlationId?: string;
}): BatchJob {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const correlationId = params.correlationId || newCorrelationId('job');
  const job: BatchJob = {
    id,
    title: params.title,
    kind: params.kind,
    status: 'queued',
    correlationId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    concurrency: Math.max(1, Math.min(6, params.concurrency || 2)),
    cursor: 0,
    items: params.items.map((it, i) => ({
      id: `${id}_${i}`,
      label: it.label,
      kind: it.kind || params.kind,
      status: 'queued',
      correlationId: newCorrelationId(`${params.kind}_item`),
      meta: { ...it.meta, parentCorrelationId: correlationId },
    })),
  };
  jobs.set(id, job);
  abortFlags.set(id, { cancel: false, pause: false });
  emit();
  return job;
}

export function pauseJob(id: string) {
  const f = abortFlags.get(id);
  const j = jobs.get(id);
  if (!f || !j) return;
  f.pause = true;
  j.status = 'paused';
  j.updatedAt = Date.now();
  emit();
}

export function resumeJob(id: string) {
  const f = abortFlags.get(id);
  const j = jobs.get(id);
  if (!f || !j) return;
  f.pause = false;
  if (j.status === 'paused') {
    j.status = 'running';
    j.updatedAt = Date.now();
    emit();
  }
}

export function cancelJob(id: string) {
  const f = abortFlags.get(id);
  const j = jobs.get(id);
  if (!f || !j) return;
  f.cancel = true;
  f.pause = false;
  j.status = 'cancelled';
  j.updatedAt = Date.now();
  for (const it of j.items) {
    if (it.status === 'queued' || it.status === 'running' || it.status === 'paused') {
      it.status = 'cancelled';
    }
  }
  emit();
}

export function clearFinishedJobs() {
  for (const [id, j] of jobs) {
    if (j.status === 'done' || j.status === 'cancelled') {
      jobs.delete(id);
      abortFlags.delete(id);
    }
  }
  emit();
}

export function jobProgress(job: BatchJob): {
  done: number;
  failed: number;
  total: number;
  running: number;
  pct: number;
} {
  const total = job.items.length;
  const done = job.items.filter((i) => i.status === 'done').length;
  const failed = job.items.filter((i) => i.status === 'failed').length;
  const running = job.items.filter((i) => i.status === 'running').length;
  const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
  return { done, failed, total, running, pct };
}

/**
 * Run a batch with concurrency, respecting pause/cancel.
 * runner receives item; throw to mark failed.
 */
export async function runBatchJob(
  jobId: string,
  runner: BatchJobRunner,
): Promise<BatchJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  runners.set(jobId, runner);
  const flags = abortFlags.get(jobId) || { cancel: false, pause: false };
  job.status = 'running';
  job.updatedAt = Date.now();
  emit();

  // First run: only queued. Retry path may re-queue failed as queued.
  const queue = job.items.filter((i) => i.status === 'queued');
  let idx = 0;

  const workers: Promise<void>[] = [];
  const runOne = async () => {
    while (true) {
      if (flags.cancel) return;
      while (flags.pause && !flags.cancel) {
        await sleep(120);
      }
      if (flags.cancel) return;

      const i = idx++;
      if (i >= queue.length) return;
      const item = queue[i];
      if (!item || item.status !== 'queued') continue;

      item.status = 'running';
      job.updatedAt = Date.now();
      emit();
      try {
        await runner(item, job);
        if (flags.cancel) {
          item.status = 'cancelled';
        } else {
          item.status = 'done';
          item.error = undefined;
        }
      } catch (e) {
        item.status = 'failed';
        const err = e as Error & { correlationId?: string };
        item.error = err instanceof Error ? err.message : String(e);
        const cid =
          err?.correlationId ||
          (typeof err?.message === 'string' &&
          err.message.match(/cid[=:\s]+([a-z0-9_]+)/i)?.[1]) ||
          item.correlationId;
        if (cid) {
          item.correlationId = cid;
          item.meta = { ...(item.meta || {}), correlationId: cid };
          if (!item.error.includes(cid)) {
            item.error = `${item.error} [cid=${cid}]`;
          }
        }
      }
      job.updatedAt = Date.now();
      emit();
    }
  };

  for (let w = 0; w < job.concurrency; w++) {
    workers.push(runOne());
  }
  await Promise.all(workers);

  if (flags.cancel) {
    job.status = 'cancelled';
  } else {
    const failed = job.items.some((i) => i.status === 'failed');
    const allDone = job.items.every(
      (i) => i.status === 'done' || i.status === 'failed' || i.status === 'cancelled',
    );
    job.status = allDone ? (failed ? 'failed' : 'done') : 'paused';
  }
  job.updatedAt = Date.now();
  emit();
  return job;
}

/** Re-queue failed items and re-run (uses stored runner if runner omitted) */
export async function retryFailedJob(
  jobId: string,
  runner?: BatchJobRunner,
): Promise<BatchJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const run = runner || runners.get(jobId);
  if (!run) return undefined;
  const flags = abortFlags.get(jobId);
  if (flags) {
    flags.cancel = false;
    flags.pause = false;
  }
  for (const it of job.items) {
    if (it.status === 'failed') {
      it.status = 'queued';
      it.error = undefined;
    }
  }
  job.status = 'queued';
  job.updatedAt = Date.now();
  emit();
  return runBatchJob(jobId, run);
}

export function hasJobRunner(jobId: string): boolean {
  return runners.has(jobId);
}

export function setJobRunner(jobId: string, runner: BatchJobRunner) {
  runners.set(jobId, runner);
}

export function patchBatchJobItem(
  jobId: string,
  index: number,
  patch: Partial<BatchJobItem>,
) {
  const job = jobs.get(jobId);
  if (!job || !job.items[index]) return;
  job.items[index] = { ...job.items[index], ...patch };
  job.updatedAt = Date.now();
  emit();
}

export function setBatchJobStatus(jobId: string, status: JobStatus) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = Date.now();
  emit();
}

export function touchBatchJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.updatedAt = Date.now();
  emit();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatJobSummary(job: BatchJob): string {
  const p = jobProgress(job);
  return `${p.done}/${p.total} xong · ${p.failed} lỗi · ${p.pct}%`;
}

/** 1-click error report for Job center (copy / download). */
export function buildJobErrorReport(jobId?: string): string {
  const list = jobId
    ? ([getJob(jobId)].filter(Boolean) as BatchJob[])
    : listJobs();
  const lines: string[] = [
    'AI Novel — Job error report',
    `exportedAt: ${new Date().toISOString()}`,
    `jobs: ${list.length}`,
    '',
  ];
  for (const job of list) {
    const p = jobProgress(job);
    lines.push(`## ${job.title} (${job.id})`);
    lines.push(
      `status=${job.status} kind=${job.kind} progress=${p.done}/${p.total} failed=${p.failed}`,
    );
    lines.push(`jobCorrelationId=${job.correlationId || '(none)'}`);
    lines.push(`createdAt=${new Date(job.createdAt).toISOString()}`);
    for (const it of job.items) {
      if (it.status !== 'failed' && !it.error) continue;
      lines.push(`- [${it.status}] ${it.label}`);
      if (it.correlationId) lines.push(`  correlationId: ${it.correlationId}`);
      if (it.error) lines.push(`  error: ${it.error}`);
      if (it.meta && Object.keys(it.meta).length) {
        try {
          lines.push(`  meta: ${JSON.stringify(it.meta)}`);
        } catch {
          /* ignore */
        }
      }
    }
    lines.push('');
  }
  if (list.every((j) => !j.items.some((i) => i.status === 'failed' || i.error))) {
    lines.push('(no failed items)');
  }
  return lines.join('\n');
}

export function exportAllJobsJson(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      jobs: listJobs(),
    },
    null,
    2,
  );
}
