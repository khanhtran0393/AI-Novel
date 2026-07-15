import type { TTSProvider } from '../ttsTypes';
import { generateGoogleCloudTts } from '../engines/google';

/** Owner: TTS platform `google` — hard-fail khi thiếu key / API fail (không mẫu Edge ngầm) */
export const provider_google: TTSProvider = {
  name: 'Google Cloud TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: true,
  generate: async (text, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = opts as any;
    const apiKey =
      (typeof extra.googleCloudApiKey === 'string' && extra.googleCloudApiKey.trim()) ||
      process.env.GOOGLE_TTS_API_KEY ||
      process.env.GOOGLE_CLOUD_TTS_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      '';
    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) ? opts.speed : 1;
    const pitch =
      typeof opts.pitch === 'number' && Number.isFinite(opts.pitch) ? opts.pitch : 0;

    if (!apiKey) {
      throw new Error(
        'Google Cloud TTS: chưa có API key (GOOGLE_TTS_API_KEY) — không fallback Edge mẫu.',
      );
    }
    if (!/^(vi-VN|en-US|fr-FR|ja-JP|ko-KR|zh-)/i.test(opts.voice || '')) {
      throw new Error(
        `Google Cloud TTS: voice "${opts.voice || ''}" không hợp lệ (cần dạng vi-VN-… / en-US-…).`,
      );
    }

    const buffer = await generateGoogleCloudTts(text, opts.voice, apiKey, speed, pitch);
    return {
      buffer,
      method: `Google Cloud TTS (${opts.voice})`,
      nativeSpeedApplied: true,
      nativePitchApplied: true,
    };
  },
};
