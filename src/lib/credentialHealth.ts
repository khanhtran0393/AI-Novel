/**
 * Credential / engine health snapshot for the workspace header panel.
 */

export type HealthLevel = 'ok' | 'warn' | 'fail' | 'idle';

export type HealthItem = {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
};

export type HealthInput = {
  apiKey?: string;
  apiKeys?: string[];
  openaiApiKey?: string;
  openaiApiKeys?: string[];
  grokApiKey?: string;
  grokApiKeys?: string[];
  googleStudioCookie?: string;
  googleStudioCookies?: string[];
  tiktokSessionIds?: string[];
  imageProvider?: string;
  videoProvider?: string;
  ttsConfig?: {
    platform?: string;
    voice?: string;
    tiktokSessionId?: string;
  } | null;
  lumaApiKey?: string;
  lumaApiKeys?: string[];
};

function hasAny(primary?: string, list?: string[]): boolean {
  if ((primary || '').trim()) return true;
  return Array.isArray(list) && list.some((x) => !!(x || '').trim());
}

export function evaluateCredentialHealth(input: HealthInput): {
  items: HealthItem[];
  ok: number;
  warn: number;
  fail: number;
  scoreLabel: string;
} {
  const items: HealthItem[] = [];

  // Master LLM keys
  if (hasAny(input.apiKey, input.apiKeys)) {
    items.push({
      id: 'gemini',
      label: 'Gemini / Studio keys',
      level: 'ok',
      detail: `${(input.apiKeys || []).filter(Boolean).length || (input.apiKey ? 1 : 0)} key(s)`,
    });
  } else {
    items.push({
      id: 'gemini',
      label: 'Gemini / Studio keys',
      level: 'warn',
      detail: 'Thiếu — viết script / Banana ảnh có thể fail',
    });
  }

  if (hasAny(input.openaiApiKey, input.openaiApiKeys)) {
    items.push({
      id: 'openai',
      label: 'OpenAI',
      level: 'ok',
      detail: 'Có key',
    });
  } else {
    items.push({
      id: 'openai',
      label: 'OpenAI',
      level: 'idle',
      detail: 'Tùy chọn (GPT / Sora / DALL·E)',
    });
  }

  if (hasAny(input.grokApiKey, input.grokApiKeys)) {
    items.push({
      id: 'grok',
      label: 'Grok / xAI',
      level: 'ok',
      detail: 'Có key',
    });
  } else {
    items.push({
      id: 'grok',
      label: 'Grok / xAI',
      level: 'idle',
      detail: 'Tùy chọn Imagine',
    });
  }

  // Image engine
  const img = (input.imageProvider || 'gemini').toLowerCase();
  if (img === 'openai' && !hasAny(input.openaiApiKey, input.openaiApiKeys)) {
    items.push({
      id: 'image',
      label: `Ảnh: ${img}`,
      level: 'fail',
      detail: 'Provider OpenAI nhưng thiếu key',
    });
  } else if (
    img === 'grok' &&
    !hasAny(input.grokApiKey, input.grokApiKeys)
  ) {
    items.push({
      id: 'image',
      label: `Ảnh: ${img}`,
      level: 'fail',
      detail: 'Provider Grok nhưng thiếu key',
    });
  } else if (
    img === 'gemini' &&
    !hasAny(input.apiKey, input.apiKeys) &&
    !hasAny(input.googleStudioCookie, input.googleStudioCookies)
  ) {
    items.push({
      id: 'image',
      label: `Ảnh: ${img}`,
      level: 'fail',
      detail: 'Cần API key hoặc Cookie Studio',
    });
  } else {
    items.push({
      id: 'image',
      label: `Ảnh: ${img}`,
      level: 'ok',
      detail: 'Credential đủ cho provider hiện tại',
    });
  }

  // Cookie
  if (hasAny(input.googleStudioCookie, input.googleStudioCookies)) {
    items.push({
      id: 'cookie',
      label: 'Google Studio Cookie',
      level: 'ok',
      detail: `${(input.googleStudioCookies || []).filter(Boolean).length || 1} cookie`,
    });
  } else {
    items.push({
      id: 'cookie',
      label: 'Google Studio Cookie',
      level: 'warn',
      detail: 'Thiếu — Whisk / Flow có thể fail',
    });
  }

  // TTS
  const plat = (input.ttsConfig?.platform || '').toLowerCase();
  if (!plat) {
    items.push({
      id: 'tts',
      label: 'TTS',
      level: 'warn',
      detail: 'Chưa chọn platform',
    });
  } else if (plat === 'tiktok_tts') {
    const sessions = (input.tiktokSessionIds || []).filter(Boolean);
    const sid = input.ttsConfig?.tiktokSessionId;
    if (sessions.length || (sid || '').trim()) {
      items.push({
        id: 'tts',
        label: `TTS: ${plat}`,
        level: 'ok',
        detail: `${sessions.length || 1} session`,
      });
    } else {
      items.push({
        id: 'tts',
        label: `TTS: ${plat}`,
        level: 'fail',
        detail: 'Thiếu TikTok session id',
      });
    }
  } else if (
    (plat === 'openai_tts' && !hasAny(input.openaiApiKey, input.openaiApiKeys)) ||
    (plat === 'gemini_tts' && !hasAny(input.apiKey, input.apiKeys))
  ) {
    items.push({
      id: 'tts',
      label: `TTS: ${plat}`,
      level: 'fail',
      detail: 'Thiếu API key cho platform TTS',
    });
  } else {
    items.push({
      id: 'tts',
      label: `TTS: ${plat}`,
      level: 'ok',
      detail: input.ttsConfig?.voice
        ? `voice ${String(input.ttsConfig.voice).slice(0, 28)}`
        : 'Đã cấu hình',
    });
  }

  // Video
  const vid = (input.videoProvider || 'veo').toLowerCase();
  items.push({
    id: 'video',
    label: `Video: ${vid}`,
    level:
      vid === 'sora' && !hasAny(input.openaiApiKey, input.openaiApiKeys)
        ? 'warn'
        : 'ok',
    detail:
      vid === 'sora' && !hasAny(input.openaiApiKey, input.openaiApiKeys)
        ? 'Sora cần OpenAI key'
        : 'Provider đã chọn',
  });

  const ok = items.filter((i) => i.level === 'ok').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  const fail = items.filter((i) => i.level === 'fail').length;
  const scoreLabel =
    fail > 0 ? `${fail} lỗi` : warn > 0 ? `${warn} cảnh báo` : 'OK';

  return { items, ok, warn, fail, scoreLabel };
}
