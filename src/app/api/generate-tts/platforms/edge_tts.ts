import type { TTSProvider } from '../ttsTypes';
import { generateEdgeTTS } from '../engines/edge';

/**
 * Owner: TTS platform `edge_tts`.
 * Prosody strategy: Edge generates at natural rate; FFmpeg applies speed + pitch
 * (Edge SSML rate is flaky under load; FFmpeg atempo/asetrate is reliable).
 */
export const provider_edge_tts: TTSProvider = {
  name: 'Edge TTS',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const voice = opts.voice || 'vi-VN-HoaiMyNeural';
    try {
      // Always natural rate — route applyAudioEffects handles speed/pitch
      const buffer = await generateEdgeTTS(text, voice, 1.0, 0);
      return {
        buffer,
        method: `Edge TTS (${voice})`,
        nativeSpeedApplied: false,
        nativePitchApplied: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[EdgeTTS] ${voice} fail (${msg}) → safe voice`);
      const female = /female|nu|nữ|my|aria|jenny|emma|ava|sara|nancy/i.test(voice);
      const isEn = /^en-/i.test(voice);
      const safe = isEn
        ? female
          ? 'en-US-JennyNeural'
          : 'en-US-GuyNeural'
        : female
          ? 'vi-VN-HoaiMyNeural'
          : 'vi-VN-NamMinhNeural';
      const buffer = await generateEdgeTTS(text, safe, 1.0, 0);
      return {
        buffer,
        method: `Edge TTS (${safe}) [was ${voice}]`,
        nativeSpeedApplied: false,
        nativePitchApplied: false,
      };
    }
  },
};
