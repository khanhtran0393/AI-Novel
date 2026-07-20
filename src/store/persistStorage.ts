import { API } from '@/contracts';
import type { StateStorage } from 'zustand/middleware';

export const STORE_KEY = 'novel_generator_v2_store';

type AinovelPersistApi = {
  storeKey: string;
  getStoreSync: () => string | null;
  setStore: (raw: string) => Promise<unknown>;
  setStoreSync: (raw: string) => { ok?: boolean } | null;
  flush: () => Promise<unknown>;
  getPaths: () => Promise<unknown>;
  getBootInfo: () => unknown;
  isElectron: boolean;
};

function getPersistApi(): AinovelPersistApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ainovelPersist?: AinovelPersistApi }).ainovelPersist || null;
}

/** Media / output settings that must never be wiped by weaker snapshots. */
const MEDIA_SETTINGS_KEYS = [
  'visualDnaPrompt',
  'mediaStylePreset',
  'imageProvider',
  'imageModel',
  'imageApiKey',
  'imageAspectRatio',
  'imageCount',
  'videoProvider',
  'videoModel',
  'videoApiKey',
  'videoAspectRatio',
  'videoDuration',
  'wpm',
  'secondsPerBeat',
  'aiMasterModel',
  'aiMasterApiKey',
  'useGpuAcceleration',
  'ttsConfig',
  'savePathTTS',
  'savePathImage',
  'savePathCharacter',
  'savePathVideo',
] as const;

function settingsRichness(state: Record<string, unknown> | null | undefined): number {
  if (!state || typeof state !== 'object') return 0;
  const dna = String(state.visualDnaPrompt || '').trim().length;
  const style = String(state.mediaStylePreset || '').trim().length;
  const tts = state.ttsConfig && typeof state.ttsConfig === 'object' ? 200 : 0;
  const mediaFlags = [
    state.imageProvider,
    state.videoProvider,
    state.imageAspectRatio,
    state.videoAspectRatio,
    state.imageModel,
    state.videoModel,
  ].filter(Boolean).length;
  return Math.min(dna, 3000) + Math.min(style, 500) + mediaFlags * 40 + tts;
}

/** Score a raw zustand persist payload (sync, browser-safe). */
export function scoreStoreRaw(raw: string | null | undefined): number {
  if (!raw || typeof raw !== 'string') return 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const chapters = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    const chapterContentChars = chapters.reduce(
      (sum: number, c: { noi_dung?: string }) => sum + String(c?.noi_dung || '').trim().length,
      0,
    );
    const readyChapters = chapters.filter(
      (c: { noi_dung?: string }) => String(c?.noi_dung || '').trim().length > 0,
    ).length;
    const keyCount = [
      state?.apiKey,
      state?.openaiApiKey,
      state?.grokApiKey,
      state?.claudeApiKey,
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
      ...(Array.isArray(state?.claudeApiKeys) ? state.claudeApiKeys : []),
      ...(Array.isArray(state?.lumaApiKeys) ? state.lumaApiKeys : []),
      ...(Array.isArray(state?.runwayApiKeys) ? state.runwayApiKeys : []),
      ...(Array.isArray(state?.falaiApiKeys) ? state.falaiApiKeys : []),
      ...(Array.isArray(state?.googleStudioCookies) ? state.googleStudioCookies : []),
      ...(Array.isArray(state?.tiktokSessionIds) ? state.tiktokSessionIds : []),
    ].filter(Boolean).length;
    const generatedAssets =
      Object.keys(state?.generatedAudioPaths || {}).length +
      Object.keys(state?.generatedPrompts || {}).length +
      Object.keys(state?.generatedImages || {}).length +
      Object.keys(state?.generatedVideos || {}).length;
    const loreLen = String(state?.lorebook || '').trim().length;
    const outlineLen = String(state?.dan_y_tong_the || '').trim().length;
    return (
      chapterContentChars +
      readyChapters * 5000 +
      keyCount * 1000 +
      generatedAssets * 100 +
      (state?.giai_doan === 2 ? 2000 : 0) +
      Math.min(loreLen, 2000) +
      Math.min(outlineLen, 2000) +
      settingsRichness(state)
    );
  } catch {
    return 0;
  }
}

function isEmptySettingValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return !v.trim();
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function fuseMediaSettingsRaw(
  baseRaw: string,
  ...others: Array<string | null | undefined>
): string {
  try {
    const parsed = JSON.parse(baseRaw);
    const hasWrapper = parsed && typeof parsed === 'object' && parsed.state;
    const state = { ...(hasWrapper ? parsed.state : parsed) } as Record<string, unknown>;
    let changed = false;

    for (const raw of others) {
      if (!raw) continue;
      try {
        const o = JSON.parse(raw);
        const os = (o?.state || o) as Record<string, unknown>;
        if (!os || typeof os !== 'object') continue;
        for (const key of MEDIA_SETTINGS_KEYS) {
          const incoming = os[key];
          if (isEmptySettingValue(incoming)) continue;
          const current = state[key];
          if (isEmptySettingValue(current)) {
            state[key] = incoming;
            changed = true;
            continue;
          }
          if (
            (key === 'visualDnaPrompt' || key === 'mediaStylePreset') &&
            typeof incoming === 'string' &&
            typeof current === 'string' &&
            incoming.trim().length > current.trim().length
          ) {
            state[key] = incoming;
            changed = true;
          }
          if (key === 'ttsConfig' && typeof incoming === 'object' && typeof current === 'object') {
            state[key] = { ...(current as object), ...(incoming as object) };
            changed = true;
          }
        }
      } catch {
        // ignore bad candidate
      }
    }

    if (!changed) return baseRaw;
    return JSON.stringify(hasWrapper ? { ...parsed, state } : state);
  } catch {
    return baseRaw;
  }
}

let lastDiskPayload = '';
let diskBackupTimer: ReturnType<typeof setTimeout> | null = null;
let hydrationLockedUntil = 0;
let flushGuardsInstalled = false;
/** Window during which setItem may persist a low-score "project reset" payload. */
let intentionalResetUntil = 0;
/** Debounce localStorage + durable writes — big JSON.stringify payloads freeze UI if every set() flushes. */
let localPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLocalPersist: { name: string; value: string } | null = null;
/** 1.2s coalesces typing/media bursts; was 450ms → disk thrash + GUI stutter. */
const LOCAL_PERSIST_DEBOUNCE_MS = 1_200;
/** Last value written to localStorage (skip identical setItem). */
let lastLocalPersistedValue = '';
/** Last value sent to IPC/HTTP durable (skip identical durableWrite). */
let lastDurableSentValue = '';
/** Periodic safety flush interval (was 20s). */
const DURABLE_HEARTBEAT_MS = 45_000;
/** HTTP disk backup debounce after IPC (was 500ms). */
const HTTP_DURABLE_DEBOUNCE_MS = 1_500;

function flushPendingLocalPersist(): void {
  if (localPersistTimer) {
    clearTimeout(localPersistTimer);
    localPersistTimer = null;
  }
  const pending = pendingLocalPersist;
  pendingLocalPersist = null;
  if (!pending) return;
  // Skip localStorage + IPC when payload unchanged (Zustand re-persist noise)
  if (pending.value === lastLocalPersistedValue) {
    return;
  }
  try {
    window.localStorage.setItem(pending.name, pending.value);
    lastLocalPersistedValue = pending.value;
  } catch (err) {
    console.warn('[NovelStore] localStorage.setItem failed:', err);
  }
  durableWrite(pending.value);
}

/**
 * Call immediately before store.resetStore() for "Làm Mới Dự Án".
 * Bypasses wipe/regression guards so empty chapters / default lore / title can persist.
 */
export function allowIntentionalStoreReset(ms = 60_000): void {
  intentionalResetUntil = Date.now() + Math.max(500, ms);
  lastDiskPayload = '';
  lastLocalPersistedValue = '';
  lastDurableSentValue = '';
  hydrationLockedUntil = 0;
}

function isIntentionalStoreResetActive(): boolean {
  return Date.now() < intentionalResetUntil;
}

