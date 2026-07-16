/**
 * Google Flow (labs.google) model matrix — aisandbox videoModelKey / imageModelName.
 *
 * Source (2026-07):
 * - Observed Flow keys via aisandbox-pa (T2V/I2V/R2V/extend/upsample)
 * - Community reverse catalog (flowkit models.json + fk-change-model)
 * - Google Flow credit matrix (AI Pro / Ultra) + Veo 3.1 duration/resolution docs
 *
 * Credits: base = one clip at defaultDurationSec (8s). Pro/Ultra differ for Lite/Fast.
 * Duration options on Flow: 4 / 6 / 8 seconds only (not 10).
 * Native video scale: 720p; HD/4K via upsample models.
 */

export type FlowModelKind = 'image' | 'video';

export type FlowVideoFamily = 't2v' | 'i2v' | 'reference' | 'extend' | 'upsample';

export type FlowModelEntry = {
  id: string;
  label: string;
  kind: FlowModelKind;
  /**
   * Flow credits on Google AI **Pro** (base duration / one generation).
   * Ultra halves Lite+Fast; Quality stays 100.
   */
  credits: number;
  /** Flow credits on Google AI **Ultra** when different from Pro */
  creditsUltra?: number;
  tier: 'free' | 'lite' | 'fast' | 'quality' | 'ultra';
  family?: FlowVideoFamily;
  /** Allowed clip lengths (video only). Flow Veo: 4 | 6 | 8 */
  durationsSec?: number[];
  /** Default length when UI empty */
  defaultDurationSec?: number;
  /** Native output scale before upscale */
  nativeScale?: '720p' | '1080p' | '1k' | '2k' | '4k';
  portraitVariant?: string;
  /** First+last frame (_fl) sibling for I2V chained */
  firstLastVariant?: string;
  supportsIngredients?: boolean;
  supportsExtend?: boolean;
  supportsI2v?: boolean;
  supportsT2v?: boolean;
  supportsFirstLast?: boolean;
  /** PAYGATE / service tier notes */
  paygateNote?: string;
  note?: string;
  /** Hide portrait-only keys from primary dropdown (resolved via portraitVariant) */
  uiHidden?: boolean;
};

/** Flow video aspect ratios only (aisandbox rejects others). */
export const FLOW_VIDEO_ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 Landscape', flowEnum: 'VIDEO_ASPECT_RATIO_LANDSCAPE' },
  { id: '9:16', label: '9:16 Portrait', flowEnum: 'VIDEO_ASPECT_RATIO_PORTRAIT' },
] as const;

