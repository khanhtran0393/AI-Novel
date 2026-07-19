const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const http = require('http');

const durable = require('./electron/durableStore');
const credentialVault = require('./electron/credentialVault');
const {
  isExactOriginUrl,
  isTrustedNavigationUrl,
} = require('./electron/securityPolicy');
const { ZUSTAND_STORE_KEY } = durable;
const appUpdater = require('./electron/updater');

const STABLE_PORT = Number(process.env.AI_NOVEL_PORT || process.env.PORT || 3000);
const dev = !app.isPackaged;
const appDir = app.getAppPath();
const preloadPath = path.join(appDir, 'preload.js');

// ─── Single-instance (triêt để: cấm 2 Electron → kill cổng / exit 1) ───
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[Startup] Instance khác đang chạy — thoát 0 (focus cửa sổ cũ).');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let backupInterval = null;
let paths = null;
let lastGoodRaw = null;
let pendingWrite = null;
let writeTimer = null;
/** Next.js HTTP server — must close on quit or Node keeps CMD/process alive */
let httpServer = null;
let isQuitting = false;
/** 0 = đóng cửa sổ bình thường; 1+ = lỗi (bat hiện "thoat ma loi") */
let exitCode = 0;
/** true nếu server HTTP do instance này tạo (chỉ kill port khi ta sở hữu) */
let ownsHttpServer = false;
const trustedInternalDataUrls = new Set();

function crashLogPath() {
  try {
    return path.join(app.getPath('userData'), 'electron-crash.log');
  } catch {
    return path.join(appDir, 'electron-crash.log');
  }
}

function appendCrashLog(line) {
  try {
    const p = crashLogPath();
    fs.appendFileSync(
      p,
      `[${new Date().toISOString()}] ${line}\n`,
      'utf8',
    );
  } catch {
    /* ignore */
  }
  console.error(line);
}

process.on('uncaughtException', (err) => {
  exitCode = 1;
  appendCrashLog(
    `[uncaughtException] ${err?.stack || err?.message || String(err)}`,
  );
});
process.on('unhandledRejection', (reason) => {
  exitCode = 1;
  appendCrashLog(
    `[unhandledRejection] ${reason instanceof Error ? reason.stack : String(reason)}`,
  );
});

function shutdownHttpServer() {
  if (!httpServer) return;
  try {
    httpServer.close();
  } catch {
    /* ignore */
  }
  httpServer = null;
}

/** Full teardown so parent `npm` / CMD exits when user closes the window */
function quitAppFully(reason) {
  if (isQuitting) return;
  isQuitting = true;
  if (reason) console.log(`[Shutdown] ${reason}`);
  try {
    flushPending();
  } catch {
    /* ignore */
  }
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  shutdownHttpServer();
  // Always free desktop port on full quit so next Khoi_Dong is clean
  // (covers adopt-mode orphan Next left on :3000)
  try {
    killProcessOnPort(STABLE_PORT);
  } catch {
    /* ignore */
  }
  try {
    app.quit();
  } catch {
    /* ignore */
  }
  // Hard exit if event loop still held (Next/server/timers)
  setTimeout(() => {
    try {
      process.exit(typeof exitCode === 'number' ? exitCode : 0);
    } catch {
      /* ignore */
    }
  }, 800);
}

/** Load KEY=VAL env file into process.env (does not override existing). */
function loadEnvFile(filePath, allowedKeys = null) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      if (allowedKeys && !allowedKeys.has(k)) continue;
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* ignore */
  }
}