/** projectResetEpoch from a zustand persist raw payload (0 if missing). */
export function extractResetEpoch(raw: string | null | undefined): number {
  if (!raw || typeof raw !== 'string') return 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const n = Number(state?.projectResetEpoch);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Hydrate picker: **higher projectResetEpoch always wins** (blank Làm Mới beats rich old backup).
 * Same epoch → content score (pickRichest).
 */
function pickBestForHydrate(...candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestEpoch = -1;
  let bestScore = -1;
  for (const c of candidates) {
    if (!c) continue;
    const epoch = extractResetEpoch(c);
    const score = scoreStoreRaw(c);
    if (epoch > bestEpoch || (epoch === bestEpoch && score > bestScore)) {
      best = c;
      bestEpoch = epoch;
      bestScore = score;
    }
  }
  return best;
}

function pickRichest(...candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreStoreRaw(c);
    if (c && s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Force-write blank (or any) payload to local + IPC + HTTP.
 * Used after Làm Mới so old high-score durable backups cannot win on next hydrate.
 */
export function forceOverwriteAllDurables(value: string): void {
  if (typeof window === 'undefined' || !value) return;
  lastDiskPayload = value;
  lastLocalPersistedValue = value;
  lastDurableSentValue = value;
  hydrationLockedUntil = 0;

  try {
    window.localStorage.setItem(STORE_KEY, value);
  } catch {
    // quota
  }

  const api = getPersistApi();
  try {
    api?.setStoreSync?.(value);
  } catch {
    // ignore
  }
  try {
    void api?.setStore?.(value);
  } catch {
    // ignore
  }

  if (diskBackupTimer) clearTimeout(diskBackupTimer);
  diskBackupTimer = null;
  fetch(API.persistStore, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: STORE_KEY, value }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * After resetStore(), flush partialized blank canvas to every durable layer.
 * Call once immediately and optionally again after a tick (zustand persist may write async).
 */
export function commitIntentionalProjectResetFromLocal(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    // Only commit if this payload is a real intentional reset (epoch set)
    if (extractResetEpoch(raw) <= 0 && !isIntentionalStoreResetActive()) return;
    forceOverwriteAllDurables(raw);
    console.info(
      `[NovelStore] Project reset committed epoch=${extractResetEpoch(raw)} score=${scoreStoreRaw(raw)}`,
    );
  } catch (e) {
    console.warn('[NovelStore] commitIntentionalProjectResetFromLocal failed', e);
  }
}

/** Triple-write: Electron IPC (primary) + localStorage + HTTP API fallback */
export function durableWrite(value: string, { sync = false } = {}) {
  if (typeof window === 'undefined') return;
  const intentional = isIntentionalStoreResetActive();
  // Blank reset may score low — still must write when intentional
  if (!value || (!intentional && scoreStoreRaw(value) <= 0)) return;
  lastDiskPayload = value;

  // Skip IPC/HTTP when identical payload already sent (unless forced sync leave/reset)
  if (!sync && !intentional && value === lastDurableSentValue) {
    return;
  }

  const api = getPersistApi();
  if (api) {
    try {
      if (sync && api.setStoreSync) {
        api.setStoreSync(value);
      } else {
        void api.setStore(value);
      }
      lastDurableSentValue = value;
    } catch {
      // fall through to HTTP
    }
  }

  if (diskBackupTimer) clearTimeout(diskBackupTimer);
  diskBackupTimer = setTimeout(() => {
    diskBackupTimer = null;
    const payload = lastDiskPayload;
    if (!payload) return;
    if (!intentional && scoreStoreRaw(payload) <= 0) return;
    fetch(API.persistStore, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: STORE_KEY, value: payload }),
      keepalive: true,
    }).catch(() => undefined);
  }, sync || intentional ? 0 : HTTP_DURABLE_DEBOUNCE_MS);
}

export function flushDurableNow() {
  flushPendingLocalPersist();
  if (!lastDiskPayload || scoreStoreRaw(lastDiskPayload) <= 0) return;
  const api = getPersistApi();
  try {
    api?.setStoreSync?.(lastDiskPayload);
  } catch {
    // ignore
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob(
        [JSON.stringify({ name: STORE_KEY, value: lastDiskPayload })],
        { type: 'application/json' },
      );
      navigator.sendBeacon(API.persistStore, blob);
    } else {
      fetch(API.persistStore, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: STORE_KEY, value: lastDiskPayload }),
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // ignore
  }
}

/**
 * Triple storage:
 * 1. Electron IPC disk (multi-path + secrets) - primary durable
 * 2. localStorage - fast session cache (may wipe)
 * 3. HTTP /api/persist-store - same disk files when not in Electron bridge
 */
/**
 * Hydrate storage — MUST never hang the renderer.
 * Electron preload already injects best disk snapshot into localStorage via sendSync boot.
 * Calling getStoreSync again here can freeze the UI forever (sync IPC + huge JSON).
 * Strategy: localStorage first; optional short HTTP only if thin; no blocking IPC on read path.
 */
