import type { TTSProvider } from '../ttsTypes';
import { generateOpenAICompatibleTTS } from '../engines/openaiCompat';

/** Owner: TTS platform `openai_tts` — hard-fail khi thiếu key / 401 */
export const provider_openai_tts: TTSProvider = {
  name: 'OpenAI TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const apiKey =
      Array.isArray(opts.apiKeys) && opts.apiKeys.length > 0
        ? String(opts.apiKeys[0] || '').trim()
        : String(process.env.OPENAI_API_KEY || '').trim();
    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const voice = opts.voice || 'alloy';

    if (!apiKey) {
      throw new Error(
        'OpenAI TTS: chưa có API Key — thêm key hoặc chọn platform khác (không fallback Edge).',
      );
    }

    const buffer = await generateOpenAICompatibleTTS(
      text,
      voice,
      speed,
      0,
      'https://api.openai.com',
      apiKey,
      'tts-1',
    );
    return {
      buffer,
      method: `OpenAI TTS (${voice})`,
      nativeSpeedApplied: true,
      nativePitchApplied: false,
    };
  },
};
