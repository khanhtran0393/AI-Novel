import type { TTSProvider } from '../ttsTypes';
import { generateGeminiTTS } from '../engines/gemini';

/** Owner: TTS platform `gemini_tts` — hard-fail khi hết key / fail */
export const provider_gemini_tts: TTSProvider = {
  name: 'Gemini TTS',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    let keys = Array.isArray(opts.apiKeys) ? opts.apiKeys.map(String) : [];
    if (keys.length === 0) {
      keys = [
        process.env.GEMINI_KEY_1,
        process.env.GEMINI_KEY_2,
        process.env.GEMINI_KEY_3,
        process.env.GEMINI_KEY_4,
        process.env.GEMINI_KEY_5,
        process.env.GEMINI_KEY_6,
        process.env.GEMINI_KEY_7,
        process.env.GEMINI_KEY_8,
        process.env.GEMINI_API_KEY,
      ].filter((k): k is string => !!k && k.trim().length > 0);
    }

    if (keys.length === 0) {
      throw new Error(
        'Gemini TTS: chưa có API Key — thêm key hoặc chọn platform khác (không fallback Edge).',
      );
    }

    let lastErr = '';
    for (const key of keys) {
      if (!key?.trim()) continue;
      try {
        const buffer = await generateGeminiTTS(text, key.trim(), opts.voice);
        return {
          buffer,
          method: `Gemini TTS (${opts.voice})`,
          nativeSpeedApplied: false,
          nativePitchApplied: false,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        console.warn(`[TTS Gemini] key fail: ${lastErr}`);
      }
    }

    throw new Error(
      `Gemini TTS: tất cả API key đều fail — ${lastErr.slice(0, 160) || 'unknown'} (không fallback Edge).`,
    );
  },
};
