const { app, BrowserWindow, ipcMain } = require('electron');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const durable = require('./electron/durableStore');
const { ZUSTAND_STORE_KEY } = durable;

const STABLE_PORT = Number(process.env.AI_NOVEL_PORT || process.env.PORT || 3000);
const dev = !app.isPackaged;
const appDir = app.getAppPath();
const preloadPath = path.join(appDir, 'preload.js');

let mainWindow = null;
let backupInterval = null;
let paths = null;
let lastGoodRaw = null;
let pendingWrite = null;
let writeTimer = null;

function ensureEnv() {
  try {
    process.chdir(appDir);
  } catch {
    // ignore
  }
  process.env.AI_NOVEL_ROOT = appDir;
  process.env.INIT_CWD = appDir;
  try {
    process.env.AI_NOVEL_USER_DATA = app.getPath('userData');
  } catch {
    // ignore
  }
  if (app.isPackaged && process.resourcesPath) {
    const resourceBin = path.join(process.resourcesPath, 'bin');
    if (fs.existsSync(resourceBin) && !fs.existsSync(path.join(appDir, 'bin'))) {
      process.env.AI_NOVEL_ROOT = process.resourcesPath;
    }
  }
}

function initPaths() {
  paths = durable.getPaths(app.getPath('userData'), process.env.AI_NOVEL_ROOT || appDir);
  return paths;
}

function killProcessOnPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && parseInt(pid, 10) > 0 && parseInt(pid, 10) !== process.pid) {
          console.log(`[Startup Cleanup] Giải phóng cổng ${port} (PID: ${pid})...`);
          execSync(`taskkill /F /PID ${pid}`);
        }
      }
    }
  } catch {
    // empty
  }
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
    lastGoodRaw = best.raw;
    // Ensure multi-path mirrors exist even if we recovered from LevelDB only
    commitWrite(best.raw, { history: false, force: false });
    return {
      raw: best.raw,
      summary: best.summary,
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

function registerIpc() {
  ipcMain.on('ainovel-persist-boot', (event) => {
    try {
      event.returnValue = resolveBootStore();
    } catch (err) {
      console.warn('[DurableStore] boot failed:', err?.message || err);
      event.returnValue = { raw: null, summary: { score: 0 }, source: null, paths: null };
    }
  });

  ipcMain.on('ainovel-persist-get-sync', (event) => {
    try {
      const boot = resolveBootStore();
      event.returnValue = boot.raw;
    } catch {
      event.returnValue = lastGoodRaw;
    }
  });

  ipcMain.on('ainovel-persist-set-sync', (event, raw) => {
    try {
      event.returnValue = commitWrite(raw, { history: true });
    } catch (err) {
      event.returnValue = { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.on('ainovel-persist-set', (_event, raw) => {
    scheduleWrite(raw);
  });

  ipcMain.handle('ainovel-persist-set', async (_event, raw) => {
    return commitWrite(raw, { history: true });
  });

  ipcMain.handle('ainovel-persist-flush', async () => flushPending());

  ipcMain.handle('ainovel-persist-paths', async () => {
    if (!paths) initPaths();
    return paths;
  });
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

// --- Startup ---
killProcessOnPort(3000);
ensureEnv();

// app ready needed for getPath in some electron versions — getPath('userData') works early
try {
  initPaths();
} catch {
  // will init on ready
}

const nextApp = next({ dev, dir: appDir });
const handle = nextApp.getRequestHandler();

app.whenReady().then(() => {
  ensureEnv();
  initPaths();
  registerIpc();

  // Cold-start recovery to disk before UI
  const boot = resolveBootStore();
  console.log(
    `[DurableStore] Boot source=${boot.source || 'none'} score=${boot.summary?.score || 0} primary=${paths.primary}`,
  );

  nextApp.prepare().then(() => {
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });

    server.on('error', (err) => {
      console.error(`[Startup] Không thể mở cổng cố định ${STABLE_PORT}:`, err);
      app.quit();
    });

    server.listen(STABLE_PORT, () => {
      console.log(`Next.js local server listening on http://localhost:${STABLE_PORT}`);

      mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: 'AI Novel & Script Generator',
        autoHideMenuBar: true,
        webPreferences: {
          preload: preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          // Named persistent partition — independent of default session wipes
          partition: 'persist:ainovel-v1',
          spellcheck: false,
        },
      });

      mainWindow.loadURL(`http://localhost:${STABLE_PORT}`);

      // Preload already injects on first document. Safety net after load:
      mainWindow.webContents.on('did-finish-load', () => {
        restoreIntoRendererIfNeeded().catch(() => undefined);
        setTimeout(() => snapshotFromRenderer(), 2000);
        setTimeout(() => snapshotFromRenderer(), 8000);
      });

      backupInterval = setInterval(() => {
        snapshotFromRenderer();
        flushPending();
      }, 30_000);

      mainWindow.on('close', (e) => {
        // Best-effort sync flush before teardown
        try {
          flushPending();
        } catch {
          // ignore
        }
        // Also pull latest localStorage (sync-ish via async — fire and hope)
        snapshotFromRenderer();
      });
    });
  });
});

app.on('before-quit', () => {
  try {
    flushPending();
  } catch {
    // ignore
  }
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
});

app.on('window-all-closed', () => {
  try {
    flushPending();
  } catch {
    // ignore
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // macOS re-create if needed
  }
});
