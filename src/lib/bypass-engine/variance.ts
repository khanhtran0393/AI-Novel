/**
 * Phantom-X — random deviation of BỘ lọc chính default parameters.
 * When enabled: each default factor is jittered by ±percent (clamped to safe ranges).
 * Encode CQ/CRF also supports ±1 absolute jitter for file-size / rate-curve diversity.
 */

export type BypassVarianceOpts = {
  /** Tick "Ngẫu nhiên" */
  enabled: boolean;
  /**
   * Allowed deviation from defaults, 0–100 (e.g. 3 → ±3%).
   * Khuyến nghị giữ khung hình tổng thể:
   *   - Mặc định: 3%
   *   - Cảnh báo từ: 5% trở lên
   */
  percent: number;
  /** Optional seed for reproducible encodes */
  seed?: number;
};

/** % lệch khuyến nghị — tránh vỡ khung hình tổng thể */
export const VARIANCE_RECOMMENDED = {
  /** Default khi bật Ngẫu nhiên */
  defaultPercent: 3,
  /** Trần khuyến nghị / mức bắt đầu cảnh báo */
  safeMaxPercent: 5,
  /** Trần khi bật Grid (cùng 5% — micro only) */
  safeMaxPercentWithGrid: 5,
  /** Trên mức này coi là rủi ro cao (cảnh báo mạnh) */
  dangerAbovePercent: 5,
} as const;

/** Resolved numeric factors after optional random walk from defaults. */
export type BypassParams = {
  /** Phantom crop border px per side (default 1 → crop iw-2) — edge mask */
  phantomBorder: number;
  /** Soft vignette strength 0 = off (edge mask complement) */
  vignetteAngle: number;
  /** noise=alls= */
  noiseAlls: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  /** zoom step per frame (light micro-zoom) */
  zoomStep: number;
  /** max zoom factor */
  zoomMax: number;
  atempo: number;
  /** multiplier on 44100 sample rate */
  asetrateFactor: number;
  /** Stereo Haas delay left channel (ms) — Stealth adelay=L|0 */
  stereoDelayMs: number;
  /** vibrato frequency Hz */
  vibratoFreq: number;
  /** vibrato depth 0–1 */
  vibratoDepth: number;
  /** Brown noise amplitude (sub-audible floor) */
  brownNoiseAmp: number;
  /** amix weight for brown noise (second input) */
  brownNoiseMixWeight: number;
  /** Micro chorus delay ms param */
  chorusDelay: number;
  trebleGainDb: number;
  trebleFreq: number;
  bassGainDb: number;
  bassFreq: number;
  gop: number;
  keyintMin: number;
  /** B-frames (libx264 / NVENC when supported) */
  bFrames: number;
  /** libx264 refs */
  refs: number;
  /** NVENC CQ — Quality path baseline (then ± jitter) */
  cqQuality: number;
  /** NVENC CQ — Turbo path */
  cqTurbo: number;
  /** libx264 CRF — Quality */
  crfQuality: number;
  /** libx264 CRF — Turbo */
  crfTurbo: number;
  /** rotate-border crop ratio (default 0.95) */
  rotateCropRatio: number;
  /** per-stream rotate angles in degrees (grid) */
  rotateAngles: {
    '1x2': number[];
    '2x1': number[];
    '2x2': number[];
  };
  /** human summary of applied variance */
  summary: string;
};

