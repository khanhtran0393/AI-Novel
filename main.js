const { app, BrowserWindow, ipcMain, session, nativeImage } = require('electron');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const http = require('http');
const os = require('os');

const durable = require('./electron/durableStore');
const credentialVault = require('./electron/credentialVault');
const {
  isExactOriginUrl,
  isTrustedNavigationUrl,
} = require('./electron/securityPolicy');
const {
  DEFAULT_SPLASH_MIN_MS,
  resolveBrandPaths,
  buildSplashDataUrl,
  createSplashGate,
} = require('./electron/splashBrand');
const { ZUSTAND_STORE_KEY } = durable;
const appUpdater = require('./electron/updater');

const STABLE_PORT = Number(process.env.AI_NOVEL_PORT || process.env.PORT || 3000);
const dev = !app.isPackaged;
const appDir = app.getAppPath();
const preloadPath = path.join(appDir, 'preload.js');

/** Brand logo splash ≥5s. Window is transparent so logo floats on desktop. */
const brandPaths = resolveBrandPaths(appDir, __dirname);
const SPLASH_MIN_MS = (() => {
  const n = Number(process.env.AINOVEL_SPLASH_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SPLASH_MIN_MS;
})();
const splashGate = createSplashGate(SPLASH_MIN_MS);
const BOOT_SPLASH_HTML = buildSplashDataUrl({
  logoPath: brandPaths.logo,
  title: 'AI Novel',
});

if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.ainovel.desktop');
  } catch {
    /* ignore */
  }
}

// ─── Single-instance (cấm 2 Electron → focus cửa sổ cũ) ───
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Second click often looks like "exe không mở" if user doesn't see the first window.
  // Notify + exit; first instance handles 'second-instance' and raises the UI.
  console.log('[Startup] Instance khác đang chạy — thoát 0 (focus cửa sổ cũ).');
  try {
    const { execFileSync } = require('child_process');
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('Ai Novel đang chạy rồi. Cửa sổ hiện có sẽ được đưa lên trên. Nếu không thấy, kiểm tra taskbar hoặc Alt+Tab.','Ai Novel', 'OK', 'Information')",
      ],
      { timeout: 12000, windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    /* ignore dialog failures */
  }
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
    // Customer may only override public endpoints — NOT host allowlist / TLS pins
    // (those come only from bundled public.env so users cannot expand pin set).
    const customerEnvKeys = new Set([
      'AINOVEL_LICENSE_API_URL',
      'AINOVEL_TRIAL_ENABLED',
      'AINOVEL_TRIAL_DAYS',
      'AINOVEL_UPDATE_CHANNEL',
      'AINOVEL_UPDATE_FEED_URL',
      'AINOVEL_UPDATE_CHECK_ON_LAUNCH',
      'AINOVEL_UPDATE_ALLOW_PRERELEASE',
    ]);
    // Seller-controlled: provider/github/unsigned + public endpoints.
    // Customer must NOT set PROVIDER / GITHUB_* / ALLOW_UNSIGNED (bundle only).
    const bundledPinKeys = new Set([
      'AINOVEL_LICENSE_API_URL',
      'AINOVEL_LICENSE_API_HOSTS',
      'AINOVEL_LICENSE_TLS_PINS',
      'AINOVEL_TRIAL_ENABLED',
      'AINOVEL_TRIAL_DAYS',
      'AINOVEL_UPDATE_CHANNEL',
      'AINOVEL_UPDATE_PROVIDER',
      'AINOVEL_UPDATE_GITHUB_OWNER',
      'AINOVEL_UPDATE_GITHUB_REPO',
      'AINOVEL_UPDATE_FEED_URL',
      'AINOVEL_UPDATE_FEED_HOSTS',
      'AINOVEL_UPDATE_CHECK_ON_LAUNCH',
      'AINOVEL_UPDATE_ALLOW_PRERELEASE',
      'AINOVEL_UPDATE_ALLOW_UNSIGNED',
    ]);
    try {
      const commercialEnv = path.join(app.getPath('userData'), '.env.commercial');
      loadEnvFile(commercialEnv, customerEnvKeys);
    } catch {
      // ignore
    }
    // Bundled public defaults (loadEnvFile never overwrites already-set keys).
    // Pin hosts / TLS pins: load bundled first for keys customer cannot set,
    // then re-apply after wipe so customer cannot inject HOSTS/PINS via machine env.
    loadEnvFile(
      path.join(runtimeRoot, 'commercial', 'public.env'),
      bundledPinKeys,
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
    // Customer must not expand pin allowlist / hijack update source via inherited env
    delete process.env.AINOVEL_LICENSE_API_HOSTS;
    delete process.env.AINOVEL_LICENSE_TLS_PINS;
    delete process.env.AINOVEL_UPDATE_FEED_HOSTS;
    delete process.env.AINOVEL_UPDATE_PROVIDER;
    delete process.env.AINOVEL_UPDATE_GITHUB_OWNER;
    delete process.env.AINOVEL_UPDATE_GITHUB_REPO;
    delete process.env.AINOVEL_UPDATE_ALLOW_UNSIGNED;
    // Re-load seller-only keys from bundle (overwrite any inherited values)
    loadEnvFile(
      path.join(runtimeRoot, 'commercial', 'public.env'),
      new Set([
        'AINOVEL_LICENSE_API_HOSTS',
        'AINOVEL_LICENSE_TLS_PINS',
        'AINOVEL_UPDATE_FEED_HOSTS',
        'AINOVEL_UPDATE_PROVIDER',
        'AINOVEL_UPDATE_GITHUB_OWNER',
        'AINOVEL_UPDATE_GITHUB_REPO',
        'AINOVEL_UPDATE_ALLOW_UNSIGNED',
      ]),
    );
    // If customer set a rogue LICENSE_API_URL, host pin rejects at runtime.
    // Prefer bundled URL when customer URL missing:
    if (!String(process.env.AINOVEL_LICENSE_API_URL || '').trim()) {
      loadEnvFile(
        path.join(runtimeRoot, 'commercial', 'public.env'),
        new Set(['AINOVEL_LICENSE_API_URL']),
      );
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
 * Serve runtime-written assets under AI_NOVEL_ROOT/public/* (TTS audio, gen media).
 * Next production only ships build-time public/ inside asar — files created after boot
 * (e.g. public/audio/*.mp3) would 404 without this bridge (white-machine TTS play path).
 */
const RUNTIME_PUBLIC_PREFIXES = [
  '/audio/',
  '/images/',
  '/video/',
  '/renders/',
  '/downloads/',
  '/watermarked/',
  '/scene-cache/',
  '/studio/',
];

function contentTypeForPublicFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function tryServeRuntimePublic(req, res, pathname) {
  if (!pathname || req.method !== 'GET' && req.method !== 'HEAD') return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  if (!RUNTIME_PUBLIC_PREFIXES.some((p) => decoded.startsWith(p))) return false;
  if (decoded.includes('..') || decoded.includes('\0')) return false;

  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const rel = decoded.replace(/^\/+/, '');
  const filePath = path.resolve(root, 'public', rel);
  const publicRoot = path.resolve(root, 'public');
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    return false;
  }
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const data = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForPublicFile(filePath));
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(data);
    }
    return true;
  } catch {
    return false;
  }
}

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