/** Flow image aspect ratios (common UI → IMAGE_ASPECT_RATIO_*). */
export const FLOW_IMAGE_ASPECT_RATIOS = [
  { id: '16:9', label: '16:9 Wide' },
  { id: '9:16', label: '9:16 Tall' },
  { id: '1:1', label: '1:1 Square' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:5', label: '4:5' },
] as const;

/** Canonical Flow video durations (seconds). */
export const FLOW_VIDEO_DURATIONS_SEC = [4, 6, 8] as const;
export const FLOW_DEFAULT_VIDEO_DURATION_SEC = 8;

export const FLOW_IMAGE_MODELS: FlowModelEntry[] = [
  {
    id: 'GEM_PIX_2',
    label: 'GEM_PIX_2 (Flow default / Nano Banana Pro path)',
    kind: 'image',
    credits: 2,
    creditsUltra: 2,
    tier: 'quality',
    nativeScale: '1k',
    note: 'Flow imageModelName default — maps NANO_BANANA_PRO UI path',
  },
  {
    id: 'NARWHAL',
    label: 'NARWHAL (Nano Banana 2)',
    kind: 'image',
    credits: 0,
    creditsUltra: 0,
    tier: 'fast',
    nativeScale: '1k',
    note: 'Flow maps NANO_BANANA_2 → NARWHAL; often 0–1 credit',
  },
  {
    id: 'NANO_BANANA_2',
    label: 'Nano Banana 2 (alias → NARWHAL)',
    kind: 'image',
    credits: 0,
    tier: 'fast',
    nativeScale: '1k',
    note: 'UI alias; payload should prefer NARWHAL',
  },
  {
    id: 'NANO_BANANA_2_LITE',
    label: 'Nano Banana 2 Lite',
    kind: 'image',
    credits: 0,
    tier: 'lite',
    nativeScale: '1k',
  },
  {
    id: 'NANO_BANANA_PRO',
    label: 'Nano Banana Pro (alias → GEM_PIX_2)',
    kind: 'image',
    credits: 2,
    tier: 'quality',
    nativeScale: '1k',
    note: 'UI alias; payload should prefer GEM_PIX_2',
  },
  {
    id: 'IMAGEN_3_5',
    label: 'Imagen 3.5',
    kind: 'image',
    credits: 2,
    tier: 'quality',
    nativeScale: '1k',
  },
  {
    id: 'IMAGEN_4',
    label: 'Imagen 4',
    kind: 'image',
    credits: 3,
    tier: 'ultra',
    nativeScale: '1k',
  },
];

const V_DUR = [...FLOW_VIDEO_DURATIONS_SEC];
const V_DEF = FLOW_DEFAULT_VIDEO_DURATION_SEC;

export const FLOW_VIDEO_MODELS: FlowModelEntry[] = [
  // ─── T2V ───────────────────────────────────────────────
  {
    id: 'veo_3_1_t2v_fast',
    label: 'Veo 3.1 T2V Fast',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_t2v_fast_portrait',
    supportsT2v: true,
    paygateNote: 'TIER_ONE+',
  },
  {
    id: 'veo_3_1_t2v_fast_portrait',
    label: 'Veo 3.1 T2V Fast (Portrait)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_t2v_fast_ultra',
    label: 'Veo 3.1 T2V Fast Ultra',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_t2v_fast_portrait_ultra',
    supportsT2v: true,
    paygateNote: 'TIER_TWO / Ultra queue',
  },
  {
    id: 'veo_3_1_t2v_fast_portrait_ultra',
    label: 'Veo 3.1 T2V Fast Ultra (Portrait)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_lite_t2v',
    label: 'Veo 3.1 Lite T2V',
    kind: 'video',
    credits: 10,
    creditsUltra: 5,
    tier: 'lite',
    family: 't2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsT2v: true,
    note: 'Cheap iterate · ~Lite credit band',
  },

  // ─── I2V ───────────────────────────────────────────────
  {
    id: 'veo_3_1_i2v_s_fast',
    label: 'Veo 3.1 I2V Fast (TIER_ONE)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait',
    firstLastVariant: 'veo_3_1_i2v_s_fast_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    paygateNote: 'TIER_ONE default frame_2_video',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait',
    label: 'Veo 3.1 I2V Fast Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_fl',
    label: 'Veo 3.1 I2V Fast First+Last',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    note: 'start_end_frame_2_video (TIER_ONE)',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_fl',
    label: 'Veo 3.1 I2V Fast First+Last Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    supportsFirstLast: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra',
    label: 'Veo 3.1 I2V Fast Ultra',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_ultra',
    firstLastVariant: 'veo_3_1_i2v_s_fast_ultra_fl',
    supportsI2v: true,
    supportsFirstLast: true,
    paygateNote: 'TIER_TWO',
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_ultra',
    label: 'Veo 3.1 I2V Fast Ultra Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra_fl',
    label: 'Veo 3.1 I2V Ultra First+Last',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    supportsI2v: true,
    supportsFirstLast: true,
  },
  {
    id: 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    label: 'Veo 3.1 I2V Ultra First+Last Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    supportsFirstLast: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_i2v_lite',
    label: 'Veo 3.1 I2V Lite',
    kind: 'video',
    credits: 10,
    creditsUltra: 5,
    tier: 'lite',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    note: 'Lite band · no R2V · ~5–10 cr / 8s',
  },
  {
    id: 'veo_3_1_i2v_lite_low_priority',
    label: 'Veo 3.1 I2V Lite Low Priority (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    paygateNote: 'Works SERVICE_TIER_ADVANCED · slower queue',
    note: 'TRUE 0-credit low priority',
  },
  {
    id: 'veo_3_1_i2v_s_fast_ultra_relaxed',
    label: 'Veo 3.1 I2V Ultra Relaxed (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'i2v',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsI2v: true,
    paygateNote: 'Needs SERVICE_TIER_ULTRA — silent empty ops on ADVANCED',
    note: 'Low-priority ultra quality',
  },

  // ─── R2V / Ingredients ─────────────────────────────────
  {
    id: 'veo_3_1_r2v_fast',
    label: 'Veo 3.1 R2V / Ingredients Fast',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_1_r2v_fast_portrait',
    supportsIngredients: true,
    supportsI2v: true,
    paygateNote: 'TIER_ONE reference_frame_2_video',
  },
  {
    id: 'veo_3_1_r2v_fast_portrait',
    label: 'Veo 3.1 R2V Fast Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_0_r2v_fast_ultra',
    label: 'Veo 3.0 R2V Fast Ultra',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    portraitVariant: 'veo_3_0_r2v_fast_portrait_ultra',
    supportsIngredients: true,
    paygateNote: 'TIER_TWO ingredients',
  },
  {
    id: 'veo_3_0_r2v_fast_portrait_ultra',
    label: 'Veo 3.0 R2V Ultra Portrait',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'ultra',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    uiHidden: true,
  },
  {
    id: 'veo_3_1_r2v_fast_landscape_ultra_relaxed',
    label: 'Veo 3.1 R2V Ultra Relaxed (0 cr)',
    kind: 'video',
    credits: 0,
    creditsUltra: 0,
    tier: 'free',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    paygateNote: 'SERVICE_TIER_ULTRA only',
  },
  /** Legacy alias still seen in older app configs — maps family reference */
  {
    id: 'veo_3_1_reference_fast',
    label: 'Veo 3.1 Reference Fast (legacy → r2v)',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'quality',
    family: 'reference',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsIngredients: true,
    supportsI2v: true,
    note: 'Legacy key; prefer veo_3_1_r2v_fast',
  },

  // ─── Extend ────────────────────────────────────────────
  {
    id: 'veo_3_1_extend_fast',
    label: 'Veo 3.1 Extend Fast',
    kind: 'video',
    credits: 20,
    creditsUltra: 10,
    tier: 'fast',
    family: 'extend',
    durationsSec: V_DUR,
    defaultDurationSec: V_DEF,
    nativeScale: '720p',
    supportsExtend: true,
    note: 'Continue from existing Flow clip (~+7s band)',
  },

  // ─── Upsample ──────────────────────────────────────────
  {
    id: 'veo_3_1_upsampler_1080p',
    label: 'Veo Upsample 1080p (HD)',
    kind: 'video',
    credits: 4,
    creditsUltra: 4,
    tier: 'fast',
    family: 'upsample',
    nativeScale: '1080p',
    note: 'Post-gen scale 720p → 1080p',
  },
  {
    id: 'veo_3_1_upsampler_4k',
    label: 'Veo Upsample 4K',
    kind: 'video',
    credits: 8,
    creditsUltra: 8,
    tier: 'ultra',
    family: 'upsample',
    nativeScale: '4k',
    note: 'Post-gen scale → 4K (Ultra plan)',
  },
];

export const FLOW_QUALITY_PRESETS = [
  {
    id: '1k',
    label: '1K / 720p native (no upscale)',
    imageUpscale: null as null,
    videoUpscale: null as null,
    nativeScale: '720p' as const,
  },
  {
    id: 'hd',
    label: 'HD 1080p (video upsample)',
    imageUpscale: null,
    videoUpscale: 'fhd' as const,
    nativeScale: '1080p' as const,
  },
  {
    id: '2k',
    label: '2K image upsample',
    imageUpscale: '2k' as const,
    videoUpscale: 'fhd' as const,
    nativeScale: '2k' as const,
  },
  {
    id: '4k',
    label: '4K upsample',
    imageUpscale: '4k' as const,
    videoUpscale: '4k' as const,
    nativeScale: '4k' as const,
  },
] as const;

/** Map UI / legacy image aliases to real Flow imageModelName. */
export function resolveFlowImageModelName(id?: string): string {
  const raw = String(id || '').trim();
  if (!raw || raw === 'flow' || raw === 'imagen') return 'GEM_PIX_2';
  const upper = raw.toUpperCase();
  if (upper === 'NANO_BANANA_PRO' || upper === 'NANO_BANANA') return 'GEM_PIX_2';
  if (upper === 'NANO_BANANA_2' || upper === 'NANO_BANANA2') return 'NARWHAL';
  return raw;
}

export function findFlowModel(id: string): FlowModelEntry | undefined {
  const key = String(id || '').trim();
  if (!key) return undefined;
  return (
    FLOW_IMAGE_MODELS.find((m) => m.id === key || m.id.toUpperCase() === key.toUpperCase()) ||
    FLOW_VIDEO_MODELS.find((m) => m.id === key)
  );
}

export function listFlowVideoModelsForUi(opts?: {
  family?: FlowVideoFamily | 'all';
  includeHidden?: boolean;
}): FlowModelEntry[] {
  const fam = opts?.family || 'all';
  return FLOW_VIDEO_MODELS.filter((m) => {
    if (!opts?.includeHidden && m.uiHidden) return false;
    if (fam !== 'all' && m.family && m.family !== fam) return false;
    return true;
  });
}

export function listFlowImageModelsForUi(): FlowModelEntry[] {
  // Prefer real keys; keep aliases for display clarity
  return FLOW_IMAGE_MODELS.filter((m) => !m.uiHidden);
}

/** Clamp duration to Flow-legal set for a model (or global 4/6/8). */
export function clampFlowVideoDuration(
  durationSec: number | undefined,
  modelId?: string,
): number {
  const model = modelId ? findFlowModel(modelId) : undefined;
  const allowed = model?.durationsSec?.length
    ? model.durationsSec
    : [...FLOW_VIDEO_DURATIONS_SEC];
  const def = model?.defaultDurationSec ?? FLOW_DEFAULT_VIDEO_DURATION_SEC;
  const n = Number(durationSec);
  if (!Number.isFinite(n) || n <= 0) return def;
  if (allowed.includes(n)) return n;
  // nearest allowed
  return allowed.reduce((best, cur) =>
    Math.abs(cur - n) < Math.abs(best - n) ? cur : best,
  );
}

export function getModelDurations(modelId?: string): number[] {
  const m = modelId ? findFlowModel(modelId) : undefined;
  if (m?.durationsSec?.length) return [...m.durationsSec];
  return [...FLOW_VIDEO_DURATIONS_SEC];
}

/**
 * Credit estimate aligned to Flow Pro (default) or Ultra.
 * Scales linearly with duration / 8s base for video gen models.
 */
export function estimateTaskCredits(opts: {
  kind: 'image' | 'video';
  modelId?: string;
  imageCount?: number;
  quality?: string;
  durationSec?: number;
  /** 'pro' (default) | 'ultra' */
  paygate?: 'pro' | 'ultra';
}): number {
  const model =
    findFlowModel(opts.modelId || '') ||
    (opts.kind === 'image' ? FLOW_IMAGE_MODELS[0] : FLOW_VIDEO_MODELS[0]);
  const paygate = opts.paygate === 'ultra' ? 'ultra' : 'pro';
  let base =
    paygate === 'ultra' && model?.creditsUltra != null
      ? model.creditsUltra
      : (model?.credits ?? (opts.kind === 'image' ? 1 : 20));

  if (opts.kind === 'image') {
    base *= Math.max(1, Math.min(4, opts.imageCount || 1));
  } else if (model?.family !== 'upsample') {
    const dur = clampFlowVideoDuration(opts.durationSec, opts.modelId);
    const def = model?.defaultDurationSec ?? FLOW_DEFAULT_VIDEO_DURATION_SEC;
    // Flow charges per clip; longer lengths cost proportionally within 4/6/8 band
    base = Math.round(base * (dur / def) * 100) / 100;
  }

  const q = (opts.quality || '').toLowerCase();
  if (q.includes('4k')) base += opts.kind === 'image' ? 2 : 8;
  else if (q.includes('2k') || q.includes('fhd') || q.includes('1080') || q === 'hd') {
    base += opts.kind === 'image' ? 1 : 4;
  }
  return base;
}

export function resolvePortraitModel(
  modelId: string | undefined,
  portrait: boolean,
): string | undefined {
  if (!modelId || !portrait) return modelId;
  const m = findFlowModel(modelId);
  return m?.portraitVariant || modelId;
}

/** Prefer first+last sibling when end frame is present. */
export function resolveFirstLastModel(
  modelId: string | undefined,
  hasEndFrame: boolean,
): string | undefined {
  if (!modelId || !hasEndFrame) return modelId;
  const m = findFlowModel(modelId);
  return m?.firstLastVariant || modelId;
}

export const FLOW_CATALOG_META = {
  source: 'Google Flow labs / aisandbox-pa model keys + Flow credit matrix',
  updatedAt: '2026-07-15',
  videoDurationsSec: FLOW_VIDEO_DURATIONS_SEC,
  defaultVideoDurationSec: FLOW_DEFAULT_VIDEO_DURATION_SEC,
  nativeVideoScale: '720p',
  videoAspectRatios: FLOW_VIDEO_ASPECT_RATIOS.map((r) => r.id),
  creditNote:
    'Pro: Lite≈10 Fast≈20 Quality≈100 / clip@8s. Ultra: Lite≈5 Fast≈10 Quality≈100. Low-priority keys=0.',
} as const;
