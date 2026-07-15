import type { TTSProvider } from '../ttsTypes';
import { generateTikTokTTS } from '../engines/tiktok';

/** Owner: TTS platform `tiktok_tts` — hard-fail khi thiếu session / API fail */
export const provider_tiktok_tts: TTSProvider = {
  name: 'TikTok TTS',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const session = String(opts.tiktokSessionId || '').trim();
    if (!session) {
      throw new Error(
        'TikTok TTS: chưa có Session ID — dán session trong Cấu hình giọng (không fallback Edge).',
      );
    }
    const buffer = await generateTikTokTTS(text, opts.voice, session);
    return {
      buffer,
      method: `TikTok TTS (${opts.voice})`,
      nativeSpeedApplied: false,
      nativePitchApplied: false,
    };
  },
};
