import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';

/**
 * Resolve API keys for a TTS platform from live store + caller overrides.
 * openai_tts → OpenAI keys; gemini_tts / default → master Gemini keys.
 * edge / piper / vina often need no key — empty keys are allowed.
 */
export function getTTSCredentialsForConfig(
  activeConfig: TTSConfig | undefined,
  apiKey: string,
  apiKeys: string[],
) {
  const store = useNovelStore.getState();
  const platform = String(activeConfig?.platform || store.ttsConfig?.platform || '');

  if (platform === 'openai_tts') {
    const keys = store.openaiApiKeys?.length
      ? store.openaiApiKeys
      : store.openaiApiKey
        ? [store.openaiApiKey]
        : apiKeys?.length
          ? apiKeys
          : apiKey
            ? [apiKey]
            : [];
    return { apiKey: keys[0] || '', apiKeys: keys };
  }

  if (platform === 'gemini_tts' || platform === 'google_tts') {
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