function ensureEnv() {
  const runtimeRoot = app.isPackaged && process.resourcesPath
    ? process.resourcesPath
    : appDir;
  try {
    process.chdir(runtimeRoot);
  } catch {
    // ignore
  }
  process.env.AI_NOVEL_ROOT = runtimeRoot;
  process.env.INIT_CWD = runtimeRoot;
  try {
    process.env.AI_NOVEL_USER_DATA = app.getPath('userData');
  } catch {
    // ignore
  }
  // Dev/unpacked: load .env* so Telegram bot + Supabase reach the Next process
  if (!app.isPackaged) {
    loadEnvFile(path.join(appDir, '.env'));
    loadEnvFile(path.join(appDir, '.env.local'));
  }

  // Packaged desktop = publish posture. License mode is FORCED enforce:
  // ignore pre-set process env and customer .env.commercial (G1 close).
  if (app.isPackaged) {
    process.env.AI_NOVEL_PACKAGED = '1';
    process.env.AINOVEL_PUBLISH = '1';
    process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
    // Customer config: public endpoints/switches only — never mode / local-trial escape.
    const customerEnvKeys = new Set([
      'AINOVEL_LICENSE_API_URL',
      'AINOVEL_TRIAL_ENABLED',
      'AINOVEL_TRIAL_DAYS',
      'AINOVEL_UPDATE_CHANNEL',
      'AINOVEL_UPDATE_FEED_URL',
      'AINOVEL_UPDATE_CHECK_ON_LAUNCH',
      'AINOVEL_UPDATE_ALLOW_PRERELEASE',
    ]);
    try {
      const commercialEnv = path.join(app.getPath('userData'), '.env.commercial');
      loadEnvFile(commercialEnv, customerEnvKeys);
    } catch {
      // ignore
    }
    // Bundled public defaults (loadEnvFile never overwrites already-set keys).
    loadEnvFile(
      path.join(runtimeRoot, 'commercial', 'public.env'),
      customerEnvKeys,
    );
    // Re-assert after any env file load (belt against whitelist mistakes).
    process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
    process.env.AINOVEL_ALLOW_LOCAL_TRIAL = '0';

    // Seller/admin credentials must never be present in the installed client,
    // including values inherited from a machine-wide environment.
    for (const key of [
      'AINOVEL_ENTITLEMENT_SECRET',
      'AINOVEL_ENTITLEMENT_PUBLIC_KEY',
      'AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE',
      'AINOVEL_ENTITLEMENT_PUBLIC_KEYS',
      'AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR',
      'AINOVEL_ENTITLEMENT_PRIVATE_KEY',
      'AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE',
      'AINOVEL_ENTITLEMENT_ADMIN_KEY',
      'AINOVEL_PAYMENT_WEBHOOK_SECRET',
      'AINOVEL_TELEGRAM_BOT_TOKEN',
      'AINOVEL_TELEGRAM_WEBHOOK_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'AINOVEL_OWNER_UNLIMITED',
    ]) {
      delete process.env[key];
    }
    const publicKeysDir = path.join(runtimeRoot, 'license', 'public-keys');
    process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = publicKeysDir;
  }
}

function initPaths() {
  paths = durable.getPaths(app.getPath('userData'), process.env.AI_NOVEL_ROOT || appDir);
  return paths;
}

function pidsListeningOnPort(port) {
  if (process.platform !== 'win32') return [];
  try {
    // Pure netstat (no shell pipe) — tránh nháy cửa sổ cmd/node khi boot
    const output = execSync('netstat -ano', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
    });
    const pids = new Set();
    const rePort = new RegExp(`:${port}\\s`);
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      // Match :3000 specifically (avoid :30000)
      if (!rePort.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid > 0 && pid !== process.pid) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killProcessOnPort(port, { excludeSelfTree = true } = {}) {
  if (process.platform !== 'win32') return;
  const pids = pidsListeningOnPort(port);
  for (const pid of pids) {
    if (excludeSelfTree && pid === process.pid) continue;
    try {
      console.log(`[Port] taskkill PID ${pid} (port ${port})`);
      execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

/** GET health probe — true if our Next is already healthy on port. */
function probeLocalHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/health/runtime',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      resolve(false);
    });
  });
}

/**
 * Free port only when needed. Prefer adopt healthy server over kill thrash.
 * Returns: 'free' | 'adopt' (caller should loadURL only, not re-listen)
 */
async function ensurePortReady(port) {
  const pids = pidsListeningOnPort(port);
  if (!pids.length) return 'free';

  const healthy = await probeLocalHealth(port);
  if (healthy) {
    console.log(
      `[Port] :${port} already healthy (PIDs ${pids.join(',')}) — adopt, no kill`,
    );
    return 'adopt';
  }

  console.log(
    `[Port] :${port} occupied by ${pids.join(',')} but unhealthy — freeing…`,
  );
  killProcessOnPort(port);
  // brief settle
  await new Promise((r) => setTimeout(r, 400));
  return 'free';
}

