/**
 * Real-user UI audit via CDP (Chrome DevTools Protocol)
 * Connects to Chrome on :9222, navigates the workspace like a real user,
 * clicks clickable elements, collects console/page errors, saves screenshots.
 *
 * Usage: node scripts/clean-room-ui-real-user.cjs
 */
const CDP = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP_PORT = 9222;
const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(process.env.TEMP || '.', 'ainovel-audit');
const RESULTS = { startedAt: new Date().toISOString(), steps: [], errors: [], screenshots: [] };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const r = http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad json: ' + d.slice(0, 80))); }
      });
    });
    r.on('error', reject);
    r.setTimeout(timeoutMs, () => { r.destroy(); reject(new Error('timeout ' + url)); });
  });
}

async function wsConnect(url) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

let msgId = 0;
const pending = new Map();
function sendCmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function log(step, ok, detail = '') {
  const line = `[${ok ? 'OK' : 'FAIL'}] ${step}${detail ? ' :: ' + detail : ''}`;
  console.log(line);
  RESULTS.steps.push({ step, ok, detail, at: new Date().toISOString() });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

  // 1. Find CDP target
  let targets;
  try {
    targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  } catch (e) {
    log('cdp-list', false, e.message);
    return finalize();
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { log('cdp-page-target', false, 'no page target'); return finalize(); }

  const ws = await wsConnect(page.webSocketDebuggerUrl);
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });
  log('cdp-connect', true, page.url.slice(0, 80));

  // 2. Enable runtime + page
  await sendCmd(ws, 'Runtime.enable');
  await sendCmd(ws, 'Page.enable');
  const consoleErrors = [];
  const pageErrors = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const txt = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
      consoleErrors.push(txt);
      RESULTS.errors.push({ kind: 'console.error', text: txt, at: new Date().toISOString() });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const txt = (msg.params.exceptionDetails && msg.params.exceptionDetails.text) || 'exception';
      pageErrors.push(txt);
      RESULTS.errors.push({ kind: 'page.error', text: txt, at: new Date().toISOString() });
    }
  });

  // 3. Navigate to workspace
  log('navigate', false, 'navigating...');
  const nav = sendCmd(ws, 'Page.navigate', { url: BASE + '/workspace' });
  // Wait for load event via simple sleep; workspace takes 15-18s SSR
  await sleep(6000);
  await nav.catch(() => {});

  // Poll for hydrated content
  let hydrated = false;
  for (let i = 0; i < 40; i++) {
    const res = await sendCmd(ws, 'Runtime.evaluate', {
      expression: `document.readyState + '|' + (document.querySelector('#workspace-root, main, [data-workspace]') ? 'content' : 'no-content') + '|' + document.title`,
      returnByValue: true,
    });
    const v = res.result && res.result.value ? String(res.result.value) : '';
    if (v.includes('content')) { hydrated = true; break; }
    await sleep(1000);
  }
  log('workspace-render', hydrated, hydrated ? 'content mounted' : 'no content after 46s');

  // 4. Collect clickable elements and click through
  const clickRes = await sendCmd(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const sels = ['button', 'a[href]', '[role=button]', '[role=tab]', 'input[type=checkbox]', 'select'];
      const el = [];
      document.querySelectorAll(sels.join(',')).forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          el.push({ tag: e.tagName, text: (e.innerText || e.value || '').trim().slice(0, 40), href: e.getAttribute('href') || '', cls: (e.className || '').toString().slice(0, 40) });
        }
      });
      return JSON.stringify(el.slice(0, 200));
    })()`,
    returnByValue: true,
  });
  let clickable = [];
  try { clickable = JSON.parse(clickRes.result.value || '[]'); } catch (e) {}
  log('collect-clickable', clickable.length > 0, clickable.length + ' elements');

  let clicksOk = 0;
  const navDests = new Set();
  for (let i = 0; i < Math.min(clickable.length, 60); i++) {
    const el = clickable[i];
    if (!el.text && !el.href) continue;
    const expr = `(() => {
      const els = [...document.querySelectorAll('button,a[href],[role=button],[role=tab]')];
      const target = els.find((e) => (e.innerText || e.value || '').trim().slice(0, 40) === ${JSON.stringify(el.text)} && (e.getAttribute('href') || '') === ${JSON.stringify(el.href)});
      if (!target) return 'no-match';
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return 'hidden';
      target.click();
      return 'clicked';
    })()`;
    const res = await sendCmd(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }).catch(() => null);
    const v = res && res.result && res.result.value ? String(res.result.value) : 'err';
    if (v === 'clicked') clicksOk++;
    await sleep(120);
  }
  log('click-storm', clicksOk > 0, clicksOk + ' clicks executed');

  // 5. Screenshot
  try {
    const shot = await sendCmd(ws, 'Page.captureScreenshot', { format: 'png' });
    const p = path.join(OUT, 'real-user-workspace.png');
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'));
    RESULTS.screenshots.push(p);
    log('screenshot', true, p);
  } catch (e) { log('screenshot', false, e.message); }

  // 6. Summary
  RESULTS.consoleErrors = consoleErrors;
  RESULTS.pageErrors = pageErrors;
  RESULTS.finishedAt = new Date().toISOString();
  RESULTS.summary = {
    stepsTotal: RESULTS.steps.length,
    stepsOk: RESULTS.steps.filter((s) => s.ok).length,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    clicksOk,
  };
  log('summary', true, JSON.stringify(RESULTS.summary));
  finalize();
}

function finalize() {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, 'real-user-report.json');
  fs.writeFileSync(p, JSON.stringify(RESULTS, null, 2));
  console.log('Report: ' + p);
  process.exit(RESULTS.errors.length > 0 && RESULTS.summary && RESULTS.summary.pageErrors > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); finalize(); });