/** Canonical defaults — BỘ lọc chính baseline (no random). */
export const BYPASS_DEFAULTS = {
  phantomBorder: 1,
  /** ~PI/5 mild; 0 disables vignette fragment */
  vignetteAngle: 0.628,
  noiseAlls: 1,
  brightness: 0.005,
  contrast: 1.01,
  saturation: 1.015,
  gamma: 0.99,
  /** Lighter than legacy 0.0005 / 1.05 — less CPU blur */
  zoomStep: 0.0003,
  zoomMax: 1.03,
  /** Stealth Audio — micro pitch/tempo (1.001) */
  atempo: 1.001,
  asetrateFactor: 1.001,
  /** Comb-filter mono killer: 2ms left delay */
  stereoDelayMs: 2,
  vibratoFreq: 2,
  vibratoDepth: 0.1,
  /** Sub-audible brown noise */
  brownNoiseAmp: 0.005,
  brownNoiseMixWeight: 0.05,
  chorusDelay: 55,
  trebleGainDb: 1.5,
  trebleFreq: 8000,
  bassGainDb: -1,
  bassFreq: 100,
  gop: 47,
  keyintMin: 23,
  bFrames: 2,
  refs: 3,
  /** Encoder quality ladders (absolute CQ/CRF; variance ±1) */
  cqQuality: 19,
  cqTurbo: 26,
  crfQuality: 18,
  crfTurbo: 25,
  rotateCropRatio: 0.95,
  rotateAngles: {
    '1x2': [-3, 2],
    '2x1': [-2.5, 2.5],
    '2x2': [-3, 2, -1.5, 3],
  },
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/** Simple mulberry32 PRNG — deterministic if seed provided. */
function makeRng(seed?: number): () => number {
  let s =
    seed != null && Number.isFinite(seed)
      ? seed >>> 0
      : (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Jitter: base * (1 + u) where u ∈ [−p, +p], p = percent/100.
 * For near-zero bases (brightness), use absolute step: base ± |base|*p (or tiny floor).
 */
function jitter(base: number, percent: number, rnd: () => number, absFloor = 0): number {
  if (percent <= 0) return base;
  const p = percent / 100;
  const u = (rnd() * 2 - 1) * p; // [-p, +p]
  if (Math.abs(base) < 1e-9) {
    return absFloor * u;
  }
  return base * (1 + u);
}

/** Absolute integer jitter in [−span, +span] inclusive (for CQ/CRF file-size diversity). */
function jitterAbsInt(base: number, span: number, rnd: () => number): number {
  if (span <= 0) return Math.round(base);
  const delta = Math.floor(rnd() * (span * 2 + 1)) - span;
  return Math.round(base) + delta;
}

export function normalizeVariance(raw: unknown): BypassVarianceOpts {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = Boolean(o.enabled ?? o.random ?? false);
  let percent = Number(o.percent ?? o.randomPercent ?? VARIANCE_RECOMMENDED.defaultPercent);
  if (!Number.isFinite(percent)) percent = VARIANCE_RECOMMENDED.defaultPercent;
  percent = clamp(percent, 0, 100);
  const seedRaw = o.seed;
  const seed =
    seedRaw != null && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) : undefined;
  return { enabled, percent, seed };
}

/**
 * Build final param set from defaults ± random%.
 * CQ/CRF always get a tiny absolute walk when variance on (±1).
 */
export function resolveBypassParams(variance?: BypassVarianceOpts | null): BypassParams {
  const v = variance?.enabled
    ? { enabled: true, percent: clamp(Number(variance.percent) || 0, 0, 100), seed: variance.seed }
    : { enabled: false, percent: 0, seed: variance?.seed };

  const baseParams = (): BypassParams => ({
    phantomBorder: BYPASS_DEFAULTS.phantomBorder,
    vignetteAngle: BYPASS_DEFAULTS.vignetteAngle,
    noiseAlls: BYPASS_DEFAULTS.noiseAlls,
    brightness: BYPASS_DEFAULTS.brightness,
    contrast: BYPASS_DEFAULTS.contrast,
    saturation: BYPASS_DEFAULTS.saturation,
    gamma: BYPASS_DEFAULTS.gamma,
    zoomStep: BYPASS_DEFAULTS.zoomStep,
    zoomMax: BYPASS_DEFAULTS.zoomMax,
    atempo: BYPASS_DEFAULTS.atempo,
    asetrateFactor: BYPASS_DEFAULTS.asetrateFactor,
    stereoDelayMs: BYPASS_DEFAULTS.stereoDelayMs,
    vibratoFreq: BYPASS_DEFAULTS.vibratoFreq,
    vibratoDepth: BYPASS_DEFAULTS.vibratoDepth,
    brownNoiseAmp: BYPASS_DEFAULTS.brownNoiseAmp,
    brownNoiseMixWeight: BYPASS_DEFAULTS.brownNoiseMixWeight,
    chorusDelay: BYPASS_DEFAULTS.chorusDelay,
    trebleGainDb: BYPASS_DEFAULTS.trebleGainDb,
    trebleFreq: BYPASS_DEFAULTS.trebleFreq,
    bassGainDb: BYPASS_DEFAULTS.bassGainDb,
    bassFreq: BYPASS_DEFAULTS.bassFreq,
    gop: BYPASS_DEFAULTS.gop,
    keyintMin: BYPASS_DEFAULTS.keyintMin,
    bFrames: BYPASS_DEFAULTS.bFrames,
    refs: BYPASS_DEFAULTS.refs,
    cqQuality: BYPASS_DEFAULTS.cqQuality,
    cqTurbo: BYPASS_DEFAULTS.cqTurbo,
    crfQuality: BYPASS_DEFAULTS.crfQuality,
    crfTurbo: BYPASS_DEFAULTS.crfTurbo,
    rotateCropRatio: BYPASS_DEFAULTS.rotateCropRatio,
    rotateAngles: {
      '1x2': [...BYPASS_DEFAULTS.rotateAngles['1x2']],
      '2x1': [...BYPASS_DEFAULTS.rotateAngles['2x1']],
      '2x2': [...BYPASS_DEFAULTS.rotateAngles['2x2']],
    },
    summary: 'mặc định (không ngẫu nhiên)',
  });

  if (!v.enabled || v.percent <= 0) {
    return baseParams();
  }

  const rnd = makeRng(v.seed);
  const pct = v.percent;

  const phantomBorder = Math.max(
    1,
    Math.round(jitter(BYPASS_DEFAULTS.phantomBorder, pct, rnd)),
  );
  const vignetteAngle = round(
    clamp(jitter(BYPASS_DEFAULTS.vignetteAngle, pct, rnd), 0, 1.2),
    4,
  );
  const noiseAlls = round(clamp(jitter(BYPASS_DEFAULTS.noiseAlls, pct, rnd), 0.2, 8), 3);
  const brightness = round(clamp(jitter(BYPASS_DEFAULTS.brightness, pct, rnd), -0.05, 0.05), 5);
  const contrast = round(clamp(jitter(BYPASS_DEFAULTS.contrast, pct, rnd), 0.9, 1.15), 4);
  const saturation = round(clamp(jitter(BYPASS_DEFAULTS.saturation, pct, rnd), 0.9, 1.2), 4);
  const gamma = round(clamp(jitter(BYPASS_DEFAULTS.gamma, pct, rnd), 0.9, 1.1), 4);
  const zoomStep = round(clamp(jitter(BYPASS_DEFAULTS.zoomStep, pct, rnd), 0.0001, 0.0015), 6);
  const zoomMax = round(clamp(jitter(BYPASS_DEFAULTS.zoomMax, pct, rnd), 1.01, 1.08), 4);
  // Stealth audio — tight clamps so random ≤5% never destroys listen quality
  const atempo = round(clamp(jitter(BYPASS_DEFAULTS.atempo, pct, rnd), 0.995, 1.01), 5);
  const asetrateFactor = round(
    clamp(jitter(BYPASS_DEFAULTS.asetrateFactor, pct, rnd), 0.995, 1.01),
    5,
  );
  const stereoDelayMs = round(clamp(jitter(BYPASS_DEFAULTS.stereoDelayMs, pct, rnd), 1, 3), 2);
  const vibratoFreq = round(clamp(jitter(BYPASS_DEFAULTS.vibratoFreq, pct, rnd), 1, 4), 3);
  const vibratoDepth = round(clamp(jitter(BYPASS_DEFAULTS.vibratoDepth, pct, rnd), 0.05, 0.15), 4);
  const brownNoiseAmp = round(
    clamp(jitter(BYPASS_DEFAULTS.brownNoiseAmp, pct, rnd), 0.002, 0.012),
    5,
  );
  const brownNoiseMixWeight = round(
    clamp(jitter(BYPASS_DEFAULTS.brownNoiseMixWeight, pct, rnd), 0.02, 0.1),
    4,
  );
  const chorusDelay = round(clamp(jitter(BYPASS_DEFAULTS.chorusDelay, pct, rnd), 40, 70), 2);
  const trebleGainDb = round(clamp(jitter(BYPASS_DEFAULTS.trebleGainDb, pct, rnd), 0.5, 2.5), 3);
  const trebleFreq = Math.round(clamp(jitter(BYPASS_DEFAULTS.trebleFreq, pct, rnd), 6000, 10000));
  const bassGainDb = round(clamp(jitter(BYPASS_DEFAULTS.bassGainDb, pct, rnd), -2, 0), 3);
  const bassFreq = Math.round(clamp(jitter(BYPASS_DEFAULTS.bassFreq, pct, rnd), 60, 150));
  const gop = Math.max(15, Math.round(jitter(BYPASS_DEFAULTS.gop, pct, rnd)));
  const keyintMin = Math.max(
    8,
    Math.min(gop - 1, Math.round(jitter(BYPASS_DEFAULTS.keyintMin, pct, rnd))),
  );
  const bFrames = clamp(Math.round(jitter(BYPASS_DEFAULTS.bFrames, pct, rnd)), 0, 3);
  const refs = clamp(Math.round(jitter(BYPASS_DEFAULTS.refs, pct, rnd)), 2, 4);
  // File-size / rate-curve diversity: absolute ±1 CQ/CRF
  const cqQuality = clamp(jitterAbsInt(BYPASS_DEFAULTS.cqQuality, 1, rnd), 16, 28);
  const cqTurbo = clamp(jitterAbsInt(BYPASS_DEFAULTS.cqTurbo, 1, rnd), 20, 32);
  const crfQuality = clamp(jitterAbsInt(BYPASS_DEFAULTS.crfQuality, 1, rnd), 15, 26);
  const crfTurbo = clamp(jitterAbsInt(BYPASS_DEFAULTS.crfTurbo, 1, rnd), 20, 30);
  const rotateCropRatio = round(
    clamp(jitter(BYPASS_DEFAULTS.rotateCropRatio, pct, rnd), 0.88, 0.99),
    4,
  );

  const jitterAngles = (angles: readonly number[]) =>
    angles.map((a) => round(jitter(a, pct, rnd), 3));

  return {
    phantomBorder,
    vignetteAngle,
    noiseAlls,
    brightness,
    contrast,
    saturation,
    gamma,
    zoomStep,
    zoomMax,
    atempo,
    asetrateFactor,
    stereoDelayMs,
    vibratoFreq,
    vibratoDepth,
    brownNoiseAmp,
    brownNoiseMixWeight,
    chorusDelay,
    trebleGainDb,
    trebleFreq,
    bassGainDb,
    bassFreq,
    gop,
    keyintMin,
    bFrames,
    refs,
    cqQuality,
    cqTurbo,
    crfQuality,
    crfTurbo,
    rotateCropRatio,
    rotateAngles: {
      '1x2': jitterAngles(BYPASS_DEFAULTS.rotateAngles['1x2']),
      '2x1': jitterAngles(BYPASS_DEFAULTS.rotateAngles['2x1']),
      '2x2': jitterAngles(BYPASS_DEFAULTS.rotateAngles['2x2']),
    },
    summary: `ngẫu nhiên ±${pct}% · CQ/CRF ±1`,
  };
}
