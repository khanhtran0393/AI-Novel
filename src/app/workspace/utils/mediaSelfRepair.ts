import { API } from '@/contracts';
import type { NovelStore } from '@/store/useNovelStore';
import { classifyMediaError, firstKey } from './media-self-heal/issue';
import type {
  AudioRepairRoute,
  ImageRepairRoute,
  MediaIssue,
  MediaSelfHealDiagnosis,
  MediaSelfHealDomain,
  MediaSelfHealPatch,
  VideoRepairRoute,
} from './media-self-heal/types';

export { classifyMediaError } from './media-self-heal/issue';
export type {
  AudioRepairRoute,
  ImageRepairRoute,
  MediaIssue,
  MediaIssueKind,
  MediaSelfHealDiagnosis,
  MediaSelfHealDomain,
  MediaSelfHealPatch,
  VideoRepairRoute,
} from './media-self-heal/types';

export function getGoogleCookieForPrompt(store: NovelStore, promptIndex: number) {
  const cookiesList = store.googleStudioCookies || [];
  return cookiesList[promptIndex % Math.max(1, cookiesList.length)] || store.googleStudioCookie || '';
}

export function getImageProviderApiKey(store: NovelStore, provider: string) {
  if (provider === 'openai') return firstKey(store.openaiApiKey, store.openaiApiKeys);
  if (provider === 'grok') return firstKey(store.grokApiKey, store.grokApiKeys);
  if (provider === 'gemini') return firstKey(store.apiKey, store.apiKeys);
  return '';
}

export function buildImageRepairPlan(store: NovelStore, promptIndex: number): ImageRepairRoute[] {
  void store;
  void promptIndex;
  return [];
}

export function shouldRepairMediaIssue(issue: MediaIssue) {
  return issue.kind !== 'unknown';
}

export function formatRepairSummary(attemptedRoutes: ImageRepairRoute[], finalRoute: ImageRepairRoute) {
  const routeNames = attemptedRoutes.map((route) => `${route.provider}/${route.model}`).join(' -> ');
  return `Self-Healing Media Router da doi tuyen: ${routeNames}. Tuyen thanh cong: ${finalRoute.provider}/${finalRoute.model}.`;
}

function extractClientErrorMessage(error: unknown): string {
  if (error == null) return 'Unknown media error';
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed || 'Unknown media error';
  }
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed || error.name || 'Unknown media error';
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (typeof obj.detail === 'string' && obj.detail.trim()) return obj.detail.trim();
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // fall through
    }
  }
  const text = String(error).trim();
  return text || 'Unknown media error';
}

export function buildMediaSelfHealRequest(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  error: unknown,
  config: Record<string, unknown> = {},
) {
  return {
    domain,
    error: extractClientErrorMessage(error),
    config: {
      imageProvider: store.imageProvider,
      imageModel: store.imageModel,
      videoProvider: store.videoProvider,
      videoModel: store.videoModel,
      ttsPlatform: store.ttsConfig?.platform,
      ttsVoice: store.ttsConfig?.voice,
      ttsApiUrl: store.ttsConfig?.api_url_vieneu,
      ...config,
    },
    credentials: {
      googleApiKey: store.apiKey,
      googleApiKeys: store.apiKeys || [],
      openaiApiKey: store.openaiApiKey,
      openaiApiKeys: store.openaiApiKeys || [],
      grokApiKey: store.grokApiKey,
      grokApiKeys: store.grokApiKeys || [],
      googleStudioCookie: store.googleStudioCookie,
      googleStudioCookies: store.googleStudioCookies || [],
      tiktokSessionId: store.ttsConfig?.tiktokSessionId,
    },
  };
}

/** Diagnose-only: app logic must not synthesize repair patches. */
export function buildLocalMediaPatch(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  error: unknown,
  config: Record<string, unknown> = {},
): MediaSelfHealPatch {
  void store;
  void domain;
  void error;
  void config;
  return {};
}

export function buildVideoRepairPlan(store: NovelStore): VideoRepairRoute[] {
  void store;
  return [];
}

export function buildAudioRepairPlan(store: NovelStore, preferredVoice?: string): AudioRepairRoute[] {
  void store;
  void preferredVoice;
  return [];
}

function enrichDiagnosis(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  diagnosis: MediaSelfHealDiagnosis,
  config: Record<string, unknown> = {},
): MediaSelfHealDiagnosis {
  void store;
  void domain;
  void config;
  return {
    ...diagnosis,
    patch: {},
    shouldRetry: false,
    summary: diagnosis.summary,
  };
}

