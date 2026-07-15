import type { TTSProvider } from '../ttsTypes';
import { generateOpenAICompatibleTTS } from '../engines/openaiCompat';

/** Owner: TTS platform `hotai_tts` — hard-fail khi API down */
export const provider_hotai_tts: TTSProvider = {
  name: 'Hotai TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const apiKey =
      (Array.isArray(opts.apiKeys) && opts.apiKeys.length > 0
        ? opts.apiKeys[0]
        : process.env.HOTAI_API_KEY) || '';
    const apiUrl = process.env.HOTAI_API_URL || 'https://api.hotai.vn';
    const buffer = await generateOpenAICompatibleTTS(
      text,
      opts.voice,
      speed,
      0,
      apiUrl,
      apiKey,
      'hotai-tts-1',
    );
    return {
      buffer,
      method: `Hotai TTS (${opts.voice})`,
      nativeSpeedApplied: true,
      nativePitchApplied: false,
    };
  },
};