function commitWrite(raw, { history = true, force = false } = {}) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'empty' };
  if (!paths) initPaths();

  const summary = durable.scorePersistedStore(raw);
  if (summary.score <= 0 && !force) return { ok: false, error: 'score_zero', summary };

  if (lastGoodRaw && !force) {
    const prev = durable.scorePersistedStore(lastGoodRaw);
    if (durable.isCatastrophicWipe(prev.score, summary.score)) {
      console.warn('[DurableStore] Chặn ghi wipe:', summary.score, '<', prev.score);
      return { ok: false, error: 'blocked_wipe', summary: prev };
    }
  }

  const result = durable.writeAll(paths, raw, { history });
  if (result.ok) {
    lastGoodRaw = raw;
    console.log(
      `[DurableStore] Saved score=${result.summary.score} keys=${result.summary.keyCount} chars=${result.summary.chapterContentChars} → ${result.primary}`,
    );
  }
  return result;
}

function scheduleWrite(raw) {
  pendingWrite = raw;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (pendingWrite) {
      commitWrite(pendingWrite, { history: true });
      pendingWrite = null;
    }
  }, 400);
}

function flushPending() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrite) {
    const raw = pendingWrite;
    pendingWrite = null;
    return commitWrite(raw, { history: true });
  }
  return { ok: true, skipped: true };
}

/**
 * Boot recovery: disk multi-path + LevelDB binary scan.
 * Returns best payload for preload to inject into localStorage.
 */
function resolveBootStore() {
  if (!paths) initPaths();

  const diskBest = durable.readBest(paths);
  const levelDbBest = durable.recoverFromLevelDb(app.getPath('userData'));

  const best = durable.pickBestAmong([
    diskBest
      ? { raw: diskBest.raw, summary: diskBest.summary, source: diskBest.source, mtimeMs: diskBest.mtimeMs }
      : null,
    levelDbBest
      ? {
          raw: levelDbBest.raw,
          summary: levelDbBest.summary,
          source: levelDbBest.source,
          mtimeMs: levelDbBest.mtimeMs,
        }
      : null,
    lastGoodRaw
      ? {
          raw: lastGoodRaw,
          summary: durable.scorePersistedStore(lastGoodRaw),
          source: 'memory',
          mtimeMs: Date.now(),
        }
      : null,
  ]);

  if (best?.raw) {
    const safeRaw = credentialVault.migrateFromRaw(
      app.getPath('userData'),
      best.raw,
      paths.secrets,
    );
    const safeSummary = durable.scorePersistedStore(safeRaw);
    lastGoodRaw = safeRaw;
    // Ensure multi-path mirrors exist even if we recovered from LevelDB only
    commitWrite(safeRaw, { history: false, force: false });
    return {
      raw: safeRaw,
      summary: safeSummary,
      source: best.source,
      paths: {
        primary: paths.primary,
        documents: paths.documents,
        secrets: paths.secrets,
      },
    };
  }

  return {
    raw: null,
    summary: { score: 0 },
    source: null,
    paths: {
      primary: paths.primary,
      documents: paths.documents,
      secrets: paths.secrets,
    },
  };
}

function isTrustedIpcEvent(event) {
  try {
    if (!event?.sender || !mainWindow || mainWindow.isDestroyed()) return false;
    if (event.sender.id !== mainWindow.webContents.id) return false;
    const url = event.senderFrame?.url || event.sender.getURL() || '';
    const localOrigin = `http://127.0.0.1:${STABLE_PORT}`;
    return isExactOriginUrl(url, localOrigin);
  } catch {
    return false;
  }
}

function assertTrustedIpc(event) {
  if (!isTrustedIpcEvent(event)) throw new Error('Untrusted IPC sender');
}

