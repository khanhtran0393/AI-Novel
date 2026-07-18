/**
 * VRAM / RAM guard for heavy local TTS (OmniVoice + Vina ONNX).
 *
 * - Omni ↔ Vina: exclusive (unload the other).
 * - Vina ↔ Vina: up to N parallel slots (= daemon workers) for same-voice multi-request.
 * - Omni: always 1 slot.
 *
 * State on globalThis so Next.js route bundles share one guard.
 *
 * SERVER-ONLY (do not import from Client Components):
 * dynamic imports warmDaemon / omnivoiceLocal (fs + child_process).
 * Client UI: use `@/lib/ttsBatchSrt/concurrency` for parallel slot counts only.
 */

export type GpuTtsEngine = 'omnivoice' | 'vina';

type GuardState = {
  /** Legacy single-holder (status UI) */
  holder: GpuTtsEngine | null;
  exclusiveEngine: GpuTtsEngine | null;
  vinaInflight: number;
  omniInflight: number;
  waitQueue: Array<() => void>;
  lastReleaseAt: number;
  queueDepth: number;
  stats: {
    acquires: number;
    waits: number;
    omniRestarts: number;
    vinaRestarts: number;
    exclusiveSwitches: number;
  };
};

const GKEY = '__ai_novel_gpu_tts_guard_v4';

function state(): GuardState {
  const g = globalThis as unknown as Record<string, GuardState | undefined>;
  if (!g[GKEY]) {
    g[GKEY] = {
      holder: null,
      exclusiveEngine: null,
      vinaInflight: 0,
      omniInflight: 0,
      waitQueue: [],
      lastReleaseAt: 0,
      queueDepth: 0,
      stats: {
        acquires: 0,
        waits: 0,
        omniRestarts: 0,
        vinaRestarts: 0,
        exclusiveSwitches: 0,
      },
    };
  } else {
    const s = g[GKEY]!;
    if (s.vinaInflight === undefined) s.vinaInflight = 0;
    if (s.omniInflight === undefined) s.omniInflight = 0;
    if (!s.waitQueue) s.waitQueue = [];
    if (s.exclusiveEngine === undefined) s.exclusiveEngine = null;
    if (!s.stats) {
      s.stats = {
        acquires: 0,
        waits: 0,
        omniRestarts: 0,
        vinaRestarts: 0,
        exclusiveSwitches: 0,
      };
    } else if (!Number.isFinite(s.stats.exclusiveSwitches)) {
      s.stats.exclusiveSwitches = 0;
    }
  }
  return g[GKEY]!;
}

function wakeWaiters() {
  const s = state();
  const q = s.waitQueue.splice(0, s.waitQueue.length);
  for (const w of q) {
    try {
      w();
    } catch {
      /* ignore */
    }
  }
}

