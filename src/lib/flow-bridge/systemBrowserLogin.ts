/**
 * System-browser login for Google Flow — ported from SuperAutoTools veo3studio
 * `systemBrowserLogin.js` (SAT_SYSTEM_LOGIN_SNAPSHOT_FIX_166).
 *
 * WHY: Playwright/Chromium builds are flagged as "browser not secure" by Google
 * accounts. Real Chrome + CDP lets the human log in reliably. Cookies are
 * written DIRECTLY into the account's Chrome profile (`accounts_data/<id>`),
 * so after the login Chrome is closed the clean Chromium + Flow extension
 * (same user-data-dir) can read the Google session, harvest the labs Bearer
 * and run reCAPTCHA — no Electron partition import needed.
 *
 * Flow:
 *   1. beginFreshProfileLogin(accountId)  → drop stale bearer for this account
 *   2. findSystemChromePath()             → real Chrome (user-initiated only)
 *   3. killChromeForProfile(profileDir)   → orphan/previous browsers on dir
 *   4. free CDP port + SingletonLock cleanup
 *   5. spawn real Chrome: --user-data-dir=<profileDir> --remote-debugging-port
 *      --remote-debugging-address=127.0.0.1 → accounts.google.com
 *   6. puppeteer.connect(browserURL) → poll auth cookies (SID/HSID/SSID/
 *      APISID/SAPISID ≥3 + __Secure-1PSID/3PSID)
 *   7. warmup myaccount.google.com (SIDCC/SIDTS settle)
 *   8. navigate labs.google/fx/tools/flow up to 5 attempts, wait
 *      __Secure-next-auth.session-token (settle 30s each)
 *   9. return success → caller relaunches clean Chromium + extension background
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'node:net';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { profileDirForAccount, accountRootDir, launchChrome } from './chromeSession';
import { resolveAccountProxyServer } from './resolveAccountProxy';

export type SystemLoginResult = {
  success: boolean;
  accountId: string;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  cookies?: number;
  authCookieNames?: string[];
  labsSession?: boolean;
  port?: number;
  chromePath?: string;
  diagnostics?: {
    exitCode?: number | null;
    signal?: string | null;
    elapsedMs?: number;
    platform?: string;
    stderrTail?: string;
  };
};

export class ChromeDedupError extends Error {
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  port: number;
  stderrTail?: string;
  constructor(opts: {
    port: number;
    exitCode: number | null;
    signal: string | null;
    elapsedMs: number;
    stderrTail?: string;
  }) {
    super(
      `Chrome process exited before debug port ${opts.port} opened (exitCode=${opts.exitCode} signal=${opts.signal ?? 'none'} elapsed=${opts.elapsedMs}ms platform=${process.platform})`,
    );
    this.name = 'ChromeDedupError';
    this.port = opts.port;
    this.exitCode = opts.exitCode;
    this.signal = opts.signal;
    this.elapsedMs = opts.elapsedMs;
    this.stderrTail = opts.stderrTail;
  }
}

/** Global registry of system-login Chrome sessions keyed by accountId. */
type SystemLoginSession = {
  proc: ChildProcess;
  browser?: import('puppeteer').Browser;
  pollHandle?: ReturnType<typeof setInterval>;
  port: number;
};
const sessions = new Map<string, SystemLoginSession>();

// ─── Port / probe helpers ──────────────────────────────────────

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object' && addr.port) {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not allocate free port')));
      }
    });
  });
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('tcp probe timeout'));
    }, timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve();
    });
    sock.once('error', (e) => {
      clearTimeout(timer);
      sock.destroy();
      reject(e);
    });
  });
}

async function waitForDebugPort(
  port: number,
  opts: {
    child?: ChildProcess;
    spawnTimeMs?: number;
    timeoutMs?: number;
    getStderrTail?: () => string;
  } = {},
): Promise<void> {
  const { child, spawnTimeMs = Date.now(), timeoutMs = 15_000 } = opts;
  let exited = false;
  let exitCode: number | null = null;
  let signal: string | null = null;
  const onExit = (code: number | null, sig: string | null) => {
    exited = true;
    exitCode = code;
    signal = sig;
  };
  child?.once('exit', onExit);
  const deadline = Date.now() + timeoutMs;
  const fail = () => {
    throw new ChromeDedupError({
      port,
      exitCode,
      signal,
      elapsedMs: Date.now() - spawnTimeMs,
      stderrTail: opts.getStderrTail?.() ?? undefined,
    });
  };
  try {
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      if (exited || child?.killed || (child && child.exitCode !== null)) fail();
      try {
        await tcpProbe('127.0.0.1', port, 500);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 500);
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: ctrl.signal,
          });
          if (resp.ok) return;
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (exited || child?.killed || (child && child.exitCode !== null)) fail();
    throw new Error(
      `Chrome debug port ${port} not ready after ${timeoutMs}ms${
        lastErr instanceof Error ? ` (last error: ${lastErr.message})` : ''
      }`,
    );
  } finally {
    child?.removeListener('exit', onExit);
  }
}