function registerIpc() {
  ipcMain.on('ainovel-credentials-migrate-raw', (event, raw) => {
    try {
      assertTrustedIpc(event);
      event.returnValue = credentialVault.migrateFromRaw(
        app.getPath('userData'),
        typeof raw === 'string' ? raw : '',
        paths?.secrets,
      );
    } catch (err) {
      console.warn('[CredentialVault] migration failed:', err?.message || err);
      event.returnValue = durable.stripSecretsFromRaw(typeof raw === 'string' ? raw : '');
    }
  });

  ipcMain.on('ainovel-credentials-get-sync', (event) => {
    try {
      assertTrustedIpc(event);
      event.returnValue = credentialVault.read(app.getPath('userData'));
    } catch {
      event.returnValue = {};
    }
  });

  ipcMain.handle('ainovel-credentials-get', async (event) => {
    assertTrustedIpc(event);
    return credentialVault.read(app.getPath('userData'));
  },
  );

  ipcMain.handle('ainovel-credentials-set', async (event, credentials) => {
    assertTrustedIpc(event);
    return credentialVault.write(app.getPath('userData'), credentials);
  },
  );

  ipcMain.on('ainovel-persist-boot', (event) => {
    try {
      assertTrustedIpc(event);
      event.returnValue = resolveBootStore();
    } catch (err) {
      console.warn('[DurableStore] boot failed:', err?.message || err);
      event.returnValue = { raw: null, summary: { score: 0 }, source: null, paths: null };
    }
  });

  ipcMain.on('renderer-error', (event, errorStack) => {
    if (!isTrustedIpcEvent(event)) return;
    appendCrashLog(`[Renderer] ${errorStack}`);
  });

  ipcMain.on('ainovel-persist-get-sync', (event) => {
    try {
      assertTrustedIpc(event);
      const boot = resolveBootStore();
      event.returnValue = boot.raw;
    } catch {
      event.returnValue = lastGoodRaw;
    }
  });

  ipcMain.on('ainovel-persist-set-sync', (event, raw) => {
    try {
      assertTrustedIpc(event);
      event.returnValue = commitWrite(raw, { history: true });
    } catch (err) {
      event.returnValue = { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.on('ainovel-persist-set', (event, raw) => {
    if (!isTrustedIpcEvent(event)) return;
    scheduleWrite(raw);
  });

  ipcMain.handle('ainovel-persist-set', async (event, raw) => {
    assertTrustedIpc(event);
    return commitWrite(raw, { history: true });
  });

  ipcMain.handle('ainovel-persist-flush', async (event) => {
    assertTrustedIpc(event);
    return flushPending();
  });

  ipcMain.handle('ainovel-persist-paths', async (event) => {
    assertTrustedIpc(event);
    if (!paths) initPaths();
    return paths;
  });

  // --- Text reports + TTS chapter queue snapshot (userData) ---
  ipcMain.handle('ainovel-write-text-file', async (event, payload) => {
    try {
      assertTrustedIpc(event);
      const userData = app.getPath('userData');
      const subdir = String(payload?.subdir || 'reports').replace(/[^a-zA-Z0-9_-]/g, '') || 'reports';
      const name = path.basename(String(payload?.relativePath || 'report.txt'));
      const dir = path.join(userData, subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, name);
      fs.writeFileSync(full, String(payload?.content ?? ''), 'utf8');
      console.log('[ainovelTools] wrote', full);
      return { ok: true, path: full };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('ainovel-tts-queue-set', async (event, snapshot) => {
    try {
      assertTrustedIpc(event);
      const userData = app.getPath('userData');
      const full = path.join(userData, 'tts-chapter-queue.json');
      fs.writeFileSync(full, JSON.stringify(snapshot ?? {}, null, 2), 'utf8');
      return { ok: true, path: full };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('ainovel-tts-queue-get', async (event) => {
    try {
      assertTrustedIpc(event);
      const userData = app.getPath('userData');
      const full = path.join(userData, 'tts-chapter-queue.json');
      if (!fs.existsSync(full)) return null;
      const raw = fs.readFileSync(full, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  ipcMain.handle('ainovel-open-path', async (event, targetPath) => {
    try {
      assertTrustedIpc(event);
      const { shell } = require('electron');
      const fs = require('fs');
      if (!targetPath || typeof targetPath !== 'string') {
        return { ok: false, error: 'empty path' };
      }
      const p = path.resolve(String(targetPath).trim());
      if (!p || p.includes('\0')) return { ok: false, error: 'empty path' };

      // Soft path policy: allow project/userData roots + absolute user media;
      // block sensitive Windows system locations.
      if (!isAllowedShellOpenPath(p)) {
        return { ok: false, error: 'path not allowed' };
      }

      // Directories → openPath; files → reveal in folder
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          const errMsg = await shell.openPath(p);
          if (errMsg) return { ok: false, error: errMsg };
          return { ok: true, opened: p };
        }
      } catch {
        /* fall through to showItemInFolder */
      }

      await shell.showItemInFolder(p);
      return { ok: true, opened: p };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

/** Reject shell-open into system-protected trees; allow user project/media paths. */
function isAllowedShellOpenPath(absolutePath) {
  try {
    const resolved = path.resolve(absolutePath);
    if (!path.isAbsolute(resolved)) return false;
    const lower = resolved.toLowerCase();
    const blocked = [
      `${path.sep}windows${path.sep}system32`,
      `${path.sep}windows${path.sep}syswow64`,
      `${path.sep}program files${path.sep}windowsapps`,
      `${path.sep}windows${path.sep}winsxs`,
    ];
    if (blocked.some((b) => lower.includes(b.toLowerCase()))) return false;

    const roots = [];
    try {
      roots.push(app.getPath('userData'));
    } catch {
      /* ignore */
    }
    try {
      roots.push(app.getPath('documents'));
      roots.push(app.getPath('desktop'));
      roots.push(app.getPath('downloads'));
      roots.push(app.getPath('videos'));
      roots.push(app.getPath('music'));
      roots.push(app.getPath('pictures'));
    } catch {
      /* ignore */
    }
    if (appDir) roots.push(appDir);
    if (process.env.AI_NOVEL_ROOT) roots.push(process.env.AI_NOVEL_ROOT);
    if (process.env.AI_NOVEL_USER_DATA) roots.push(process.env.AI_NOVEL_USER_DATA);

    for (const root of roots) {
      if (!root) continue;
      const r = path.resolve(root);
      if (resolved === r || resolved.startsWith(r + path.sep)) return true;
    }
    // User-chosen media/output dirs (D:\, custom drives) — absolute non-system only
    return true;
  } catch {
    return false;
  }
}

async function snapshotFromRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const raw = await mainWindow.webContents.executeJavaScript(
      `localStorage.getItem(${JSON.stringify(ZUSTAND_STORE_KEY)})`,
      true,
    );
    if (raw && durable.scorePersistedStore(raw).score > 0) {
      commitWrite(raw, { history: false });
    }
  } catch (err) {
    console.warn('[DurableStore] renderer snapshot failed:', err?.message || err);
  }
}

async function restoreIntoRendererIfNeeded() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const currentRaw = await mainWindow.webContents.executeJavaScript(
      `localStorage.getItem(${JSON.stringify(ZUSTAND_STORE_KEY)})`,
      true,
    );
    const currentScore = durable.scorePersistedStore(currentRaw).score;
    const boot = resolveBootStore();
    if (!boot.raw) return;
    if (boot.summary.score <= currentScore) return;

    console.log(
      `[Recovery] Inject store (${boot.source}) score ${boot.summary.score} > local ${currentScore}`,
    );
    await mainWindow.webContents.executeJavaScript(`
      (() => {
        localStorage.setItem(${JSON.stringify(ZUSTAND_STORE_KEY)}, ${JSON.stringify(boot.raw)});
        location.reload();
      })();
    `);
  } catch (err) {
    console.warn('[Recovery] restoreIntoRenderer failed:', err?.message || err);
  }
}

// --- Startup (single-instance already acquired above) ---
// Do NOT kill port here — wait for ensurePortReady after app ready
ensureEnv();

try {
  initPaths();
} catch {
  // will init on ready
}

const nextApp = next({ dev, dir: appDir });
const handle = nextApp.getRequestHandler();

/**
 * True if window is usable on a display: ≥40% of area intersects that workArea
 * (catches ghost bounds on disconnected secondary monitors — classic "app không lên").
 */
function isBoundsMostlyOnWorkArea(bounds, wa) {
  const left = Math.max(bounds.x, wa.x);
  const top = Math.max(bounds.y, wa.y);
  const right = Math.min(bounds.x + bounds.width, wa.x + wa.width);
  const bottom = Math.min(bounds.y + bounds.height, wa.y + wa.height);
  const interW = Math.max(0, right - left);
  const interH = Math.max(0, bottom - top);
  const interArea = interW * interH;
  const winArea = Math.max(1, (bounds.width || 1) * (bounds.height || 1));
  return interArea / winArea >= 0.4;
}

/** True if window has enough visible area on ANY connected display. */
function isWindowOnAnyDisplay(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    const { screen } = require('electron');
    const b = win.getBounds();
    return screen.getAllDisplays().some((d) => isBoundsMostlyOnWorkArea(b, d.workArea));
  } catch {
    return true;
  }
}

/**
 * Place window on primary workArea (center).
 * @param {Electron.BrowserWindow} win
 * @param {{ force?: boolean }} [opts] force=true → always center (boot only).
 *   Default: only move when off-screen — setBounds thrash kills click hit-testing.
 */
function placeWindowOnPrimary(win, opts = {}) {
  if (!win || win.isDestroyed()) return;
  const force = !!opts.force;
  try {
    if (!force && isWindowOnAnyDisplay(win)) {
      return; // leave user drag position alone — do NOT recenter every focus/load
    }

    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const b = win.getBounds();
    const w = Math.min(Math.max(b.width || 1400, 1024), Math.max(800, wa.width - 16));
    const h = Math.min(Math.max(b.height || 900, 768), Math.max(600, wa.height - 16));
    const x = Math.round(wa.x + Math.max(0, (wa.width - w) / 2));
    const y = Math.round(wa.y + Math.max(0, (wa.height - h) / 2));
    console.log(
      `[Window] pin primary force=${force} from=${JSON.stringify(b)} → ${x},${y} ${w}x${h}`,
    );
    win.setBounds({ x, y, width: w, height: h }, false);

    const after = win.getBounds();
    if (!isBoundsMostlyOnWorkArea(after, wa)) {
      console.warn(
        `[Window] still off primary after center bounds=${JSON.stringify(after)} — pin corner`,
      );
      win.setBounds(
        {
          x: wa.x + 40,
          y: wa.y + 40,
          width: Math.min(1400, wa.width - 80),
          height: Math.min(900, wa.height - 80),
        },
        false,
      );
    }
  } catch (e) {
    console.warn('[Window] placeOnPrimary failed:', e?.message || e);
    try {
      win.center();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Focus main window.
 * @param {{ forcePlace?: boolean, flashTop?: boolean }} [opts]
 *   forcePlace — recenter (boot / second-instance only)
 *   flashTop — brief alwaysOnTop (second-instance only; thrash breaks clicks)
 */
function focusMainWindow(opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const forcePlace = !!opts.forcePlace;
  const flashTop = opts.flashTop !== false && !!opts.forcePlace;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    // Only move when off-screen (or forced). Continuous setBounds → "GUI không click được".
    placeWindowOnPrimary(mainWindow, { force: forcePlace });
    mainWindow.show();
    mainWindow.focus();
    if (flashTop) {
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
          }
        } catch {
          /* ignore */
        }
      }, 800);
    } else {
      // Ensure we never leave alwaysOnTop stuck from a previous flash
      try {
        mainWindow.setAlwaysOnTop(false);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[Window] focus failed:', e?.message || e);
  }
}

const BOOT_SPLASH_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>AI Novel — Đang khởi động</title>
<style>
  html,body{margin:0;height:100%;background:#050505;color:#fbbf24;font-family:system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}
  .spin{width:64px;height:64px;border:4px solid #451a03;border-top-color:#f59e0b;border-radius:50%;
    animation:s 0.9s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  p{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#a1a1aa}
</style></head>
<body>
  <div class="spin"></div>
  <h1 style="font-size:18px;font-weight:600;margin:0;color:#f4f4f5">AI Novel Generator</h1>
  <p id="msg">Đang mở máy chủ nội bộ…</p>
  <script>
    // Visual only — main will navigate to /workspace when ready
  </script>
</body></html>`)}`;
trustedInternalDataUrls.add(BOOT_SPLASH_HTML);

function createMainWindow(opts = {}) {
  const { loadApp = false } = opts;

  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow({ forcePlace: false, flashTop: false });
    if (loadApp) {
      loadWorkspaceUrl();
    }
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'AI Novel & Script Generator',
    frame: false,
    transparent: false,
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    show: false, // show after place + ready-to-show
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:ainovel-v1',
      spellcheck: false,
      // Packaged: no DevTools (L4). Dev/unpacked keeps tools for CISO debug.
      devTools: !app.isPackaged,
      // Dev Next on localhost
      webSecurity: true,
    },
  });

  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toUpperCase();
      if (
        key === 'F12' ||
        (input.control && input.shift && (key === 'I' || key === 'J' || key === 'C'))
      ) {
        event.preventDefault();
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (/^https:\/\//i.test(url)) {
        const { shell } = require('electron');
        void shell.openExternal(url);
      }
    } catch {
      // deny below
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localOrigin = `http://127.0.0.1:${STABLE_PORT}`;
    if (!isTrustedNavigationUrl(url, localOrigin, trustedInternalDataUrls)) {
      event.preventDefault();
    }
  });

  // Boot only: force onto primary (multi-monitor ghost bounds)
  placeWindowOnPrimary(mainWindow, { force: true });

  mainWindow.once('ready-to-show', () => {
    focusMainWindow({ forcePlace: false, flashTop: false });
  });
  // Fallback if ready-to-show never fires — soft (no setBounds thrash)
  setTimeout(() => focusMainWindow({ forcePlace: false, flashTop: false }), 800);

  if (!createMainWindow._ipcBound) {
    createMainWindow._ipcBound = true;
    ipcMain.on('window-minimize', (event) => {
      if (!isTrustedIpcEvent(event)) return;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });
    ipcMain.on('window-maximize', (event) => {
      if (!isTrustedIpcEvent(event)) return;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on('window-close', (event) => {
      if (!isTrustedIpcEvent(event)) return;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
    // Auto-update IPC (packaged + feed URL)
    ipcMain.handle('ainovel-update-status', async (event) => {
      assertTrustedIpc(event);
      return appUpdater.getStatus();
    });
    ipcMain.handle('ainovel-update-check', async (event) => {
      assertTrustedIpc(event);
      return appUpdater.checkForUpdates();
    });
    ipcMain.handle('ainovel-update-download', async (event) => {
      assertTrustedIpc(event);
      return appUpdater.downloadUpdate();
    });
    ipcMain.handle('ainovel-update-install', async (event) => {
      assertTrustedIpc(event);
      return appUpdater.quitAndInstall();
    });
  }

  // Always start with local splash so user never stares at empty void
  mainWindow.loadURL(BOOT_SPLASH_HTML).catch((e) => {
    appendCrashLog(`[splash load] ${e?.message || e}`);
  });

  if (loadApp) {
    // slight delay so splash paints first
    setTimeout(() => loadWorkspaceUrl(), 200);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow?.webContents?.getURL?.() || '';
    console.log('[Window] did-finish-load', url.slice(0, 120));
    // Soft ensure only if off-screen — NEVER force-recenter on every navigation
    // (setBounds + alwaysOnTop thrash makes UI "không click được")
    placeWindowOnPrimary(mainWindow, { force: false });
    if (url.includes('/workspace') || url.includes('localhost') || url.includes('127.0.0.1')) {
      restoreIntoRendererIfNeeded().catch(() => undefined);
      setTimeout(() => snapshotFromRenderer(), 2000);
      setTimeout(() => snapshotFromRenderer(), 8000);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    appendCrashLog(`[did-fail-load] code=${code} ${desc} url=${url}`);
    // Retry workspace a few times (Next still compiling)
    if (!createMainWindow._failRetries) createMainWindow._failRetries = 0;
    if (createMainWindow._failRetries < 8) {
      createMainWindow._failRetries += 1;
      const delay = 1000 * createMainWindow._failRetries;
      console.warn(
        `[Window] reload workspace in ${delay}ms (retry ${createMainWindow._failRetries})`,
      );
      setTimeout(() => loadWorkspaceUrl(), delay);
    }
  });

  if (!backupInterval) {
    backupInterval = setInterval(() => {
      snapshotFromRenderer();
      flushPending();
    }, 30_000);
  }

  mainWindow.on('close', () => {
    try {
      flushPending();
    } catch {
      /* ignore */
    }
    snapshotFromRenderer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
      exitCode = 0;
      quitAppFully('main window closed');
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    exitCode = 1;
    appendCrashLog(
      `[render-process-gone] reason=${details?.reason} exitCode=${details?.exitCode}`,
    );
  });
  mainWindow.webContents.on('unresponsive', () => {
    appendCrashLog('[renderer unresponsive]');
  });

  return mainWindow;
}

/** Navigate to workspace (skip `/` spinner redirect which often sticks in Electron). */
function loadWorkspaceUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const url = `http://127.0.0.1:${STABLE_PORT}/workspace`;
  console.log('[Window] loadURL', url);
  mainWindow
    .loadURL(url)
    .then(() => {
      // Soft focus only — page load must not move window under cursor
      focusMainWindow({ forcePlace: false, flashTop: false });
    })
    .catch((e) => {
      appendCrashLog(`[loadURL workspace] ${e?.message || e}`);
    });
}

app.on('second-instance', () => {
  console.log('[Startup] second-instance → focus existing window');
  if (mainWindow && !mainWindow.isDestroyed()) {
    // User double-launched bat: bring to front + ensure visible
    focusMainWindow({ forcePlace: true, flashTop: true });
  } else {
    createMainWindow({ loadApp: true });
  }
});

app.whenReady().then(async () => {
  ensureEnv();
  initPaths();
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // Auto-update: only when packaged + AINOVEL_UPDATE_FEED_URL set
  try {
    appUpdater.initAutoUpdater({
      log: (s) => console.log(`[Updater] ${s}`),
    });
  } catch (e) {
    console.warn('[Updater] init skipped', e?.message || e);
  }

  const boot = resolveBootStore();
  console.log(
    `[DurableStore] Boot source=${boot.source || 'none'} score=${boot.summary?.score || 0} primary=${paths.primary}`,
  );

  // 1) Show splash GUI immediately — user never waits blind for next.prepare()
  createMainWindow({ loadApp: false });

  try {
    // Desktop: prefer clean own server (adopt can stick on half-dead orphan)
    // Only adopt if health OK AND env AI_NOVEL_ADOPT_SERVER=1
    let portMode = await ensurePortReady(STABLE_PORT);
    const allowAdopt = process.env.AI_NOVEL_ADOPT_SERVER === '1';
    if (portMode === 'adopt' && !allowAdopt) {
      console.log('[Port] healthy orphan found — free & own (stable desktop)');
      killProcessOnPort(STABLE_PORT);
      await new Promise((r) => setTimeout(r, 500));
      portMode = 'free';
    }

    if (portMode === 'adopt') {
      ownsHttpServer = false;
      console.log(`[Startup] Adopt mode — UI → /workspace`);
      loadWorkspaceUrl();
      return;
    }

    console.log('[Startup] next.prepare()… (GUI splash already visible)');
    await nextApp.prepare();

    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });
    httpServer = server;
    ownsHttpServer = true;

    server.on('error', (err) => {
      exitCode = 1;
      appendCrashLog(
        `[Startup] listen :${STABLE_PORT} failed: ${err?.stack || err?.message || err}`,
      );
      quitAppFully('server listen error');
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(STABLE_PORT, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    console.log(`Next.js local server listening on http://127.0.0.1:${STABLE_PORT}`);

    setTimeout(() => {
      const url = `http://127.0.0.1:${STABLE_PORT}/api/flow/status`;
      fetch(url, { method: 'GET', cache: 'no-store' })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          console.log(
            `[FlowBridge] bridge-only boot running=${j.running} ext=${j.extensionConnected} token=${j.flowKeyPresent}`,
          );
        })
        .catch((err) => {
          console.warn('[FlowBridge] status skip:', err?.message || err);
        });
    }, 2500);

    // Seller Telegram poller is a dev/backend facility, never a customer feature.
    if (!app.isPackaged) setTimeout(() => {
      const url = `http://127.0.0.1:${STABLE_PORT}/api/entitlement/telegram-webhook?poll=1`;
      fetch(url, { method: 'GET', cache: 'no-store' })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          console.log(
            `[Telegram] poller mode=${j.poller?.mode || j.started?.mode || '?'} configured=${j.telegramConfigured ?? j.poller?.configured}`,
          );
        })
        .catch((err) => {
          console.warn('[Telegram] poller start skip:', err?.message || err);
        });
    }, 3500);

    // 2) Navigate to workspace (skip `/` client redirect spinner)
    loadWorkspaceUrl();
  } catch (err) {
    exitCode = 1;
    appendCrashLog(
      `[Startup fatal] ${err?.stack || err?.message || String(err)}`,
    );
    // Keep window open with error text if possible
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const msg = String(err?.message || err).replace(/[<>&]/g, '');
        const errorPageUrl = `data:text/html;charset=utf-8,${encodeURIComponent(
            `<body style="background:#111;color:#f87171;font-family:sans-serif;padding:40px">
            <h1>Khởi động thất bại</h1><pre>${msg}</pre>
            <p style="color:#a1a1aa">Xem electron-crash.log trong %APPDATA%\\ai-novel-script-generator</p>
            </body>`,
          )}`;
        trustedInternalDataUrls.add(errorPageUrl);
        mainWindow.loadURL(errorPageUrl);
        focusMainWindow({ forcePlace: true, flashTop: true });
      }
    } catch {
      /* ignore */
    }
    // Delay quit so user can read error
    setTimeout(() => quitAppFully('startup fatal'), 8000);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  try {
    flushPending();
  } catch {
    // ignore
  }
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
  shutdownHttpServer();
});

app.on('window-all-closed', () => {
  try {
    flushPending();
  } catch {
    // ignore
  }
  if (process.platform !== 'darwin') {
    quitAppFully('window-all-closed');
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // macOS re-create if needed
  }
});
