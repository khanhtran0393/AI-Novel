/**
 * Off-GUI HTTP host client.
 *
 * Priority:
 *  1. Electron utilityProcess via window.ainovelWork (true process isolation)
 *  2. Dedicated Web Worker (separate thread, same process)
 *  3. Never use renderer main-thread fetch for media waits when 1/2 available
 *
 * GUI only: schedule + apply results. Network wait loop never blocks paint.
 */

export type OffThreadFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Optional correlation id */
  id?: string;
};

export type OffThreadFetchResult = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  error?: string;
  /** Where the request ran */
  mode: 'utilityProcess' | 'worker' | 'main-fallback';
};

export type OffThreadBatchItem = {
  itemId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type OffThreadBatchOptions = {
  id?: string;
  items: OffThreadBatchItem[];
  concurrency?: number;
  itemGapMs?: number;
  onItem?: (
    item: OffThreadBatchItem & {
      index: number;
      ok: boolean;
      status: number;
      bodyText: string;
      headers?: Record<string, string>;
      error?: string;
    },
  ) => void | Promise<void>;
  isCancelled?: () => boolean;
};

type AinovelWorkApi = {
  isElectron?: boolean;
  ping: () => Promise<{ ok?: boolean; ready?: boolean; mode?: string; error?: string }>;
  fetch: (payload: {
    id?: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<OffThreadFetchResult & { id?: string }>;
  batch: (payload: {
    id?: string;
    items: OffThreadBatchItem[];
    concurrency?: number;
    itemGapMs?: number;
  }) => Promise<{ id?: string; done?: number; failed?: number; cancelled?: boolean }>;
  cancel: (id: string) => Promise<unknown>;
  onEvent: (handler: (payload: Record<string, unknown>) => void) => () => void;
};

function getAinovelWork(): AinovelWorkApi | null {
  if (typeof window === 'undefined') return null;
  const w = (window as unknown as { ainovelWork?: AinovelWorkApi }).ainovelWork;
  return w && typeof w.fetch === 'function' ? w : null;
}

let electronReady: boolean | null = null;

export async function isOffThreadElectronReady(): Promise<boolean> {
  if (electronReady != null) return electronReady;
  const api = getAinovelWork();
  if (!api) {
    electronReady = false;
    return false;
  }
  try {
    const r = await api.ping();
    electronReady = !!(r && r.ok);
  } catch {
    electronReady = false;
  }
  return electronReady;
}

// ─── Web Worker fallback (blob — no webpack worker config) ─────────────────

const WORKER_SOURCE = `
self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const post = (m) => self.postMessage(m);
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms|0)));
  async function doFetch(url, method, headers, body) {
    const init = { method: method || 'GET', headers: headers || {} };
    if (body != null && method && String(method).toUpperCase() !== 'GET') {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const bodyText = await res.text();
    const hdrs = {};
    res.headers.forEach((v, k) => { hdrs[k] = v; });
    return { ok: res.ok, status: res.status, headers: hdrs, bodyText };
  }
  if (msg.type === 'fetch') {
    try {
      const r = await doFetch(msg.url, msg.method, msg.headers, msg.body);
      post({ type: 'fetch_result', id: msg.id, ...r });
    } catch (e) {
      post({ type: 'fetch_result', id: msg.id, ok: false, status: 0, headers: {}, bodyText: '', error: String(e && e.message || e) });
    }
    return;
  }
  if (msg.type === 'batch') {
    const items = Array.isArray(msg.items) ? msg.items : [];
    const concurrency = Math.max(1, Math.min(4, Number(msg.concurrency) || 1));
    const gapMs = Math.max(0, Number(msg.itemGapMs) || 0);
    let next = 0, done = 0, failed = 0;
    const cancelled = { v: false };
    const runOne = async () => {
      while (true) {
        if (cancelled.v) return;
        const i = next++;
        if (i >= items.length) return;
        const it = items[i] || {};
        try {
          const r = await doFetch(it.url, it.method, it.headers, it.body);
          if (r.ok) done++; else failed++;
          post({ type: 'batch_item', id: msg.id, itemId: String(it.itemId || i), index: i, ok: r.ok, status: r.status, headers: r.headers, bodyText: r.bodyText, error: r.ok ? undefined : ('HTTP ' + r.status) });
        } catch (e) {
          failed++;
          post({ type: 'batch_item', id: msg.id, itemId: String(it.itemId || i), index: i, ok: false, status: 0, bodyText: '', error: String(e && e.message || e) });
        }
        if (gapMs > 0 && !cancelled.v) await sleep(gapMs);
      }
    };
    self.__cancelBatch = () => { cancelled.v = true; };
    const workers = [];
    for (let w = 0; w < concurrency; w++) workers.push(runOne());
    await Promise.all(workers);
    post({ type: 'batch_done', id: msg.id, done, failed, cancelled: cancelled.v });
  }
  if (msg.type === 'cancel') {
    try { if (self.__cancelBatch) self.__cancelBatch(); } catch (_) {}
  }
};
`;

let sharedWorker: Worker | null = null;
let workerSeq = 0;
const workerWaiters = new Map<
  string,
  {
    kind: 'fetch' | 'batch';
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    onItem?: (msg: Record<string, unknown>) => void;
  }
>();

function ensureWorker(): Worker {
  if (sharedWorker) return sharedWorker;
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  sharedWorker = new Worker(url);
  sharedWorker.onmessage = (ev) => {
    const msg = (ev.data || {}) as Record<string, unknown>;
    const id = String(msg.id || '');
    if (msg.type === 'fetch_result') {
      const w = workerWaiters.get(id);
      if (w) {
        workerWaiters.delete(id);
        w.resolve(msg);
      }
      return;
    }
    if (msg.type === 'batch_item') {
      const w = workerWaiters.get(id);
      w?.onItem?.(msg);
      return;
    }
    if (msg.type === 'batch_done') {
      const w = workerWaiters.get(id);
      if (w) {
        workerWaiters.delete(id);
        w.resolve(msg);
      }
    }
  };
  sharedWorker.onerror = (err) => {
    console.warn('[offThreadHost] worker error', err);
  };
  return sharedWorker;
}

function mintId(prefix: string): string {
  workerSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${workerSeq}`;
}

/** Absolute URL for Worker (relative /api/* fails inside blob worker). */
export function resolveAbsoluteApiUrl(url: string): string {
  const u = String(url || '').trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (typeof window !== 'undefined' && window.location?.origin) {
    if (u.startsWith('/')) return `${window.location.origin}${u}`;
    return `${window.location.origin}/${u}`;
  }
  return u;
}

/**
 * HTTP fetch off GUI thread (utilityProcess or Worker).
 * Falls back to main-thread fetch only if Worker creation fails (SSR/tests).
 */
export async function offThreadFetch(
  url: string,
  init: OffThreadFetchInit = {},
): Promise<OffThreadFetchResult> {
  const abs = resolveAbsoluteApiUrl(url);
  const id = init.id || mintId('fetch');
  const method = init.method || 'POST';
  const headers = init.headers || {};
  const body = init.body;

  // 1) Electron utilityProcess
  if (typeof window !== 'undefined') {
    const api = getAinovelWork();
    if (api) {
      try {
        const ready = await isOffThreadElectronReady();
        if (ready) {
          const r = await api.fetch({ id, url: abs, method, headers, body });
          return {
            ok: !!r.ok,
            status: Number(r.status) || 0,
            headers: (r.headers as Record<string, string>) || {},
            bodyText: String(r.bodyText || ''),
            error: r.error,
            mode: 'utilityProcess',
          };
        }
      } catch (e) {
        console.warn('[offThreadHost] electron fetch failed, try worker', e);
      }
    }
  }

  // 2) Web Worker
  if (typeof Worker !== 'undefined') {
    try {
      const worker = ensureWorker();
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        workerWaiters.set(id, { kind: 'fetch', resolve: resolve as (v: unknown) => void, reject });
        worker.postMessage({ type: 'fetch', id, url: abs, method, headers, body });
        setTimeout(() => {
          if (workerWaiters.has(id)) {
            workerWaiters.delete(id);
            reject(new Error('offThread fetch timeout'));
          }
        }, 900_000); // 15m — Flow video can be long
      });
      return {
        ok: !!result.ok,
        status: Number(result.status) || 0,
        headers: (result.headers as Record<string, string>) || {},
        bodyText: String(result.bodyText || ''),
        error: result.error as string | undefined,
        mode: 'worker',
      };
    } catch (e) {
      console.warn('[offThreadHost] worker fetch failed, main fallback', e);
    }
  }

  // 3) Last resort — main thread (SSR / worker blocked)
  const res = await fetch(abs, {
    method,
    headers,
    body: body != null && method.toUpperCase() !== 'GET' ? body : undefined,
  });
  const bodyText = await res.text();
  const hdrs: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    hdrs[k] = v;
  });
  return {
    ok: res.ok,
    status: res.status,
    headers: hdrs,
    bodyText,
    mode: 'main-fallback',
  };
}

/**
 * Batch HTTP off GUI — progress via onItem (throttled apply on renderer).
 */
export async function offThreadHttpBatch(
  opts: OffThreadBatchOptions,
): Promise<{ done: number; failed: number; cancelled: boolean; mode: string }> {
  const id = opts.id || mintId('batch');
  const items = (opts.items || []).map((it) => ({
    ...it,
    url: resolveAbsoluteApiUrl(it.url),
  }));

  // Electron
  const api = getAinovelWork();
  if (api && (await isOffThreadElectronReady())) {
    let unsub = () => {};
    try {
      unsub = api.onEvent((msg) => {
        if (msg.type === 'batch_item' && String(msg.id) === id) {
          const item = items[Number(msg.index)] || {
            itemId: String(msg.itemId || ''),
            url: '',
          };
          void opts.onItem?.({
            ...item,
            index: Number(msg.index) || 0,
            ok: !!msg.ok,
            status: Number(msg.status) || 0,
            bodyText: String(msg.bodyText || ''),
            headers: (msg.headers as Record<string, string>) || {},
            error: msg.error as string | undefined,
          });
        }
      });
      if (opts.isCancelled?.()) {
        await api.cancel(id);
        return { done: 0, failed: 0, cancelled: true, mode: 'utilityProcess' };
      }
      const doneMsg = await api.batch({
        id,
        items,
        concurrency: opts.concurrency,
        itemGapMs: opts.itemGapMs,
      });
      return {
        done: Number(doneMsg.done) || 0,
        failed: Number(doneMsg.failed) || 0,
        cancelled: !!doneMsg.cancelled,
        mode: 'utilityProcess',
      };
    } finally {
      unsub();
    }
  }

  // Worker
  if (typeof Worker !== 'undefined') {
    const worker = ensureWorker();
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      workerWaiters.set(id, {
        kind: 'batch',
        resolve: resolve as (v: unknown) => void,
        reject,
        onItem: (msg) => {
          const item = items[Number(msg.index)] || {
            itemId: String(msg.itemId || ''),
            url: '',
          };
          void opts.onItem?.({
            ...item,
            index: Number(msg.index) || 0,
            ok: !!msg.ok,
            status: Number(msg.status) || 0,
            bodyText: String(msg.bodyText || ''),
            headers: (msg.headers as Record<string, string>) || {},
            error: msg.error as string | undefined,
          });
        },
      });
      worker.postMessage({
        type: 'batch',
        id,
        items,
        concurrency: opts.concurrency,
        itemGapMs: opts.itemGapMs,
      });
      // cancel poll
      const cancelTimer = setInterval(() => {
        if (opts.isCancelled?.()) {
          worker.postMessage({ type: 'cancel', id });
          clearInterval(cancelTimer);
        }
      }, 400);
      setTimeout(() => clearInterval(cancelTimer), 900_000);
    });
    return {
      done: Number(result.done) || 0,
      failed: Number(result.failed) || 0,
      cancelled: !!result.cancelled,
      mode: 'worker',
    };
  }

  // Main fallback sequential
  let done = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    if (opts.isCancelled?.()) {
      return { done, failed, cancelled: true, mode: 'main-fallback' };
    }
    const it = items[i];
    try {
      const r = await offThreadFetch(it.url, {
        method: it.method,
        headers: it.headers,
        body: it.body,
      });
      if (r.ok) done += 1;
      else failed += 1;
      await opts.onItem?.({
        ...it,
        index: i,
        ok: r.ok,
        status: r.status,
        bodyText: r.bodyText,
        headers: r.headers,
        error: r.error,
      });
    } catch (e) {
      failed += 1;
      await opts.onItem?.({
        ...it,
        index: i,
        ok: false,
        status: 0,
        bodyText: '',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { done, failed, cancelled: false, mode: 'main-fallback' };
}

/** Parse JSON body from off-thread result (throws if invalid + not ok). */
export function parseOffThreadJson<T = unknown>(r: OffThreadFetchResult): T {
  try {
    return JSON.parse(r.bodyText || '{}') as T;
  } catch {
    if (!r.ok) {
      throw new Error(r.error || `HTTP ${r.status}`);
    }
    throw new Error('Invalid JSON from off-thread fetch');
  }
}
