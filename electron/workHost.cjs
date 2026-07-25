/**
 * Electron utilityProcess work host — runs OUTSIDE the GUI BrowserWindow process.
 * Handles HTTP batch + single fetch so renderer main thread stays free for paint/input.
 *
 * Protocol (parentPort messages):
 *   in:  { type:'fetch', id, url, method, headers, body }
 *   in:  { type:'batch', id, items:[{itemId,url,method,headers,body}], concurrency, itemGapMs }
 *   in:  { type:'cancel', id }
 *   out: { type:'fetch_result', id, ok, status, headers, bodyText, error? }
 *   out: { type:'batch_item', id, itemId, index, ok, status, bodyText, error? }
 *   out: { type:'batch_done', id, done, failed, cancelled }
 *   out: { type:'ready' }
 */
'use strict';

/**
 * Electron utilityProcess exposes process.parentPort.
 * Fallback: node:worker_threads parentPort when forked as Worker.
 */
function getPort() {
  if (process.parentPort && typeof process.parentPort.postMessage === 'function') {
    return process.parentPort;
  }
  try {
    const { parentPort } = require('node:worker_threads');
    if (parentPort) return parentPort;
  } catch {
    /* ignore */
  }
  return null;
}

const port = getPort();

/** @type {Map<string, { cancel: boolean }>} */
const jobs = new Map();

function post(msg) {
  try {
    if (!port) {
      console.error('[workHost] no parentPort');
      return;
    }
    // Electron parentPort uses postMessage(data); worker_threads same
    port.postMessage(msg);
  } catch (e) {
    console.error('[workHost] post failed', e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
}

async function doFetch(url, method, headers, body) {
  const init = {
    method: method || 'GET',
    headers: headers && typeof headers === 'object' ? headers : {},
  };
  if (body != null && method && String(method).toUpperCase() !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const bodyText = await res.text();
  const hdrs = {};
  res.headers.forEach((v, k) => {
    hdrs[k] = v;
  });
  return { ok: res.ok, status: res.status, headers: hdrs, bodyText };
}

async function handleFetch(msg) {
  const id = String(msg.id || '');
  jobs.set(id, { cancel: false });
  try {
    const r = await doFetch(msg.url, msg.method, msg.headers, msg.body);
    if (jobs.get(id)?.cancel) {
      post({ type: 'fetch_result', id, ok: false, status: 0, headers: {}, bodyText: '', error: 'cancelled' });
      return;
    }
    post({ type: 'fetch_result', id, ...r });
  } catch (e) {
    post({
      type: 'fetch_result',
      id,
      ok: false,
      status: 0,
      headers: {},
      bodyText: '',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    jobs.delete(id);
  }
}

async function handleBatch(msg) {
  const id = String(msg.id || '');
  const items = Array.isArray(msg.items) ? msg.items : [];
  const concurrency = Math.max(1, Math.min(4, Number(msg.concurrency) || 1));
  const gapMs = Math.max(0, Number(msg.itemGapMs) || 0);
  jobs.set(id, { cancel: false });

  let next = 0;
  let done = 0;
  let failed = 0;
  let cancelled = false;

  const runOne = async () => {
    while (true) {
      if (jobs.get(id)?.cancel) {
        cancelled = true;
        return;
      }
      const i = next++;
      if (i >= items.length) return;
      const it = items[i] || {};
      const itemId = String(it.itemId || i);
      try {
        const r = await doFetch(it.url, it.method, it.headers, it.body);
        if (jobs.get(id)?.cancel) {
          cancelled = true;
          post({
            type: 'batch_item',
            id,
            itemId,
            index: i,
            ok: false,
            status: 0,
            bodyText: '',
            error: 'cancelled',
          });
          return;
        }
        if (r.ok) done += 1;
        else failed += 1;
        post({
          type: 'batch_item',
          id,
          itemId,
          index: i,
          ok: r.ok,
          status: r.status,
          headers: r.headers,
          bodyText: r.bodyText,
          error: r.ok ? undefined : `HTTP ${r.status}`,
        });
      } catch (e) {
        failed += 1;
        post({
          type: 'batch_item',
          id,
          itemId,
          index: i,
          ok: false,
          status: 0,
          bodyText: '',
          error: e instanceof Error ? e.message : String(e),
        });
      }
      if (gapMs > 0 && !jobs.get(id)?.cancel) {
        await sleep(gapMs);
      }
    }
  };

  try {
    const workers = [];
    for (let w = 0; w < concurrency; w++) workers.push(runOne());
    await Promise.all(workers);
  } finally {
    post({
      type: 'batch_done',
      id,
      done,
      failed,
      cancelled: cancelled || !!jobs.get(id)?.cancel,
    });
    jobs.delete(id);
  }
}

function onMessage(raw) {
  // Electron: event.data; worker_threads: raw message
  const msg = raw && raw.data !== undefined ? raw.data : raw;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'fetch') {
    void handleFetch(msg);
    return;
  }
  if (msg.type === 'batch') {
    void handleBatch(msg);
    return;
  }
  if (msg.type === 'cancel') {
    const j = jobs.get(String(msg.id || ''));
    if (j) j.cancel = true;
    return;
  }
  if (msg.type === 'ping') {
    post({ type: 'pong', t: Date.now() });
  }
}

if (port) {
  port.on('message', onMessage);
  post({ type: 'ready' });
  console.log('[workHost] utility process ready');
} else {
  console.error('[workHost] FATAL: no parentPort — cannot start');
  process.exit(1);
}
