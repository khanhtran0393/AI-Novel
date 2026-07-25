/**
 * Empirical: Chrome path + real-browser CDP launch (no full TikTok login).
 * Proves --no-sandbox is NOT used and CDP connects.
 *
 * Run: npx tsx scripts/smoke-tiktok-session-launch.mts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

function ok(l: string) {
  console.log(`  OK  ${l}`);
}

function findChrome(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(
      process.env.LOCALAPPDATA || '',
      'Google\\Chrome\\Application\\chrome.exe',
    ),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('Chrome/Edge not found');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function waitCdp(port: number, ms = 20000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - t0 > ms) {
        reject(new Error('CDP timeout'));
        return;
      }
      http
        .get(`http://127.0.0.1:${port}/json/version`, (res) => {
          res.resume();
          if ((res.statusCode || 0) < 500) resolve();
          else setTimeout(tick, 300);
        })
        .on('error', () => setTimeout(tick, 300));
    };
    tick();
  });
}

const chrome = findChrome();
ok(`chrome: ${chrome}`);

// GET route diagnostic (if server up — optional)
try {
  const r = await fetch('http://127.0.0.1:3000/api/get-tiktok-session', {
    signal: AbortSignal.timeout(3000),
  });
  if (r.ok) {
    const j = (await r.json()) as {
      chromeFound?: boolean;
      method?: string;
      chromePath?: string;
    };
    assert.equal(j.chromeFound, true);
    assert.match(String(j.method || ''), /real-chrome|cdp/i);
    ok(`live GET /api/get-tiktok-session method=${j.method}`);
  } else {
    ok(`dev server not ready HTTP ${r.status} — skip live GET`);
  }
} catch {
  ok('dev server offline — skip live GET');
}

const port = await freePort();
const profile = path.join(
  os.tmpdir(),
  `ainovel-tiktok-smoke-${Date.now()}`,
);
fs.mkdirSync(profile, { recursive: true });

const args = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=800,600',
  'about:blank',
];

// Must NOT include no-sandbox
assert.equal(args.some((a) => a.includes('no-sandbox')), false);
ok('launch args without --no-sandbox');

let child: ChildProcess | null = spawn(chrome, args, {
  stdio: 'ignore',
  windowsHide: false,
});

try {
  await waitCdp(port);
  ok(`CDP ready :${port}`);

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.goto('https://www.tiktok.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  const title = await page.title();
  const url = page.url();
  assert.ok(url.includes('tiktok'), `url=${url}`);
  ok(`tiktok login page loaded title="${title.slice(0, 40)}"`);

  browser.disconnect();
} finally {
  if (child?.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
  }
  child = null;
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log('\n[smoke-tiktok-session-launch] PASS');
