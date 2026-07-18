/**
 * Platform-aware concurrency for TTS Batch SRT.
 *
 * Same-voice multi-request: N parallel jobs share ONE reference profile
 * (cơ sở tham chiếu). For Vina, N must match warm daemon workers / GPU slots.
 *
 * CLIENT-SAFE: do NOT import gpuTtsGuard / warmDaemon / omnivoiceLocal here.
 * Those pull Node `fs` + `child_process` and break the workspace GUI bundle.
 */

/** Align with VINA_DAEMON_WORKERS / VINA_PARALLEL_SLOTS (default 1 on 4GB). */
export function resolveVinaParallelSlotsClientSafe(): number {
  const slots = Number(
    typeof process !== 'undefined' ? process.env.VINA_PARALLEL_SLOTS : undefined,
  );
  if (Number.isFinite(slots) && slots > 0) {
    return Math.max(1, Math.min(4, Math.trunc(slots)));
  }
  const workers = Number(
    typeof process !== 'undefined' ? process.env.VINA_DAEMON_WORKERS : undefined,
  );
  if (Number.isFinite(workers) && workers > 0) {
    return Math.max(1, Math.min(4, Math.trunc(workers)));
  }
  return 1;
}

export function resolveTtsBatchConcurrency(
  platform: string,
  override?: number,
): number {
  const plat = String(platform || '').toLowerCase().trim();

  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    const hardCap =
      plat === 'vina_voice'
        ? resolveVinaParallelSlotsClientSafe()
        : plat === 'omnivoice_local'
          ? 2
          : plat === 'piper'
            ? 16
            : 8;
    return Math.max(1, Math.min(hardCap, Math.trunc(override)));
  }

  const env = Number(
    (typeof process !== 'undefined' &&
      (process.env.TTS_BATCH_CONCURRENCY ||
        process.env.TTS_MULTI_CONCURRENCY ||
        (plat === 'piper' ? process.env.PIPER_BATCH_CONCURRENCY : ''))) ||
      '',
  );
  if (Number.isFinite(env) && env > 0) {
    return resolveTtsBatchConcurrency(plat, env);
  }

  switch (plat) {
    case 'vina_voice':
      // = số worker daemon nóng = số request song song cùng 1 ref
      return resolveVinaParallelSlotsClientSafe();
    case 'omnivoice_local':
      return 1;
    case 'piper':
      // Same model multi-process — default 8 (CPU); override PIPER_BATCH_CONCURRENCY
      return 8;
    case 'edge_tts':
      // Cap-style fan-out: async pool (rate-limit aware)
      return 16;
    case 'google':
      // Google Cloud TTS — high fan-out for 30′ / ~500 cues
      return 24;
    case 'gemini_tts':
      // Google AI Studio TTS — pool with key rotate
      return 16;
    case 'tiktok_tts':
    case 'vieneu_tts':
    case 'openai_tts':
    case 'capcut_tts':
      return 8;
    default:
      return 4;
  }
}