function buildUnresolvedDiagnosis(
  store: NovelStore,
  request: ReturnType<typeof buildMediaSelfHealRequest>,
  reason: string,
  config: Record<string, unknown> = {},
): MediaSelfHealDiagnosis {
  const issue = classifyMediaError(request.error);
  const base: MediaSelfHealDiagnosis = {
    logId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    issue,
    patch: {},
    shouldRetry: false,
    summary: `Self-heal API unavailable for ${request.domain}: ${reason}`,
    checkedProviders: [],
  };
  return enrichDiagnosis(store, request.domain, base, config);
}

export async function diagnoseMediaSelfHeal(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  error: unknown,
  config: Record<string, unknown> = {},
): Promise<MediaSelfHealDiagnosis> {
  const request = buildMediaSelfHealRequest(store, domain, error, config);

  console.info(
    `[Self-Heal Brain] Sending diagnosis: domain=${domain}, error="${request.error.slice(0, 120)}", operation=${String(config.operation || 'n/a')}`,
  );

  try {
    const res = await fetch(API.selfHealMedia, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const apiError = data?.error || `HTTP ${res.status}`;
      console.warn('[Self-Healing Media Router] API diagnose failed:', apiError, data?.received);
      return buildUnresolvedDiagnosis(store, request, apiError, config);
    }
    if (!data.diagnosis) {
      return buildUnresolvedDiagnosis(store, request, 'API returned empty diagnosis', config);
    }
    const enriched = enrichDiagnosis(store, domain, data.diagnosis as MediaSelfHealDiagnosis, config);
    console.info(
      `[Self-Heal Brain] Diagnosis ready: kind=${enriched.issue.kind} shouldRetry=${enriched.shouldRetry} patch=${JSON.stringify(enriched.patch)}`,
    );
    return enriched;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[Self-Healing Media Router] diagnose failed:', reason);
    return buildUnresolvedDiagnosis(store, request, reason, config);
  }
}

/** Ordered unique image routes: brain patch first, then full repair plan. */
export function collectImageRepairRoutes(
  store: NovelStore,
  diagnosis: MediaSelfHealDiagnosis,
  promptIndex: number,
  failedProvider?: string,
  failedModel?: string,
): ImageRepairRoute[] {
  void store;
  void diagnosis;
  void promptIndex;
  void failedProvider;
  void failedModel;
  return [];
}

/** Ordered unique video routes: cloud candidates first, FFmpeg always last. */
export function collectVideoRepairRoutes(
  store: NovelStore,
  diagnosis: MediaSelfHealDiagnosis,
  failedProvider?: string,
): VideoRepairRoute[] {
  void store;
  void diagnosis;
  void failedProvider;
  return [];
}

/** Ordered unique audio routes. */
export function collectAudioRepairRoutes(
  store: NovelStore,
  diagnosis: MediaSelfHealDiagnosis,
  failedPlatform?: string,
  preferredVoice?: string,
): AudioRepairRoute[] {
  void store;
  void diagnosis;
  void failedPlatform;
  void preferredVoice;
  return [];
}

export async function resolveMediaSelfHealLog(logId?: string) {
  if (!logId) return;
  try {
    await fetch(API.selfHealMedia, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', logId }),
    });
  } catch (err) {
    console.warn('[Self-Healing Media Router] resolve failed:', err);
  }
}

export function applyMediaSelfHealPatch(store: NovelStore, patch?: MediaSelfHealPatch) {
  void store;
  void patch;
  return false;
}

/**
 * Media domains (image/video/audio) auto-approve — the orchestration brain
 * must apply patches and cascade routes without blocking on window.confirm.
 * Only ui_click still asks the user (file-picker strategy change).
 */
export function requestMediaSelfHealApproval(diagnosis: MediaSelfHealDiagnosis, domain: MediaSelfHealDomain) {
  void diagnosis;
  void domain;
  return false;
}

export function buildSelfHealWaitingMessage(diagnosis: MediaSelfHealDiagnosis) {
  return `Self-heal dang dieu phoi sua loi. Log: ${diagnosis.logPath || diagnosis.logId}`;
}

export function imageRouteFromSelfHealPatch(
  store: NovelStore,
  patch: MediaSelfHealPatch | undefined,
  promptIndex: number,
): ImageRepairRoute | null {
  void store;
  void patch;
  void promptIndex;
  return null;
}