/** Set false to only serialize (no kill other engine). Default: exclusive. */
export function exclusiveGpuEngineEnabled(): boolean {
  const v = (process.env.TTS_EXCLUSIVE_GPU_ENGINE || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * How many Vina synth jobs may run at once (same voice multi-request).
 * Align with VINA_DAEMON_WORKERS — each slot needs a warm worker process.
 * Default 1 (safe 4GB). Set VINA_DAEMON_WORKERS=2 + VINA_PARALLEL_SLOTS=2 when VRAM allows.
 */
export function resolveVinaParallelSlots(): number {
  const slots = Number(process.env.VINA_PARALLEL_SLOTS);
  if (Number.isFinite(slots) && slots > 0) {
    return Math.max(1, Math.min(4, Math.trunc(slots)));
  }
  const workers = Number(process.env.VINA_DAEMON_WORKERS);
  if (Number.isFinite(workers) && workers > 0) {
    return Math.max(1, Math.min(4, Math.trunc(workers)));
  }
  return 1;
}

/**
 * Unload the *other* heavy engine so only the selected model occupies VRAM.
 */
export async function releaseOtherHeavyEngine(
  keep: GpuTtsEngine,
): Promise<{ unloaded: GpuTtsEngine | null }> {
  if (!exclusiveGpuEngineEnabled()) return { unloaded: null };
  const s = state();
  if (s.exclusiveEngine === keep) return { unloaded: null };

  if (keep === 'omnivoice') {
    try {
      const vina = await import('@/lib/vinaVoice/warmDaemon');
      vina.killAllDaemons();
      console.log('[GPU guard] exclusive OmniVoice — unloaded Vina daemon');
    } catch (e) {
      console.warn('[GPU guard] unload Vina failed:', e);
    }
    s.stats.exclusiveSwitches += 1;
    s.exclusiveEngine = 'omnivoice';
    return { unloaded: 'vina' };
  }

  try {
    const omni = await import('@/lib/omnivoiceLocal');
    await omni.killOmniServerProcesses();
    console.log('[GPU guard] exclusive Vina — unloaded OmniVoice :8880');
  } catch (e) {
    console.warn('[GPU guard] unload Omni failed:', e);
  }
  s.stats.exclusiveSwitches += 1;
  s.exclusiveEngine = 'vina';
  return { unloaded: 'omnivoice' };
}

export function omniRssSoftMb(): number {
  const n = Number(process.env.OMNI_RSS_SOFT_MB);
  return Number.isFinite(n) && n > 500 ? n : 3000;
}

export function omniRssHardMb(): number {
  const n = Number(process.env.OMNI_RSS_HARD_MB);
  return Number.isFinite(n) && n > 800 ? n : 3600;
}

export function omniRssMinUptimeS(): number {
  const n = Number(process.env.OMNI_RSS_MIN_UPTIME_S);
  return Number.isFinite(n) && n >= 0 ? n : 90;
}

export function vinaWorkerRssSoftMb(): number {
  const n = Number(process.env.VINA_RSS_SOFT_MB);
  return Number.isFinite(n) && n > 400 ? n : 4800;
}

export function vinaRssMinUptimeS(): number {
  const n = Number(process.env.VINA_RSS_MIN_UPTIME_S);
  return Number.isFinite(n) && n >= 0 ? n : 180;
}

async function acquireEngineSlot(engine: GpuTtsEngine): Promise<void> {
  const s = state();
  const maxVina = resolveVinaParallelSlots();

  for (;;) {
    if (engine === 'vina') {
      // Block while Omni holds GPU
      if (s.omniInflight === 0 && s.vinaInflight < maxVina) {
        s.vinaInflight += 1;
        s.holder = 'vina';
        s.stats.acquires += 1;
        return;
      }
    } else {
      // Omni: exclusive vs Vina, single slot
      if (s.vinaInflight === 0 && s.omniInflight < 1) {
        s.omniInflight += 1;
        s.holder = 'omnivoice';
        s.stats.acquires += 1;
        return;
      }
    }
    s.stats.waits += 1;
    s.queueDepth += 1;
    await new Promise<void>((resolve) => {
      s.waitQueue.push(resolve);
    });
    s.queueDepth = Math.max(0, s.queueDepth - 1);
  }
}

function releaseEngineSlot(engine: GpuTtsEngine): void {
  const s = state();
  if (engine === 'vina') {
    s.vinaInflight = Math.max(0, s.vinaInflight - 1);
  } else {
    s.omniInflight = Math.max(0, s.omniInflight - 1);
  }
  if (s.vinaInflight === 0 && s.omniInflight === 0) {
    s.holder = null;
  } else if (s.vinaInflight > 0) {
    s.holder = 'vina';
  } else {
    s.holder = 'omnivoice';
  }
  s.lastReleaseAt = Date.now();
  wakeWaiters();
}

/**
 * Acquire GPU slot then run fn.
 * Vina: up to resolveVinaParallelSlots() concurrent (same-voice multi-request).
 * Omni: 1 concurrent. Omni and Vina never overlap.
 */
export async function withGpuTtsSlot<T>(
  engine: GpuTtsEngine,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  await acquireEngineSlot(engine);
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 0;
  try {
    await releaseOtherHeavyEngine(engine);
    if (!timeoutMs) return await fn();
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `GPU TTS timeout ${Math.round(timeoutMs / 1000)}s (${engine}) — đã nhả lock; thử lại.`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
  } finally {
    releaseEngineSlot(engine);
  }
}

export function getGpuTtsGuardStatus() {
  const s = state();
  return {
    holder: s.holder,
    exclusiveEngine: s.exclusiveEngine,
    exclusiveEnabled: exclusiveGpuEngineEnabled(),
    vinaInflight: s.vinaInflight,
    omniInflight: s.omniInflight,
    vinaParallelSlots: resolveVinaParallelSlots(),
    queueDepth: s.queueDepth,
    lastReleaseAt: s.lastReleaseAt,
    stats: { ...s.stats },
    thresholds: {
      omniRssSoftMb: omniRssSoftMb(),
      omniRssHardMb: omniRssHardMb(),
      omniRssMinUptimeS: omniRssMinUptimeS(),
      vinaWorkerRssSoftMb: vinaWorkerRssSoftMb(),
    },
  };
}

export function noteOmniRestart() {
  state().stats.omniRestarts += 1;
}

export function noteVinaRestart() {
  state().stats.vinaRestarts += 1;
}

/** Chapter / multi-scene: heavy local TTS uses GPU guard. */
export function isHeavyLocalTtsPlatform(platform: string): boolean {
  const p = (platform || '').toLowerCase();
  return p === 'vina_voice' || p === 'omnivoice_local';
}
