import { API } from '@/contracts';
import type { NovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
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
  const selectedCookie = getGoogleCookieForPrompt(store, promptIndex);
  const candidates: ImageRepairRoute[] = [
    {
      provider: store.imageProvider || 'flow',
      model: store.imageModel || 'GEM_PIX_2',
      imageApiKey: getImageProviderApiKey(store, store.imageProvider),
      selectedCookie,
      reason: 'Tuyen dang chon trong cau hinh media.',
    },
    {
      provider: 'flow',
      model: 'GEM_PIX_2',
      imageApiKey: '',
      selectedCookie: '',
      reason: 'Tu sua: doi sang Google Flow (extension bridge).',
    },
    {
      provider: 'gemini',
      model: 'banana',
      imageApiKey: getImageProviderApiKey(store, 'gemini'),
      selectedCookie,
      reason: 'Tu sua: doi sang Google Studio Banana (legacy).',
    },
    {
      provider: 'gemini',
      model: 'whisk',
      imageApiKey: '',
      selectedCookie,
      reason: 'Tu sua: doi sang Google Studio Whisk Cookie (legacy).',
    },
    {
      provider: 'openai',
      model: 'gpt-image-1',
      imageApiKey: getImageProviderApiKey(store, 'openai'),
      selectedCookie: '',
      reason: 'Tu sua: doi sang OpenAI Images khi Google/Grok khong kha dung.',
    },
    {
      provider: 'grok',
      model: 'grok-imagine-image-quality',
      imageApiKey: getImageProviderApiKey(store, 'grok'),
      selectedCookie: '',
      reason: 'Tu sua: doi sang Grok Imagine neu co xAI key hop le.',
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((route) => {
    const hasCredential =
      route.provider === 'flow'
        ? true // session checked server-side via bridge
        : route.provider === 'openai'
          ? !!route.imageApiKey
          : route.provider === 'grok'
            ? !!route.imageApiKey
            : route.model === 'whisk'
              ? !!route.selectedCookie
              : !!route.imageApiKey || !!route.selectedCookie;

    if (!hasCredential) return false;
    const id = `${route.provider}:${route.model}:${route.imageApiKey ? 'key' : 'cookie'}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

function hasUsablePatch(patch?: MediaSelfHealPatch) {
  return !!(
    patch?.imageProvider ||
    patch?.imageModel ||
    patch?.videoProvider ||
    patch?.videoModel ||
    patch?.pickerStrategy ||
    patch?.ttsConfig?.platform ||
    patch?.ttsConfig?.voice ||
    patch?.ttsConfig?.api_url_vieneu
  );
}

/** Offline brain: build a real repair patch from store credentials + error kind. */
export function buildLocalMediaPatch(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  error: unknown,
  config: Record<string, unknown> = {},
): MediaSelfHealPatch {
  const issue = classifyMediaError(error);
  const promptIndex = typeof config.promptIndex === 'number' ? config.promptIndex : 0;

  if (domain === 'image') {
    const failedProvider = String(config.routeProvider || store.imageProvider || '');
    const failedModel = String(config.routeModel || store.imageModel || '');
    const plan = buildImageRepairPlan(store, promptIndex);
    const next =
      plan.find((route) => route.provider !== failedProvider || route.model !== failedModel) ||
      plan.find((route) => !(route.provider === failedProvider && route.model === failedModel)) ||
      plan[0];
    if (next) {
      return { imageProvider: next.provider, imageModel: next.model };
    }
    // Hard fallbacks when plan empty but credentials exist later
    if (failedProvider !== 'flow') return { imageProvider: 'flow', imageModel: 'GEM_PIX_2' };
    if (getImageProviderApiKey(store, 'gemini')) return { imageProvider: 'gemini', imageModel: 'banana' };
    if (getGoogleCookieForPrompt(store, promptIndex)) return { imageProvider: 'gemini', imageModel: 'whisk' };
    if (getImageProviderApiKey(store, 'openai')) return { imageProvider: 'openai', imageModel: 'gpt-image-1' };
    if (getImageProviderApiKey(store, 'grok') && issue.kind !== 'quota') {
      return { imageProvider: 'grok', imageModel: 'grok-imagine-image-quality' };
    }
    return {};
  }

  if (domain === 'video') {
    const failedProvider = String(config.routeProvider || store.videoProvider || '');
    const candidates = buildVideoRepairPlan(store).filter((r) => r.provider !== failedProvider);
    const next = candidates[0];
    if (next) return { videoProvider: next.provider, videoModel: next.model };
    return { videoProvider: 'ffmpeg', videoModel: 'ffmpeg-basic' };
  }

  if (domain === 'audio') {
    // No silent platform hop (Edge/Gemini/…). Fail loudly so user fixes the chosen engine.
    void config.ttsPlatform;
    void store.ttsConfig;
    return {};
  }

  return { pickerStrategy: 'compat_dialog' };
}

export function buildVideoRepairPlan(store: NovelStore): VideoRepairRoute[] {
  const geminiKey = firstKey(store.apiKey, store.apiKeys);
  const openaiKey = firstKey(store.openaiApiKey, store.openaiApiKeys);
  const grokKey = firstKey(store.grokApiKey, store.grokApiKeys);

  const candidates: VideoRepairRoute[] = [
    {
      provider: store.videoProvider || 'flow',
      model: store.videoModel || 'veo_3_1_t2v_fast_ultra',
      videoApiKey:
        store.videoProvider === 'sora'
          ? openaiKey
          : store.videoProvider === 'grok'
            ? grokKey
            : store.videoProvider === 'flow' || store.videoProvider === 'ffmpeg'
              ? ''
              : geminiKey,
      reason: 'Tuyen dang chon trong cau hinh media.',
    },
    {
      provider: 'flow',
      model: 'veo_3_1_t2v_fast_ultra',
      videoApiKey: '',
      reason: 'Tu sua: doi sang Google Flow (extension bridge).',
    },
    {
      provider: 'veo',
      model: 'veo',
      videoApiKey: geminiKey,
      reason: 'Tu sua: doi sang Veo (Gemini key).',
    },
    {
      provider: 'sora',
      model: 'sora',
      videoApiKey: openaiKey,
      reason: 'Tu sua: doi sang Sora (OpenAI key).',
    },
    {
      provider: 'grok',
      model: 'grok-imagine-video-1.5',
      videoApiKey: grokKey,
      reason: 'Tu sua: doi sang Grok Imagine Video.',
    },
    {
      provider: 'ffmpeg',
      model: 'ffmpeg-basic',
      videoApiKey: '',
      reason: 'Tu sua: fallback FFmpeg offline khi cloud video that bai.',
    },
  ];

  const seen = new Set<string>();
  return candidates.filter((route) => {
    const needsKey =
      route.provider !== 'ffmpeg' && route.provider !== 'flow';
    if (needsKey && !route.videoApiKey) return false;
    const id = `${route.provider}:${route.model}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function buildAudioRepairPlan(store: NovelStore, preferredVoice?: string): AudioRepairRoute[] {
  // Only retry the platform the user configured — never hop Edge/Gemini as silent backup.
  const current = store.ttsConfig?.platform || 'vina_voice';
  const voice = preferredVoice || store.ttsConfig?.voice || '';
  return [
    {
      platform: current,
      voice,
      reason: 'Retry đúng platform TTS đã cấu hình (không fallback Edge ngầm).',
    },
  ];
}

function enrichDiagnosis(
  store: NovelStore,
  domain: MediaSelfHealDomain,
  diagnosis: MediaSelfHealDiagnosis,
  config: Record<string, unknown> = {},
): MediaSelfHealDiagnosis {
  if (hasUsablePatch(diagnosis.patch) && diagnosis.shouldRetry) {
    return diagnosis;
  }

  const localPatch = buildLocalMediaPatch(store, domain, diagnosis.issue?.message || 'unknown', config);
  if (!hasUsablePatch(localPatch)) {
    // Image/video/audio may still cascade via repair plans even without a single patch
    const canCascade =
      (domain === 'image' && buildImageRepairPlan(store, Number(config.promptIndex) || 0).length > 1) ||
      (domain === 'video' && buildVideoRepairPlan(store).length > 1) ||
      (domain === 'audio' && buildAudioRepairPlan(store).length > 1);

    if (!canCascade) return diagnosis;

    return {
      ...diagnosis,
      patch: localPatch,
      shouldRetry: true,
      summary: `${diagnosis.summary} | Local brain enabled multi-route cascade.`,
    };
  }

  return {
    ...diagnosis,
    patch: { ...diagnosis.patch, ...localPatch },
    shouldRetry: true,
    summary: hasUsablePatch(diagnosis.patch)
      ? diagnosis.summary
      : `Local self-heal brain injected repair patch for ${domain}: ${JSON.stringify(localPatch)}`,
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
  const routes: ImageRepairRoute[] = [];
  const seen = new Set<string>();

  const push = (route: ImageRepairRoute | null | undefined) => {
    if (!route) return;
    if (failedProvider && failedModel && route.provider === failedProvider && route.model === failedModel) {
      return;
    }
    const id = `${route.provider}:${route.model}`;
    if (seen.has(id)) return;
    seen.add(id);
    routes.push(route);
  };

  push(imageRouteFromSelfHealPatch(store, diagnosis.patch, promptIndex));
  for (const route of buildImageRepairPlan(store, promptIndex)) {
    push(route);
  }

  return routes;
}

/** Ordered unique video routes: cloud candidates first, FFmpeg always last. */
export function collectVideoRepairRoutes(
  store: NovelStore,
  diagnosis: MediaSelfHealDiagnosis,
  failedProvider?: string,
): VideoRepairRoute[] {
  const cloud: VideoRepairRoute[] = [];
  const offline: VideoRepairRoute[] = [];
  const seen = new Set<string>();

  const push = (route: VideoRepairRoute | null | undefined) => {
    if (!route) return;
    if (failedProvider && route.provider === failedProvider && route.provider !== 'ffmpeg') return;
    const id = `${route.provider}:${route.model}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (route.provider === 'ffmpeg') offline.push(route);
    else cloud.push(route);
  };

  if (diagnosis.patch?.videoProvider) {
    const provider = diagnosis.patch.videoProvider;
    const model = diagnosis.patch.videoModel || provider;
    const planMatch = buildVideoRepairPlan(store).find((r) => r.provider === provider);
    const videoApiKey = planMatch?.videoApiKey || '';
    // Skip cloud patch without credentials; ffmpeg is always allowed.
    if (provider === 'ffmpeg' || videoApiKey || planMatch) {
      push({
        provider,
        model,
        videoApiKey,
        reason: 'Tuyen tu patch cua Self-Healing Media Router.',
      });
    }
  }

  for (const route of buildVideoRepairPlan(store)) {
    push(route);
  }

  // Always allow ffmpeg as last resort even if plan filtered it
  if (!seen.has('ffmpeg:ffmpeg-basic')) {
    push({
      provider: 'ffmpeg',
      model: 'ffmpeg-basic',
      videoApiKey: '',
      reason: 'Last-resort FFmpeg offline fallback.',
    });
  }

  return [...cloud, ...offline];
}

/** Ordered unique audio routes. */
export function collectAudioRepairRoutes(
  store: NovelStore,
  diagnosis: MediaSelfHealDiagnosis,
  failedPlatform?: string,
  preferredVoice?: string,
): AudioRepairRoute[] {
  const routes: AudioRepairRoute[] = [];
  const seen = new Set<string>();

  const push = (route: AudioRepairRoute | null | undefined) => {
    if (!route) return;
    // Skip failed platform unless it is last-resort edge (still allow after vina retry)
    if (
      failedPlatform &&
      route.platform === failedPlatform &&
      route.platform !== 'edge_tts' &&
      route.platform !== 'vina_voice'
    ) {
      return;
    }
    if (failedPlatform && route.platform === failedPlatform) return;
    if (seen.has(route.platform)) return;
    seen.add(route.platform);
    routes.push(route);
  };

  if (diagnosis.patch?.ttsConfig?.platform) {
    push({
      platform: diagnosis.patch.ttsConfig.platform,
      voice:
        diagnosis.patch.ttsConfig.voice ||
        preferredVoice ||
        store.ttsConfig?.voice ||
        '',
      reason: 'Tuyen tu patch cua Self-Healing Media Router.',
    });
  }

  for (const route of buildAudioRepairPlan(store, preferredVoice)) {
    push(route);
  }

  // No auto-push of vina_voice / edge_tts — only diagnosis patch + explicit plan (same platform).

  return routes;
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
  if (!patch) return false;
  let changed = false;
  // Ephemeral runtime repair only — do NOT mirror onto channel DNA
  // (Cấu hình đầu ra / Giọng đọc toàn cục per-channel stay intact)
  const noMirror = { mirrorChannel: false as const };
  const notes: string[] = [];

  if (patch.imageProvider && patch.imageProvider !== store.imageProvider) {
    notes.push(`Ảnh: ${store.imageProvider} → ${patch.imageProvider} (tạm)`);
    store.setImageProvider(patch.imageProvider, noMirror);
    changed = true;
  }
  if (patch.imageModel && patch.imageModel !== store.imageModel) {
    notes.push(`Model ảnh: ${store.imageModel} → ${patch.imageModel} (tạm)`);
    store.setImageModel(patch.imageModel, noMirror);
    changed = true;
  }
  if (patch.videoProvider && patch.videoProvider !== store.videoProvider) {
    notes.push(`Video: ${store.videoProvider} → ${patch.videoProvider} (tạm)`);
    store.setVideoProvider(patch.videoProvider, noMirror);
    changed = true;
  }
  if (patch.videoModel && patch.videoModel !== store.videoModel) {
    notes.push(`Model video: ${store.videoModel} → ${patch.videoModel} (tạm)`);
    store.setVideoModel(patch.videoModel, noMirror);
    changed = true;
  }
  if (patch.ttsConfig) {
    const from = store.ttsConfig?.platform || '?';
    const to = patch.ttsConfig.platform || from;
    notes.push(`TTS: ${from} → ${to} (tạm · DNA kênh giữ nguyên)`);
    store.updateTTSConfig(patch.ttsConfig, noMirror);
    changed = true;
  }

  if (changed && notes.length) {
    toast.warn('Self-heal (tạm thời)', notes.join('\n'));
  }

  return changed;
}

function describeSelfHealPatch(patch?: MediaSelfHealPatch) {
  if (!patch) return 'Khong co patch cau hinh.';
  const parts: string[] = [];
  if (patch.imageProvider) parts.push(`Image provider -> ${patch.imageProvider}`);
  if (patch.imageModel) parts.push(`Image model -> ${patch.imageModel}`);
  if (patch.videoProvider) parts.push(`Video provider -> ${patch.videoProvider}`);
  if (patch.videoModel) parts.push(`Video model -> ${patch.videoModel}`);
  if (patch.pickerStrategy) parts.push(`Picker strategy -> ${patch.pickerStrategy}`);
  if (patch.ttsConfig?.platform) parts.push(`TTS platform -> ${patch.ttsConfig.platform}`);
  if (patch.ttsConfig?.voice) parts.push(`TTS voice -> ${patch.ttsConfig.voice}`);
  if (patch.ttsConfig?.api_url_vieneu) parts.push(`TTS API URL -> ${patch.ttsConfig.api_url_vieneu}`);
  return parts.length > 0 ? parts.join('\n') : 'Khong co patch cau hinh.';
}

/**
 * Media domains (image/video/audio) auto-approve — the orchestration brain
 * must apply patches and cascade routes without blocking on window.confirm.
 * Only ui_click still asks the user (file-picker strategy change).
 */
export function requestMediaSelfHealApproval(diagnosis: MediaSelfHealDiagnosis, domain: MediaSelfHealDomain) {
  if (!diagnosis.shouldRetry && !hasUsablePatch(diagnosis.patch)) return false;

  if (domain === 'ui_click') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
    return window.confirm([
      'AI da ghi log loi click khong phan hoi.',
      `Nguyen nhan: ${diagnosis.issue.kind}`,
      `Log: ${diagnosis.logPath || diagnosis.logId}`,
      '',
      'De xuat tu sua:',
      describeSelfHealPatch(diagnosis.patch),
      '',
      'Dong y ap dung patch va thu lai?'
    ].join('\n'));
  }

  console.info(
    `[Self-Heal Brain] Auto-approving ${domain} repair (${diagnosis.issue.kind}): ${describeSelfHealPatch(diagnosis.patch)}`,
  );
  return true;
}

export function buildSelfHealWaitingMessage(diagnosis: MediaSelfHealDiagnosis) {
  return `Self-heal dang dieu phoi sua loi. Log: ${diagnosis.logPath || diagnosis.logId}`;
}

export function imageRouteFromSelfHealPatch(
  store: NovelStore,
  patch: MediaSelfHealPatch | undefined,
  promptIndex: number,
): ImageRepairRoute | null {
  if (!patch?.imageProvider && !patch?.imageModel) return null;

  const provider = patch.imageProvider || store.imageProvider || 'flow';
  const model = patch.imageModel || store.imageModel || 'GEM_PIX_2';
  const selectedCookie = provider === 'gemini' ? getGoogleCookieForPrompt(store, promptIndex) : '';
  const imageApiKey = model === 'whisk' || provider === 'flow' ? '' : getImageProviderApiKey(store, provider);

  if (provider === 'flow') {
    return {
      provider,
      model,
      imageApiKey: '',
      selectedCookie: '',
      reason: 'Tuyen tu patch cua Self-Healing Media Router.',
    };
  }
  if (provider === 'gemini' && model === 'whisk' && !selectedCookie) return null;
  if (provider !== 'gemini' && !imageApiKey) return null;
  if (provider === 'gemini' && model !== 'whisk' && !imageApiKey && !selectedCookie) return null;

  return {
    provider,
    model,
    imageApiKey,
    selectedCookie,
    reason: 'Tuyen tu patch cua Self-Healing Media Router.',
  };
}