trustedInternalDataUrls.add(BOOT_SPLASH_HTML);

function enterWorkspaceWhenAllowed() {
  const st = splashGate.status();
  console.log(
    `[Splash] enter workspace minElapsed=${st.minElapsed} serverReady=${st.serverReady} shownForMs=${st.shownForMs} minMs=${st.minMs}`,
  );
  // Workspace is opaque HTML; set solid underlay for any subpixel gaps
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor('#09090b');
    }
  } catch {
    /* ignore */
  }
  loadWorkspaceUrl();
}

function requestEnterWorkspace() {
  splashGate.markServerReady(enterWorkspaceWhenAllowed);
  if (!splashGate.status().entered) {
    const st = splashGate.status();
    console.log(
      `[Splash] holding floating logo — wait min=${!st.minElapsed} server=${!st.serverReady} (${st.shownForMs}ms / ${st.minMs}ms)`,
    );
  }
}

function createMainWindow(opts = {}) {
  const { loadApp = false } = opts;

  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow({ forcePlace: false, flashTop: false });
    if (loadApp) {
      requestEnterWorkspace();
    }
    return mainWindow;
  }

  // Taskbar: Windows wants multi-size .ico (not just PNG). Prefer ICO path.
  const iconPath =
    brandPaths.iconIco || brandPaths.icon || brandPaths.iconPng || brandPaths.logo || null;
  let iconImage;
  if (iconPath) {
    try {
      iconImage = nativeImage.createFromPath(iconPath);
      if (iconImage.isEmpty() && brandPaths.iconPng) {
        iconImage = nativeImage.createFromPath(brandPaths.iconPng);
      }
      if ((!iconImage || iconImage.isEmpty()) && brandPaths.logo) {
        iconImage = nativeImage.createFromPath(brandPaths.logo);
      }
      if (iconImage && iconImage.isEmpty()) iconImage = undefined;
    } catch {
      iconImage = undefined;
    }
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'AI Novel & Script Generator',
    ...(iconImage || iconPath ? { icon: iconImage || iconPath } : {}),
    frame: false,
    // Transparent shell: boot splash = logo only floating on desktop
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
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
      backgroundThrottling: false,
    },
  });

  const applyWindowIcon = () => {
    if (!mainWindow || mainWindow.isDestroyed() || (!iconImage && !iconPath)) return;
    try {
      mainWindow.setIcon(iconImage || iconPath);
    } catch (e) {
      console.warn('[Window] setIcon failed:', e?.message || e);
    }
  };
  applyWindowIcon();
  // Re-apply after show — some Windows builds ignore icon set before first paint
  mainWindow.once('ready-to-show', () => applyWindowIcon());
  mainWindow.once('show', () => applyWindowIcon());
  console.log(
    `[Window] transparent-splash icon=${iconPath || '(none)'} logo=${brandPaths.logo || '(none)'} splashMinMs=${SPLASH_MIN_MS}`,
  );

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

  // Show ASAP — transparent splash must not wait forever for ready-to-show
  // (some GPUs/Windows builds never fire ready-to-show → "exe không mở").
  const revealSplash = () => {
    try {
      focusMainWindow({ forcePlace: false, flashTop: false });
    } catch {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      } catch {
        /* ignore */
      }
    }
  };
  mainWindow.once('ready-to-show', revealSplash);
  // Immediate + fallback reveals (portable cold boot / slow next.prepare)
  setTimeout(revealSplash, 50);
  setTimeout(revealSplash, 800);
  setTimeout(revealSplash, 2500);

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
    ipcMain.handle('ainovel-update-ack-changelog', async (event) => {
      assertTrustedIpc(event);
      if (typeof appUpdater.acknowledgeJustUpdated === 'function') {
        return appUpdater.acknowledgeJustUpdated();
      }
      return appUpdater.getStatus();
    });
  }

  // Floating logo only (transparent HTML) — min 5s before /workspace
  splashGate.arm(enterWorkspaceWhenAllowed);
  mainWindow.loadURL(BOOT_SPLASH_HTML).catch((e) => {
    appendCrashLog(`[splash load] ${e?.message || e}`);
  });

  if (loadApp) {
    requestEnterWorkspace();
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
    // User double-launched: bring to front + ensure visible (not behind / off-screen)
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
    } catch {
      /* ignore */
    }
    focusMainWindow({ forcePlace: true, flashTop: true });
  } else {
    createMainWindow({ loadApp: true });
  }
});

