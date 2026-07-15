import type { TTSConfig } from '@/store/useNovelStore';

export function resolveTtsDrivePath(savePathTTS: string, googleDrivePath: string) {
  if (savePathTTS) return savePathTTS;
  const base = googleDrivePath.trim();
  if (!base) return '';
  return `${base}${base.includes('/') ? '/' : '\\'}Am Thanh TTS`;
}

export function resolveTtsApiKeys(activeApiKey: string, activeApiKeys: string[]) {
  return activeApiKeys && activeApiKeys.length > 0
    ? activeApiKeys
    : activeApiKey
      ? [activeApiKey]
      : [];
}

export function resolveTikTokSessionFromList({
  sessions,
  primary,
  rotateIndex = 0,
}: {
  sessions: string[];
  primary?: string;
  rotateIndex?: number;
}) {
  const list = sessions.map((s) => String(s || '').trim()).filter(Boolean);
  const fallback = (primary || '').trim();
  if (list.length === 0) return fallback;
  if (list.length === 1) return list[0];
  const picked = list[Math.abs(rotateIndex) % list.length];
  return picked || fallback || list[0];
}

export function withRotatedTikTokSession({
  config,
  fallbackPlatform,
  sessions,
  fallbackSession,
  rotateIndex = 0,
}: {
  config: TTSConfig | undefined;
  fallbackPlatform?: string;
  sessions: string[];
  fallbackSession?: string;
  rotateIndex?: number;
}): TTSConfig | undefined {
  if (!config) return config;
  const platform = config.platform || fallbackPlatform;
  if (platform !== 'tiktok_tts') return config;
  return {
    ...config,
    tiktokSessionId: resolveTikTokSessionFromList({
      sessions,
      primary: config.tiktokSessionId || fallbackSession,
      rotateIndex,
    }),
  };
}

export function getDominantPromptEmotion(prompts: Array<{ emotion?: string }>) {
  const emotionCounts: Record<string, number> = {};
  for (const prompt of prompts) {
    const emotion = prompt.emotion?.trim();
    if (emotion) emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
  }
  return Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
