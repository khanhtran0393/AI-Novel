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
    const voice = String(opts.voice || '').trim();
    if (!voice) {
      throw new Error('Edge TTS: chưa chọn voice.');
    }
    // Always natural rate — route applyAudioEffects handles speed/pitch.
    // Do not substitute another Edge voice on failure; surface the selected voice error.
    const buffer = await generateEdgeTTS(text, voice, 1.0, 0);
    return {
      buffer,
      method: `Edge TTS (${voice})`,
      nativeSpeedApplied: false,
      nativePitchApplied: false,
    };
  },
};
