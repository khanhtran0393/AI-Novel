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
  videoModelT2vLandscape: 'veo_3_1_t2v_fast_ultra',
  videoModelT2vPortrait: 'veo_3_1_t2v_fast_portrait_ultra',
  /** Prefer non-ultra first (TIER_ONE accounts); ultra as fallback */
  videoModelI2vLandscape: 'veo_3_1_i2v_s_fast',
  videoModelI2vPortrait: 'veo_3_1_i2v_s_fast_portrait',
  videoModelI2vLandscapeUltra: 'veo_3_1_i2v_s_fast_ultra',
  videoModelI2vPortraitUltra: 'veo_3_1_i2v_s_fast_portrait_ultra',
  /** Human-like delay between tasks (ms) — FlowAgent delay_min/max */
  delayMsMin: 5000,
  delayMsMax: 10000,
  concurrency: 1,
  maxAccountsParallel: 3,
  videoPollMs: 4000,
  videoPollMax: 90,
  /** FlowAgent: max 5 retries, 30s pause on 403/network */
  maxRetries: 5,
  retryDelayMs: 30_000,
  /** Token refresh before ~60min expiry */
  tokenRefreshMs: 45 * 60 * 1000,
  /** Account cooldown after slide-off (ms) */
  accountCooldownMs: 60_000,
} as const;