/**
 * Start LA Studio desktop engine hidden (API :3900 + Kokoro pack).
 * Best-effort — does not block boot if missing.
 */
function ensureLaStudioBackgroundEngine() {
  try {
    if (process.env.AINOVEL_LA_STUDIO_AUTOSTART === '0') {
      console.log('[LA Studio] autostart disabled (AINOVEL_LA_STUDIO_AUTOSTART=0)');
      return;
    }
    const settingsPath = path.join(os.homedir(), '.lastudio', 'settings.ini');
    try {
      let raw = fs.existsSync(settingsPath)
        ? fs.readFileSync(settingsPath, 'utf8')
        : '';
      const setKey = (key, value) => {
        const re = new RegExp(`^${key}=.*$`, 'mi');
        if (re.test(raw)) raw = raw.replace(re, `${key}=${value}`);
        else if (/^\[api\]/mi.test(raw)) {
          raw = raw.replace(/^\[api\][ \t]*\r?\n/mi, `[api]\n${key}=${value}\n`);
        } else {
          raw = `${raw.trimEnd()}\n\n[api]\n${key}=${value}\n`;
        }
      };
      setKey('serverEnabled', 'true');
      setKey('serverAllowLan', 'false');
      setKey('serverPort', '3900');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8');
    } catch (e) {
      console.warn('[LA Studio] settings write failed', e?.message || e);
    }

    const candidates = [
      process.env.LA_STUDIO_EXE,
      process.env.AINOVEL_LA_STUDIO_EXE,
      'D:\\LA Studio\\bin\\LA Studio.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LA Studio', 'bin', 'LA Studio.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LA Studio', 'bin', 'LA Studio.exe'),
    ].filter(Boolean);

    const exe = candidates.find((p) => p && fs.existsSync(p));
    if (!exe) {
      console.warn('[LA Studio] exe not found — skip background spawn');
      return;
    }

    /** Hide LA Studio HWND (never CloseMainWindow — that can quit the engine). */
    const hideLaStudioUi = () => {
      if (process.platform !== 'win32') return;
      try {
        const hidePs1 = path.join(os.tmpdir(), 'ainovel-la-studio', 'hide-la-studio.ps1');
        // Prefer script written by laStudioLocal; fallback write minimal once
        if (!fs.existsSync(hidePs1)) {
          fs.mkdirSync(path.dirname(hidePs1), { recursive: true });
          fs.writeFileSync(
            hidePs1,
            [
              "$ErrorActionPreference='SilentlyContinue'",
              "if(-not('Ainovel.LaHideWin'-as[type])){Add-Type -TypeDefinition @'",
              'using System;using System.Runtime.InteropServices;namespace Ainovel{public class LaHideWin{',
              'public delegate bool EnumProc(IntPtr h,IntPtr l);',
              '[DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc c,IntPtr l);',
              '[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);',
              '[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);',
              'public const int SW_HIDE=0;public const int SW_MINIMIZE=6;}}',
              "'@}",
              "$t=@(Get-Process|?{$n=[string]$_.ProcessName;$p='';try{$p=[string]$_.Path}catch{};($n -eq 'LA Studio')-or($n -eq 'LAStudio')-or($p -like '*\\LA Studio\\bin\\LA Studio.exe')})",
              '$ids=@($t|%{[int]$_.Id}|Select -Unique);if($ids.Count-lt1){exit 0}',
              '[Ainovel.LaHideWin]::EnumWindows({param($h,$l)$o=[uint32]0;[void][Ainovel.LaHideWin]::GetWindowThreadProcessId($h,[ref]$o);if($ids -contains [int]$o){[void][Ainovel.LaHideWin]::ShowWindow($h,[Ainovel.LaHideWin]::SW_MINIMIZE);[void][Ainovel.LaHideWin]::ShowWindow($h,[Ainovel.LaHideWin]::SW_HIDE)};return $true},[IntPtr]::Zero)|Out-Null',
            ].join('\n'),
            'utf8',
          );
        }
        spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hidePs1],
          { detached: true, stdio: 'ignore', windowsHide: true },
        ).unref();
      } catch {
        /* ignore */
      }
    };

    // Probe health first — if already online, just hide the GUI
    const probe = http.get('http://127.0.0.1:3900/health', { timeout: 1500 }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log('[LA Studio] API already online :3900 — hide UI');
        hideLaStudioUi();
        // Re-hide for a bit in case Qt redraws
        let n = 0;
        const t = setInterval(() => {
          hideLaStudioUi();
          if (++n >= 25) clearInterval(t);
        }, 800);
      }
    });
    probe.on('error', () => {
      try {
        const escaped = String(exe).replace(/'/g, "''");
        const workDir = path.dirname(exe).replace(/'/g, "''");
        spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle',
            'Hidden',
            '-Command',
            `Start-Process -FilePath '${escaped}' -WorkingDirectory '${workDir}' -WindowStyle Minimized`,
          ],
          { detached: true, stdio: 'ignore', windowsHide: true },
        ).unref();
        console.log(`[LA Studio] spawned minimized+hidden: ${exe}`);
        hideLaStudioUi();
        let n = 0;
        const t = setInterval(() => {
          hideLaStudioUi();
          if (++n >= 90) clearInterval(t); // ~72s while cold-start / model load
        }, 800);
      } catch (e) {
        console.warn('[LA Studio] spawn failed', e?.message || e);
      }
    });
    probe.setTimeout(1500, () => {
      try {
        probe.destroy();
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn('[LA Studio] ensure background failed', e?.message || e);
  }
}

app.whenReady().then(async () => {
  ensureEnv();
  initPaths();
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // LA Studio TTS engine — run hidden as soon as Electron is ready
  ensureLaStudioBackgroundEngine();

  // Auto-update: packaged + github (public.env) or generic FEED_URL
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
      console.log(
        `[Startup] Adopt mode — floating logo then workspace (${SPLASH_MIN_MS}ms min)`,
      );
      requestEnterWorkspace();
      return;
    }

    console.log(
      `[Startup] next.prepare()… floating logo splash (min ${SPLASH_MIN_MS}ms, logo=${brandPaths.logo ? 'yes' : 'no'})`,
    );
    await nextApp.prepare();

    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      // Runtime media (TTS/image writes under resources/public) — not in asar static map
      if (tryServeRuntimePublic(req, res, parsedUrl.pathname || '')) return;
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

    // 2) Enter workspace after floating-logo min time (default 5s)
    requestEnterWorkspace();
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
