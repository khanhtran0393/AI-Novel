/**
 * Preload: inject durable store into localStorage BEFORE page/Zustand scripts run.
 * This eliminates the empty-rehydrate race that wipes progress on every cold start.
 */
const { contextBridge, ipcRenderer } = require('electron');

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const err = event.error;
    const stack = err?.stack || err?.message || String(err);
    ipcRenderer.send('renderer-error', `Uncaught Exception: ${stack}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const stack = reason instanceof Error ? reason.stack : String(reason);
    ipcRenderer.send('renderer-error', `Unhandled Rejection: ${stack}`);
  });
}

const STORE_KEY = 'novel_generator_v2_store';

function scoreRaw(raw) {
  if (!raw || typeof raw !== 'string') return 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const chapters = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    const chapterContentChars = chapters.reduce(
      (sum, c) => sum + String(c?.noi_dung || '').trim().length,
      0,
    );
    const readyChapters = chapters.filter((c) => String(c?.noi_dung || '').trim().length > 0).length;
    const keyCount = [
      state?.apiKey,
      state?.openaiApiKey,
      state?.grokApiKey,
      state?.lumaApiKey,
      state?.runwayApiKey,
      state?.falaiApiKey,
      state?.imageApiKey,
      state?.videoApiKey,
      state?.aiMasterApiKey,
      state?.googleStudioCookie,
      ...(Array.isArray(state?.apiKeys) ? state.apiKeys : []),
      ...(Array.isArray(state?.openaiApiKeys) ? state.openaiApiKeys : []),
      ...(Array.isArray(state?.grokApiKeys) ? state.grokApiKeys : []),
      ...(Array.isArray(state?.googleStudioCookies) ? state.googleStudioCookies : []),
    ].filter(Boolean).length;
    const generatedAssets =
      Object.keys(state?.generatedAudioPaths || {}).length +
      Object.keys(state?.generatedPrompts || {}).length +
      Object.keys(state?.generatedImages || {}).length +
      Object.keys(state?.generatedVideos || {}).length;
    // DNA + media settings count so boot inject does not drop style config
    const dnaLen = String(state?.visualDnaPrompt || '').trim().length;
    const styleLen = String(state?.mediaStylePreset || '').trim().length;
    const mediaFlags = [
      state?.imageProvider,
      state?.videoProvider,
      state?.imageAspectRatio,
      state?.videoAspectRatio,
      state?.ttsConfig,
    ].filter(Boolean).length;
    const settingsScore = Math.min(dnaLen, 3000) + Math.min(styleLen, 500) + mediaFlags * 40;
    return (
      chapterContentChars +
      readyChapters * 5000 +
      keyCount * 1000 +
      generatedAssets * 100 +
      (state?.giai_doan === 2 ? 2000 : 0) +
      settingsScore
    );
  } catch {
    return 0;
  }
}

// Synchronous boot payload from main (disk + LevelDB recovery already applied)
let boot = { raw: null, summary: null, source: null, paths: null };
try {
  boot = ipcRenderer.sendSync('ainovel-persist-boot') || boot;
} catch (err) {
  // main not ready
}

// Inject into localStorage before any renderer bundle runs
try {
  const diskRaw = boot?.raw || null;
  const diskScore = scoreRaw(diskRaw);
  let localRaw = null;
  try {
    localRaw = localStorage.getItem(STORE_KEY);
  } catch {
    localRaw = null;
  }
  if (localRaw) {
    try {
      const migrated = ipcRenderer.sendSync('ainovel-credentials-migrate-raw', localRaw);
      if (typeof migrated === 'string' && migrated) {
        localRaw = migrated;
        localStorage.setItem(STORE_KEY, migrated);
      }
    } catch {
      // Main process also sanitizes every durable write.
    }
  }
  const localScore = scoreRaw(localRaw);

  if (diskRaw && diskScore > localScore) {
    localStorage.setItem(STORE_KEY, diskRaw);
    // Marker for diagnostics
    localStorage.setItem('ainovel_persist_boot_source', String(boot.source || 'disk'));
    localStorage.setItem('ainovel_persist_boot_score', String(diskScore));
  } else if (localRaw && localScore > 0) {
    // Push local up to disk immediately so main has a copy even if page crashes
    try {
      ipcRenderer.send('ainovel-persist-set', localRaw);
    } catch {
      // ignore
    }
  }
} catch (err) {
  // localStorage may throw in rare locked states
}

contextBridge.exposeInMainWorld('ainovelPersist', {
  storeKey: STORE_KEY,
  /** Sync read best durable payload from main process */
  getStoreSync: () => {
    try {
      return ipcRenderer.sendSync('ainovel-persist-get-sync');
    } catch {
      return null;
    }
  },
  /** Async write (preferred for normal updates) */
  setStore: (raw) => ipcRenderer.invoke('ainovel-persist-set', raw),
  /** Sync write for beforeunload / crash-prone moments */
  setStoreSync: (raw) => {
    try {
      return ipcRenderer.sendSync('ainovel-persist-set-sync', raw);
    } catch {
      return { ok: false };
    }
  },
  flush: () => ipcRenderer.invoke('ainovel-persist-flush'),
  getPaths: () => ipcRenderer.invoke('ainovel-persist-paths'),
  getBootInfo: () => boot,
  isElectron: true,
});

let bootCredentials = {};
try {
  bootCredentials = ipcRenderer.sendSync('ainovel-credentials-get-sync') || {};
} catch {
  bootCredentials = {};
}

/** OS-protected credentials (DPAPI via Electron safeStorage on Windows). */
contextBridge.exposeInMainWorld('ainovelCredentials', {
  isElectron: true,
  getSync: () => bootCredentials,
  get: () => ipcRenderer.invoke('ainovel-credentials-get'),
  set: (credentials) => ipcRenderer.invoke('ainovel-credentials-set', credentials),
});

/** Tools: text reports + TTS chapter queue persistence */
contextBridge.exposeInMainWorld('ainovelTools', {
  isElectron: true,
  writeTextFile: (payload) => ipcRenderer.invoke('ainovel-write-text-file', payload),
  setTtsQueue: (snapshot) => ipcRenderer.invoke('ainovel-tts-queue-set', snapshot),
  getTtsQueue: () => ipcRenderer.invoke('ainovel-tts-queue-get'),
  openPath: (targetPath) => ipcRenderer.invoke('ainovel-open-path', targetPath),
  windowControls: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  }
});

/** Desktop auto-update (electron-updater) — no-op when feed URL unset */
contextBridge.exposeInMainWorld('ainovelUpdater', {
  isElectron: true,
  getStatus: () => ipcRenderer.invoke('ainovel-update-status'),
  check: () => ipcRenderer.invoke('ainovel-update-check'),
  download: () => ipcRenderer.invoke('ainovel-update-download'),
  install: () => ipcRenderer.invoke('ainovel-update-install'),
  onStatus: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const fn = (_e, payload) => {
      try {
        handler(payload);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on('ainovel-update-status', fn);
    return () => {
      try {
        ipcRenderer.removeListener('ainovel-update-status', fn);
      } catch {
        /* ignore */
      }
    };
  },
});
