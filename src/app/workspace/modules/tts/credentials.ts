import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';

/**
 * Resolve API keys for a TTS platform from live store + caller overrides.
 * Active engines: gemini_tts needs Gemini keys; edge/piper/vina/omni/capcut often empty.
 * Removed platforms (openai/google/…) are rejected earlier by activePlatforms gate.
 */
export function getTTSCredentialsForConfig(
  activeConfig: TTSConfig | undefined,
  apiKey: string,
  apiKeys: string[],
) {
  const store = useNovelStore.getState();
  const platform = String(activeConfig?.platform || store.ttsConfig?.platform || '');

  if (platform === 'gemini_tts') {
    const keys = store.apiKeys?.length
      ? store.apiKeys
      : store.apiKey
        ? [store.apiKey]
        : apiKeys?.length
          ? apiKeys
          : apiKey
            ? [apiKey]
            : [];
    return { apiKey: keys[0] || '', apiKeys: keys };
  }

  // Prefer caller keys; fall back to master store keys
  if (apiKeys?.length) return { apiKey: apiKeys[0] || apiKey || '', apiKeys };
  if (apiKey) return { apiKey, apiKeys: [apiKey] };

  const master = store.apiKeys?.length
    ? store.apiKeys
    : store.apiKey
      ? [store.apiKey]
      : [];
  return { apiKey: master[0] || '', apiKeys: master };
}
