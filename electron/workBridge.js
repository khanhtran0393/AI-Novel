/**
 * Main-process bridge: utilityProcess work host ↔ renderer IPC.
 * GUI BrowserWindow never runs the HTTP wait loop for media batches.
 */
'use strict';

const path = require('path');
const { utilityProcess, ipcMain, BrowserWindow } = require('electron');

/** @type {Electron.UtilityProcess | null} */
let child = null;
/** @type {Map<string, { resolve: Function, reject: Function, kind: string }>} */
const pending = new Map();
let ready = false;
let starting = null;

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    } catch {
      /* ignore */
    }
  }
}

function ensureChild() {
  if (child && !child.killed) return Promise.resolve(child);
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    try {
      const script = path.join(__dirname, 'workHost.cjs');
      const proc = utilityProcess.fork(script, [], {
        serviceName: 'ainovel-work-host',
        stdio: 'pipe',
      });
      child = proc;
      ready = false;

      const onMessage = (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ready') {
          ready = true;
          resolve(proc);
          return;
        }
        if (msg.type === 'fetch_result') {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.resolve(msg);
          }
          broadcast('ainovel-work-event', msg);
          return;
        }
        if (msg.type === 'batch_item' || msg.type === 'batch_done') {
          if (msg.type === 'batch_done') {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.resolve(msg);
            }
          }
          broadcast('ainovel-work-event', msg);
          return;
        }
        if (msg.type === 'pong') {
          broadcast('ainovel-work-event', msg);
        }
      };

      proc.on('message', onMessage);
      proc.on('exit', (code) => {
        console.warn('[workBridge] workHost exited', code);
        child = null;
        ready = false;
        starting = null;
        for (const [id, p] of pending) {
          pending.delete(id);
          p.reject(new Error(`workHost exited (${code}) during ${id}`));
        }
      });
      if (proc.stdout) {
        proc.stdout.on('data', (buf) => {
          const s = String(buf || '').trim();
          if (s) console.log('[workHost]', s);
        });
      }
      if (proc.stderr) {
        proc.stderr.on('data', (buf) => {
          const s = String(buf || '').trim();
          if (s) console.warn('[workHost:err]', s);
        });
      }
      // Timeout if ready never arrives
      setTimeout(() => {
        if (!ready) {
          reject(new Error('workHost ready timeout'));
          starting = null;
        }
      }, 8000);
    } catch (e) {
      starting = null;
      reject(e);
    }
  });
  return starting;
}

function sendToChild(msg) {
  if (!child || child.killed) throw new Error('workHost not running');
  child.postMessage(msg);
}

/**
 * @param {(event: Electron.IpcMainInvokeEvent) => void} assertTrusted
 */
function registerWorkIpc(assertTrusted) {
  ipcMain.handle('ainovel-work-ping', async (event) => {
    assertTrusted(event);
    try {
      await ensureChild();
      return { ok: true, ready: true, mode: 'utilityProcess' };
    } catch (e) {
      return {
        ok: false,
        ready: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle('ainovel-work-fetch', async (event, payload) => {
    assertTrusted(event);
    await ensureChild();
    const id = String(payload?.id || `fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, kind: 'fetch' });
      try {
        sendToChild({
          type: 'fetch',
          id,
          url: String(payload?.url || ''),
          method: String(payload?.method || 'POST'),
          headers: payload?.headers || {},
          body: payload?.body,
        });
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  });

  ipcMain.handle('ainovel-work-batch', async (event, payload) => {
    assertTrusted(event);
    await ensureChild();
    const id = String(payload?.id || `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, kind: 'batch' });
      try {
        sendToChild({
          type: 'batch',
          id,
          items: Array.isArray(payload?.items) ? payload.items : [],
          concurrency: payload?.concurrency,
          itemGapMs: payload?.itemGapMs,
        });
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  });

  ipcMain.handle('ainovel-work-cancel', async (event, payload) => {
    assertTrusted(event);
    try {
      if (child && !child.killed) {
        sendToChild({ type: 'cancel', id: String(payload?.id || '') });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

function shutdownWorkHost() {
  try {
    if (child && !child.killed) child.kill();
  } catch {
    /* ignore */
  }
  child = null;
  ready = false;
  starting = null;
}

module.exports = {
  registerWorkIpc,
  ensureChild,
  shutdownWorkHost,
};