// ─── Chrome discovery (real Chrome — user-initiated login only) ─

export function findSystemChromePath(): string | null {
  const platform = process.platform;
  const candidates: string[] = [];
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(
        os.homedir(),
        'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ),
    );
  } else if (platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        console.log(`[SystemLogin] ✅ Found Chrome at: ${c}`);
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  console.warn('[SystemLogin] ⚠️ Chrome not found in standard locations');
  return null;
}

// ─── Orphan cleanup ────────────────────────────────────────────

const SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

function cleanupSingleton(profileDir: string): void {
  for (const f of SINGLETON_FILES) {
    try {
      fs.unlinkSync(path.join(profileDir, f));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Kill every Chrome process whose command line references `profileDir`.
 * Reuses the app's profile-scoped killer (never touches other accounts).
 */
function killOrphanChromeForProfile(profileDir: string): number {
  if (!profileDir) return 0;
  const { killChromeForProfile } = require('./chromeSession') as typeof import('./chromeSession');
  const killed = killChromeForProfile(profileDir);
  if (killed > 0) {
    console.log(
      `[SystemLogin] 🧹 Killed ${killed} Chrome process(es) for ${path.basename(profileDir)}`,
    );
  }
  return killed;
}

/** Gracefully close the Chrome tree so cookies WAL flushes to disk. */
async function terminateChromeTreeGraceful(
  pid: number,
  profileDir: string,
): Promise<number> {
  let killed = 0;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    killed++;
  } catch {
    /* ignore */
  }
  // Wait up to 5s for graceful exit (WAL flush)
  const { isProfileBrowserAlive } = require('./chromeSession') as typeof import('./chromeSession');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProfileBrowserAlive(profileDir)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isProfileBrowserAlive(profileDir)) {
    killed += killOrphanChromeForProfile(profileDir);
  }
  return killed;
}

// ─── Cookie checks ─────────────────────────────────────────────

const AUTH_COOKIE_NAMES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'];
const SECURE_AUTH = ['__Secure-1PSID', '__Secure-3PSID'];
const SETTLE_COOKIES = ['__Secure-1PSIDTS', '__Secure-1PSIDCC', 'SIDCC'];
const LABS_SESSION_COOKIE = '__Secure-next-auth.session-token';

function hasAuthCookies(cookies: { name: string }[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  const present = AUTH_COOKIE_NAMES.filter((n) => names.has(n)).length;
  const secure = SECURE_AUTH.some((n) => names.has(n));
  return present >= 3 && secure;
}

function hasSettledCookies(cookies: { name: string }[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return SETTLE_COOKIES.some((n) => names.has(n));
}

// ─── Main login ────────────────────────────────────────────────

export async function loginWithSystemBrowser(
  accountId: string,
  opts: {
    chromePath?: string;
    proxy?: string;
    timeoutMs?: number;
  } = {},
): Promise<SystemLoginResult> {
  const id = String(accountId || '').trim();
  if (!id) {
    return {
      success: false,
      accountId: '',
      error: 'accountId required',
      errorCode: 'BAD_REQUEST',
      retryable: false,
    };
  }

  // Reset bridge bearer state for this account (never reuse old token)
  try {
    const bridge = await import('./bridgeServer');
    bridge.beginFreshProfileLogin(id);
  } catch {
    /* ignore */
  }

  const chromePath = opts.chromePath || findSystemChromePath();
  if (!chromePath) {
    return {
      success: false,
      accountId: id,
      error: 'Chrome/Chromium not found. Please install Google Chrome.',
      errorCode: 'CHROME_NOT_FOUND',
      retryable: false,
    };
  }

  console.log(`[SystemLogin] 🚀 Launching Real Chrome for profile: ${id.slice(0, 8)}…`);
  const profileDir = profileDirForAccount(id);
  fs.mkdirSync(profileDir, { recursive: true });

  // Close any previous system-login session for this account
  try {
    closeSystemBrowserLogin(id);
  } catch {
    /* ignore */
  }

  // Kill orphans on this user-data-dir (previous clean-chromium too)
  killOrphanChromeForProfile(profileDir);
  await new Promise((r) => setTimeout(r, 1500));
  cleanupSingleton(profileDir);

  const port = await allocateFreePort();
  const args: string[] = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--disable-background-mode',
    '--window-size=1280,900',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    'https://accounts.google.com/',
  ];

  // Per-account proxy (UI) — same lane as the parasitic browser
  const proxyServer = resolveAccountProxyServer(id, opts.proxy);
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
    console.log(
      `[SystemLogin] 🌍 Launch Chrome via proxy for account=${id}: ${proxyServer.replace(/:[^:@/]+@/, ':***@')}`,
    );
  }

  let child: ChildProcess | null = null;
  let browser: import('puppeteer').Browser | null = null;
  let backgroundKillFailed = false;
  const stderrChunks: Buffer[] = [];
  let stderrSize = 0;
  const MAX_TAIL = 4096;

  try {
    const spawnAttempts = 2;
    let activePort = port;
    let stderrTail = '';
    for (let attempt = 1; attempt <= spawnAttempts; attempt++) {

      if (attempt > 1) {
        activePort = await allocateFreePort();
        const idx = args.findIndex((a) => a.startsWith('--remote-debugging-port='));
        if (idx >= 0) args[idx] = `--remote-debugging-port=${activePort}`;
      }
      console.log(
        `[SystemLogin] 🌐 Spawning Chrome (attempt ${attempt}/${spawnAttempts}) port=${activePort} userDataDir=${path.basename(profileDir)} SingletonLock=${singletonState(profileDir)}`,
      );

      const spawnTime = Date.now();
      child = spawn(chromePath, args, {
        detached: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const pid = child.pid;
      console.log(`[SystemLogin] spawned pid=${pid}`);
      stderrChunks.length = 0;
      stderrSize = 0;
      const stderr = child.stderr;
      stderr?.on('data', (d: Buffer) => {
        stderrChunks.push(d);
        stderrSize += d.length;
        while (stderrSize > MAX_TAIL && stderrChunks.length > 1) {
          stderrSize -= stderrChunks[0].length;
          stderrChunks.shift();
        }
      });
      const getTail = () => redact(Buffer.concat(stderrChunks).toString('utf8').slice(-MAX_TAIL));
      child.once('exit', (code, sig) => {
        console.log(
          `[SystemLogin:exit] pid=${pid} exitCode=${code} signal=${sig} elapsed=${Date.now() - spawnTime}ms`,
        );
      });
      try {
        await waitForDebugPort(activePort, {
          timeoutMs: 15_000,
          child,
          spawnTimeMs: spawnTime,
          getStderrTail: getTail,
        });
        stderrTail = getTail();
        break;
      } catch (e) {
        stderrTail = getTail();
        if (e instanceof ChromeDedupError && e.exitCode === 0 && attempt < spawnAttempts) {

          console.warn(
            `[SystemLogin] dedup on attempt ${attempt} (exitCode=0) — retrying after cleanup`,
          );
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (e instanceof ChromeDedupError && e.exitCode === 0 && attempt >= spawnAttempts) {

          backgroundKillFailed = true;
        }
        if (e instanceof ChromeDedupError && !e.stderrTail) {
          e.stderrTail = stderrTail;
        }
        throw e;
      }
    }

    const { connect } = await import('puppeteer');
    browser = await connect({
      browserURL: `http://127.0.0.1:${activePort}`,
      defaultViewport: null,
    });

    const page = (await browser.pages())[0] || (await browser.newPage());
    console.log('[SystemLogin] ⏳ Waiting for user to complete Google login…');

    if (!(await waitForGoogleLogin(browser, page))) {
      return {
        success: false,
        accountId: id,
        error: 'Login was cancelled or timed out (5 minutes)',
        errorCode: 'LOGIN_TIMEOUT',
        retryable: true,
      };
    }

    // Navigate Flow AI to seed labs.google session cookies
    const LABS_SESSION = '__Secure-next-auth.session-token';
    const attempts = 5;
    const settleMs = 30_000;
    const settleStepMs = 1000;
    let allCookies: { name: string; domain?: string }[] = [];
    let labsSession = false;
    const session = await page.createCDPSession();
    const getAllCookies = async () => {
      const { cookies } = await session.send('Network.getAllCookies');
      return cookies as { name: string; domain?: string }[];
    };

    for (let i = 1; i <= attempts; i++) {
      console.log(
        `[SystemLogin] 🌐 Navigating to Flow AI to seed labs.google session cookies (attempt ${i}/${attempts})…`,
      );
      try {
        await page.goto('https://labs.google/fx/tools/flow', {
          waitUntil: 'domcontentloaded',
          timeout: 60_000 + 15_000 * (i - 1),
        });
      } catch (e) {
        console.warn(
          `[SystemLogin] ⚠️ Flow AI navigation attempt ${i} failed: ${e instanceof Error ? e.message : e}`,
        );
      }
      const deadline = Date.now() + settleMs;
      while (Date.now() < deadline) {
        try {
          allCookies = await getAllCookies();
        } catch (e) {
          console.warn(
            `[SystemLogin] ⚠️ getAllCookies during settle (attempt ${i}) failed: ${e instanceof Error ? e.message : e}`,
          );
          break;
        }
        if (
          allCookies.some(
            (c) => c.name === LABS_SESSION && (c.domain ?? '').includes('labs.google'),
          )
        ) {
          labsSession = true;
          break;
        }
        await new Promise((r) => setTimeout(r, settleStepMs));
      }
      if (labsSession) break;
      console.warn(
        `[SystemLogin] ⚠️ ${LABS_SESSION} not present after settle attempt ${i} — retrying nav…`,
      );
    }
    if (labsSession) {
      try {
        allCookies = await getAllCookies();
      } catch {
        /* ignore */
      }
    }

    console.log(
      `[SystemLogin] ✅ Login flow finished — extracted ${allCookies.length} cookies`,
    );
    const authNames = allCookies
      .filter((c) => AUTH_COOKIE_NAMES.includes(c.name))
      .map((c) => c.name);
    console.log(`[SystemLogin] 🔑 Auth cookies: ${authNames.join(', ') || '(none)'}`);
    const labsList = allCookies.filter((c) => (c.domain ?? '').includes('labs.google'));
    labsSession
      ? console.log(
          `[SystemLogin] 🔑 labs.google session cookies: ${labsList.map((c) => c.name).join(', ')}`,
        )
      : console.warn(
          `[SystemLogin] ⚠️ ${LABS_SESSION} STILL missing after ${attempts} attempts — will surface LABS_SESSION_MISSING but keep Chrome + poll running so user can wait + retry.`,
        );

    // Keep the session registered for 5s cookie poll (hash-diff → re-import not
    // needed for disk-shared profile, but keep warm and allow user to fix login)
    const pollHandle = setInterval(() => {
      if (!browser || !browser.connected) {

        if (pollHandle) clearInterval(pollHandle);
        return;
      }
      try {
        syncCookies(id, browser).catch((e) =>
          console.warn(
            `[SystemLogin] login-session cookie poll failed for ${id.slice(0, 8)}: ${e instanceof Error ? e.message : e}`,
          ),
        );
      } catch {
        /* ignore */
      }
    }, 5000);
    sessions.set(id, { proc: child as ChildProcess, browser, pollHandle, port: activePort });


    browser.on('disconnected', () => {
      console.log(`[SystemLogin] Chrome closed by user for profile ${id.slice(0, 8)}`);
      clearInterval(pollHandle);
      sessions.delete(id);
    });

    return labsSession
      ? {
          success: true,
          accountId: id,
          cookies: allCookies.length,
          authCookieNames: authNames,
          labsSession: true,
          port: activePort,
          chromePath,
        }
      : {
          success: false,
          accountId: id,
          cookies: allCookies.length,
          error: `${LABS_SESSION} missing after ${attempts} attempts`,
          errorCode: 'LABS_SESSION_MISSING',
          retryable: true,
          labsSession: false,
          port: activePort,
          chromePath,
        };
  } catch (e) {
    console.error('[SystemLogin] ❌ Login error:', e instanceof Error ? e.message : e);
    if (browser) {
      try {
        browser.disconnect();
      } catch {
        /* ignore */
      }
    } else if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    const err = e instanceof Error ? e : new Error(String(e));
    const errorCode = classifyChromeError(err, backgroundKillFailed);
    const diagnostics = err instanceof ChromeDedupError ? {
      exitCode: err.exitCode,
      signal: err.signal,
      elapsedMs: err.elapsedMs,
      platform: process.platform,
      stderrTail: err.stderrTail,
    } : undefined;
    return {
      success: false,
      accountId: id,
      error: err.message,
      errorCode,
      retryable: ['CHROME_DEDUP', 'CHROME_TIMEOUT', 'CHROME_BACKGROUND_MODE', 'LABS_SESSION_MISSING'].includes(errorCode),
      diagnostics,
    };
  }
}

/** Wait (up to 5 min) for the human to complete Google login. */
async function waitForGoogleLogin(
  browser: import('puppeteer').Browser,
  page: import('puppeteer').Page,
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      clearInterval(interval);
      browser.off('disconnected', onDisconnected);
      resolve(v);
    };
    const onDisconnected = () => {
      if (done) return;
      done = true;
      clearInterval(interval);
      console.log('[SystemLogin] ⚠️ Browser was closed by user');
      resolve(false);
    };
    browser.on('disconnected', onDisconnected);
    const interval = setInterval(async () => {
      if (done) return;
      if (Date.now() - start > 300_000) {
        finish(false);
        console.log('[SystemLogin] ⏰ Login timed out (5 minutes)');
        return;
      }
      try {
        if (page.isClosed()) {
          finish(false);
          return;
        }
        const cookies = await page.cookies(
          'https://accounts.google.com',
          'https://www.google.com',
          'https://google.com',
        );
        if (hasAuthCookies(cookies)) {
          console.log('[SystemLogin] 🔑 Auth cookies detected — warming up session via myaccount.google.com…');
          try {
            await page.goto('https://myaccount.google.com/', {
              waitUntil: 'networkidle2',
              timeout: 20_000,
            });
          } catch (e) {
            console.warn(
              '[SystemLogin] ⚠️ myaccount warmup nav failed (continuing):',
              e instanceof Error ? e.message : e,
            );
          }
          const settleDeadline = Date.now() + 8000;
          let settled = false;
          while (Date.now() < settleDeadline) {
            try {
              const settleCookies = await page.cookies(
                'https://accounts.google.com',
                'https://www.google.com',
                'https://google.com',
                'https://myaccount.google.com',
              );
              if (hasSettledCookies(settleCookies)) {
                settled = true;
                console.log(
                  `[SystemLogin] ✅ Session settled in ${Date.now() - start}ms (SIDCC/SIDTS present)`,
                );
                break;
              }
            } catch {
              /* ignore */
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          if (!settled) {
            console.warn(
              `[SystemLogin] ⚠️ SIDCC/SIDTS not seen within 8s — proceeding anyway (Flow AI nav will retry)`,
            );
          }
          finish(true);
        }
      } catch {
        /* ignore — keep polling */
      }
    }, 2000);
  });
}

/** 5s cookie sync: CDP getAllCookies → profile-cookies snapshot (warm only). */
const cookieHashes = new Map<string, string>();
async function syncCookies(accountId: string, browser: import('puppeteer').Browser): Promise<void> {
  const targets = browser.targets().filter((t) => t.type() === 'page');
  if (!targets[0]) return;
  const session = await targets[0].createCDPSession();
  try {
    const { cookies } = await session.send('Network.getAllCookies');
    const hash = require('crypto')
      .createHash('sha256')
      .update((cookies as { name: string; value: string; domain: string }[])
        .map((c) => `${c.name}|${c.value}|${c.domain}`)
        .join('\n'))
      .digest('hex');
    if (hash === cookieHashes.get(accountId)) return;
    cookieHashes.set(accountId, hash);
    // Snapshot is warmup only — the real session lives in the shared profile dir.
    try {
      const root = accountRootDir(accountId);
      fs.mkdirSync(path.join(root, 'profile-cookies'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'profile-cookies', `${accountId}.json`),
        JSON.stringify(cookies as unknown[]),
        { mode: 0o600 },
      );
      console.log(
        `[SystemLogin] 🔄 Synced ${(cookies as unknown[]).length} cookies snapshot for ${accountId.slice(0, 8)}`,
      );
    } catch {
      /* ignore */
    }
  } finally {
    try {
      await session.detach();
    } catch {
      /* ignore */
    }
  }
}

/** Close the real-Chrome login session (cookies stay on disk). */
export async function closeSystemBrowserLogin(accountId: string): Promise<{
  closed: boolean;
  killed: number;
}> {
  const id = String(accountId || '').trim();
  const sess = sessions.get(id);
  sessions.delete(id);
  if (cookieHashes.has(id)) cookieHashes.delete(id);
  if (!sess) return { closed: false, killed: 0 };
  if (sess.pollHandle) clearInterval(sess.pollHandle);
  if (sess.browser) {
    try {
      sess.browser.disconnect();
    } catch {
      /* ignore */
    }
  }
  let killed = 0;
  const profileDir = profileDirForAccount(id);
  if (sess.proc && !sess.proc.killed && sess.proc.pid) {
    killed += await terminateChromeTreeGraceful(sess.proc.pid, profileDir);
  } else {
    killed += killOrphanChromeForProfile(profileDir);
  }
  cleanupSingleton(profileDir);
  console.log(
    `[SystemLogin] Real Chrome closed for ${id.slice(0, 8)} (killed=${killed})`,
  );
  return { closed: true, killed };
}

/**
 * After a successful real-Chrome login: close it and relaunch the clean
 * Chromium + Flow extension on the SAME user-data-dir (background/off-screen).
 * The extension reads the Google session, harvests labs Bearer, and the
 * bridge's token_captured handler marks the account verified.
 */
export async function completeSystemLogin(
  accountId: string,
  opts: {
    forceChrome?: boolean;
  } = {},
): Promise<{
  relaunched: boolean;
  extensionReconnect?: boolean;
  error?: string;
  chromePath?: string;
}> {
  const id = String(accountId || '').trim();
  await closeSystemBrowserLogin(id);
  await new Promise((r) => setTimeout(r, 1200));

  try {
    const { resolveBrowser } = await import('./browserResolver');
    const { sourceExtensionDir } = await import('./chromeSession');
    const profileDir = profileDirForAccount(id);
    const extDir = sourceExtensionDir();
    const browser = resolveBrowser({ engine: opts.forceChrome ? 'chrome' : 'auto' });

    const res = launchChrome({
      chromePath: browser.exe,
      extDir,
      profileDir,
      accountId: id,
      mode: 'background',
      forceClean: false,
      isStockChrome: browser.isStockChrome,
    });
    console.log(
      `[SystemLogin] 🔁 Relaunched clean browser background account=${id} exe=${browser.exe} launched=${res.launched}`,
    );

    // Wait a bit for extension to connect + capture token
    let extensionReconnect = false;
    try {
      const bridge = await import('./bridgeServer');
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const snap = bridge.getBridgeSnapshot();
        if (snap.extensionConnected && snap.flowKeyPresent) {
          extensionReconnect = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      /* ignore */
    }

    return {
      relaunched: res.launched,
      extensionReconnect,
      chromePath: browser.exe,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[SystemLogin] relaunch clean browser failed:', err.message);
    return { relaunched: false, error: err.message };
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function singletonState(profileDir: string): string {
  const lock = path.join(profileDir, 'SingletonLock');
  try {
    const st = fs.lstatSync(lock);
    if (st.isSymbolicLink()) {
      try {
        return `symlink → ${fs.readlinkSync(lock)}`;
      } catch {
        return 'symlink (target unreadable)';
      }
    }
    return `file size=${st.size} mtime=${st.mtimeMs}`;
  } catch {
    return 'absent';
  }
}

function redact(line: string): string {
  return line
    .split('\n')
    .map((ln) => {
      if (/Cookie/i.test(ln)) return '[REDACTED cookie line]';
      let out = ln.replace(/[0-9a-f]{32,}/gi, '[REDACTED]');
      out = out.replace(
        /((?:access_token|id_token|auth_token|refresh_token|token|code|state)=)[A-Za-z0-9._~+/=-]{20,}/gi,
        '$1[REDACTED]',
      );
      out = out.replace(
        /(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi,
        '$1[REDACTED]',
      );
      return out;
    })
    .join('\n');
}

function classifyChromeError(
  err: Error,
  backgroundKillFailed: boolean,
): string {
  if (err instanceof ChromeDedupError) {
    return err.exitCode !== 0
      ? 'CHROME_LAUNCH_FAILED'
      : backgroundKillFailed
        ? 'CHROME_BACKGROUND_MODE'
        : 'CHROME_DEDUP';
  }
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return 'CHROME_NOT_FOUND';
    if (code === 'EPERM' || code === 'EACCES') return 'CHROME_BLOCKED';
    if (/not ready after/i.test(err.message)) return 'CHROME_TIMEOUT';
  }
  return 'CHROME_LAUNCH_FAILED';
}

export function isSystemBrowserOpen(accountId: string): boolean {
  const sess = sessions.get(String(accountId || '').trim());
  return Boolean(sess && sess.proc && !sess.proc.killed);
}

export function listSystemBrowserSessions(): string[] {
  return [...sessions.keys()];
}
