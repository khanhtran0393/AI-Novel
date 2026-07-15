/**
 * VRAM / RAM guard for heavy local TTS (OmniVoice + Vina ONNX).
 * GTX 1050 Ti 4GB:
 *  - one synth at a time (mutex)
 *  - exclusive engine: when using Omni, unload Vina; when using Vina, unload Omni
 *  - RSS recycle when process bloats
 *
 * State lives on globalThis so Next.js route bundles share one mutex.
 */

export type GpuTtsEngine = 'omnivoice' | 'vina';

type GuardState = {
  holder: GpuTtsEngine | null;
  /** Last engine that owned the GPU (kept warm until switch). */
  exclusiveEngine: GpuTtsEngine | null;
  gate: Promise<void>;
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

const GKEY = '__ai_novel_gpu_tts_guard_v3';

function state(): GuardState {
  const g = globalThis as unknown as Record<string, GuardState | undefined>;
  if (!g[GKEY]) {
    g[GKEY] = {
      holder: null,
      exclusiveEngine: null,
      gate: Promise.resolve(),
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
    // HMR / old shape: fill missing fields
    const s = g[GKEY]!;
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

/** Set false to only serialize (no kill other engine). Default: exclusive. */
export function exclusiveGpuEngineEnabled(): boolean {
  const v = (process.env.TTS_EXCLUSIVE_GPU_ENGINE || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * Unload the *other* heavy engine so only the selected model occupies VRAM.
 * Lazy imports avoid circular deps with omnivoiceLocal / warmDaemon.
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

  // keep vina → unload Omni :8880
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

/**
 * Soft: recycle before next heavy job.
 * Steady Omni after CUDA load often sits ~1.5–2.6GB; only recycle on real bloat.
 */
export function omniRssSoftMb(): number {
  const n = Number(process.env.OMNI_RSS_SOFT_MB);
  return Number.isFinite(n) && n > 500 ? n : 3000;
}

export function omniRssHardMb(): number {
  const n = Number(process.env.OMNI_RSS_HARD_MB);
  return Number.isFinite(n) && n > 800 ? n : 3600;
}

/** Min uptime (s) before RSS soft recycle — avoid thrash right after restart. */
export function omniRssMinUptimeS(): number {
  const n = Number(process.env.OMNI_RSS_MIN_UPTIME_S);
  return Number.isFinite(n) && n >= 0 ? n : 90;
}

export function vinaWorkerRssSoftMb(): number {
  const n = Number(process.env.VINA_RSS_SOFT_MB);
  return Number.isFinite(n) && n > 400 ? n : 2200;
}

/**
 * Serialize OmniVoice + Vina inference on one GPU (4GB class cards).
 * Claims exclusive engine: only the selected model stays loaded.
 * Optional timeoutMs races *inside* the slot so lock is always released
 * (outer Promise.race would abandon fn while still holding the mutex).
 * Edge/Piper/cloud TTS do not use this lock.
 */
export async function withGpuTtsSlot<T>(
  engine: GpuTtsEngine,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const s = state();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const prev = s.gate;
  s.gate = prev.then(() => mine);
  if (s.holder !== null) s.stats.waits += 1;
  s.queueDepth += 1;
  await prev;
  s.queueDepth = Math.max(0, s.queueDepth - 1);
  s.holder = engine;
  s.stats.acquires += 1;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 0;
  try {
    // Only this model on GPU — free the other heavy process first
    await releaseOtherHeavyEngine(engine);
    if (!timeoutMs) return await fn();
    // Race inside slot → finally always runs and frees mutex
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
    s.holder = null;
    s.lastReleaseAt = Date.now();
    release();
  }
}

export function getGpuTtsGuardStatus() {
  const s = state();
  return {
    holder: s.holder,
    exclusiveEngine: s.exclusiveEngine,
    exclusiveEnabled: exclusiveGpuEngineEnabled(),
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

/** Chapter / multi-scene: Omni + Vina must stay serial (concurrency = 1). */
export function isHeavyLocalTtsPlatform(platform: string): boolean {
  const p = (platform || '').toLowerCase();
  return p === 'vina_voice' || p === 'omnivoice_local';
}
