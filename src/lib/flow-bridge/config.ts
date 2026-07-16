/** Flow Bridge ports — offset from stock Flow Agent (9222/8100) to avoid clash. */
export const FLOW_WS_PORT = Number(process.env.AINOVEL_FLOW_WS_PORT || 9223);
export const FLOW_HTTP_PORT = Number(process.env.AINOVEL_FLOW_HTTP_PORT || 8101);
export const FLOW_HOST = '127.0.0.1';

/** Browser-restricted public key used by labs.google Flow clients. */
export const FLOW_PUBLIC_API_KEY =
  process.env.AINOVEL_FLOW_API_KEY ||
  'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';

export const FLOW_BASE = 'https://aisandbox-pa.googleapis.com';

/** Aligns with FlowAgent deep-dive: rate limit, retry/slide, token lifecycle. */
export const FLOW_DEFAULTS = {
  imageModel: 'GEM_PIX_2',
  /**
   * Defaults match Google Flow labs (TIER_ONE-safe first).
   * Ultra / low-priority keys are optional UI picks — never silent fallback (B10).
   */
  videoModelT2vLandscape: 'veo_3_1_t2v_fast',
  videoModelT2vPortrait: 'veo_3_1_t2v_fast_portrait',
  videoModelT2vLandscapeUltra: 'veo_3_1_t2v_fast_ultra',
  videoModelT2vPortraitUltra: 'veo_3_1_t2v_fast_portrait_ultra',
  /** Prefer non-ultra first (TIER_ONE accounts) */
  videoModelI2vLandscape: 'veo_3_1_i2v_s_fast',
  videoModelI2vPortrait: 'veo_3_1_i2v_s_fast_portrait',
  videoModelI2vLandscapeUltra: 'veo_3_1_i2v_s_fast_ultra',
  videoModelI2vPortraitUltra: 'veo_3_1_i2v_s_fast_portrait_ultra',
  /** First+last frame (start_end_frame_2_video) */
  videoModelI2vFirstLastLandscape: 'veo_3_1_i2v_s_fast_fl',
  videoModelI2vFirstLastPortrait: 'veo_3_1_i2v_s_fast_portrait_fl',
  /** Ingredients / R2V — aisandbox key is r2v (not legacy reference_fast) */
  videoModelReferenceLandscape: 'veo_3_1_r2v_fast',
  videoModelReferencePortrait: 'veo_3_1_r2v_fast_portrait',
  /** Extend existing clip */
  videoModelExtend: 'veo_3_1_extend_fast',
  /** Flow Veo clip length: 4 | 6 | 8 only (default 8s) */
  videoDurationSec: 8,
  videoDurationsSec: [4, 6, 8] as const,
  /** Native output before upsample */
  nativeVideoScale: '720p' as const,
  /** Human-like delay between tasks (ms) — FlowAgent delay_min/max */
  delayMsMin: 5000,
  delayMsMax: 10000,
  concurrency: 1,
  maxAccountsParallel: 3,
  videoPollMs: 4000,
  videoPollMax: 90,
  /**
   * Anti-spam (vs FlowAgent + labs rate limits):
   * - Fewer retries than 5×30s (was 17min spam on upload timeout)
   * - Extension WS: min gap between api_request
   * - Upload: only N shapes, abort remaining on first timeout
   * - Client batch Flow: concurrency 1 + itemGapMs (see jobQueue / useImagePromptActions)
   */
  maxRetries: 3,
  /** Network/timeout: stop earlier than hard errors */
  maxRetriesNetwork: 2,
  retryDelayMs: 15_000,
  /** Min quiet time between extension api_request (ms) */
  extensionMinGapMs: 900,
  /** After each runOne success/fail — human gap before next shot (ms) */
  runOneGapMsMin: 4000,
  runOneGapMsMax: 8000,
  /** uploadImage body shapes to try (FlowAgent primary first) */
  maxUploadShapes: 2,
  /** Client batch: Flow image/video must be sequential */
  clientFlowBatchConcurrency: 1,
  /** Client batch gap between shots when provider=flow (ms) */
  clientFlowItemGapMs: 4500,
  /** Token refresh before ~60min expiry */
  tokenRefreshMs: 45 * 60 * 1000,
  /** Account cooldown after slide-off (ms) */
  accountCooldownMs: 60_000,
} as const;