export const dualStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    const hardTimeoutMs = 4000;
    const run = async (): Promise<string | null> => {
      let local: string | null = null;
      try {
        local = window.localStorage.getItem(name);
      } catch {
        local = null;
      }

      // Boot marker from preload — disk already fused into localStorage
      let bootRaw: string | null = null;
      try {
        const boot = getPersistApi()?.getBootInfo?.() as
          | { raw?: string | null }
          | null
          | undefined;
        if (boot?.raw && typeof boot.raw === 'string') bootRaw = boot.raw;
      } catch {
        bootRaw = null;
      }

      const localScore = scoreStoreRaw(local);
      const bootScore = scoreStoreRaw(bootRaw);

      // Fast path: local is rich enough — do NOT touch IPC sendSync
      if (localScore >= 200 || (local && extractResetEpoch(local) > 0)) {
        // Optionally fuse media from boot if boot is richer on media keys only
        let best = local;
        if (bootRaw && bootScore > 0) {
          best = fuseMediaSettingsRaw(local || bootRaw, local, bootRaw) || local;
        }
        hydrationLockedUntil = Date.now() + 2000;
        return best;
      }

      // Thin local: prefer boot raw from preload (already in memory, no second IPC)
      let best = pickBestForHydrate(local, bootRaw);

      // HTTP only if still thin (browser / non-electron) — hard abort 800ms
      if (scoreStoreRaw(best) < 200) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 800);
          const res = await fetch(
            `${API.persistStore}?name=${encodeURIComponent(name)}`,
            { signal: controller.signal, cache: 'no-store' },
          );
          clearTimeout(timeout);
          if (res.ok) {
            const data = (await res.json()) as { value?: string | null };
            const httpRaw = data?.value || null;
            best = pickBestForHydrate(best, httpRaw);
            if (best && httpRaw) {
              best = fuseMediaSettingsRaw(best, best, httpRaw) || best;
            }
          }
        } catch {
          // ignore
        }
      }

      if (best) {
        try {
          if (best !== local) window.localStorage.setItem(name, best);
        } catch {
          // quota
        }
        try {
          durableWrite(best);
        } catch {
          // ignore
        }
      }

      hydrationLockedUntil = Date.now() + 2000;
      return best;
    };

    try {
      return await Promise.race([
        run(),
        new Promise<string | null>((resolve) => {
          setTimeout(() => {
            try {
              const fallback = window.localStorage.getItem(name);
              console.warn(
                `[NovelStore] getItem hard-timeout ${hardTimeoutMs}ms — use local only`,
              );
              resolve(fallback);
            } catch {
              resolve(null);
            }
          }, hardTimeoutMs);
        }),
      ]);
    } catch (e) {
      console.warn('[NovelStore] getItem failed, empty hydrate', e);
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    }
  },

  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return;

    const newScore = scoreStoreRaw(value);
    const intentional = isIntentionalStoreResetActive();
    try {
      if (!intentional) {
        const existing = window.localStorage.getItem(name);
        const existingScore = scoreStoreRaw(existing);
        const ipcScore = scoreStoreRaw(getPersistApi()?.getStoreSync?.() || null);
        const guardScore = Math.max(existingScore, ipcScore);

        if (guardScore > 500 && newScore < guardScore * 0.25 && newScore < 500) {
          console.warn(`[NovelStore] Blocked wipe score ${newScore} (guard ${guardScore}).`);
          if (existing && existingScore >= ipcScore) durableWrite(existing);
          return;
        }

        if (Date.now() < hydrationLockedUntil && guardScore > 0 && newScore < guardScore * 0.9) {
          if (newScore < guardScore * 0.5) {
            console.warn('[NovelStore] Blocked regression during hydration lock.');
            return;
          }
        }
      } else {
        console.info(
          `[NovelStore] Intentional project reset persist allowed (score=${newScore}).`,
        );
      }
    } catch {
      // continue
    }

    // Debounce non-intentional writes — avoids main-thread freeze on every media map update
    if (intentional) {
      pendingLocalPersist = null;
      if (localPersistTimer) {
        clearTimeout(localPersistTimer);
        localPersistTimer = null;
      }
      try {
        window.localStorage.setItem(name, value);
        lastLocalPersistedValue = value;
      } catch (err) {
        console.warn('[NovelStore] localStorage.setItem failed:', err);
      }
      durableWrite(value, { sync: true });
      return;
    }

    // Same serialized snapshot already pending/flushed → no timer churn
    if (value === lastLocalPersistedValue && !pendingLocalPersist) {
      lastDiskPayload = value;
      return;
    }

    pendingLocalPersist = { name, value };
    lastDiskPayload = value;
    if (localPersistTimer) clearTimeout(localPersistTimer);
    localPersistTimer = setTimeout(() => {
      localPersistTimer = null;
      flushPendingLocalPersist();
    }, LOCAL_PERSIST_DEBOUNCE_MS);
  },

  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export function syncLocalStoreToDurable({ flush = false } = {}) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw && scoreStoreRaw(raw) > 0) {
      durableWrite(raw, { sync: true });
    }
    if (flush) flushDurableNow();
  } catch {
    // ignore
  }
}

export function installDurableStoreFlushGuards() {
  if (flushGuardsInstalled || typeof window === 'undefined') return;
  flushGuardsInstalled = true;
  const onLeave = () => flushDurableNow();
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDurableNow();
  });
  // Safety heartbeat only — durableWrite skips when payload unchanged
  setInterval(() => {
    if (lastDiskPayload && scoreStoreRaw(lastDiskPayload) > 0) {
      durableWrite(lastDiskPayload);
    }
  }, DURABLE_HEARTBEAT_MS);
}
