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
    // Fail-fast: sai catalog (Vina/Piper/Omni id) → không treo WS 55–90s rồi timeout UI.
    // Edge voice chuẩn: vi-VN-HoaiMyNeural / en-US-JennyNeural…
    const looksLikeEdge =
      /Neural$/i.test(voice) ||
      /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+$/i.test(voice);
    const looksForeign =
      /\.onnx$/i.test(voice) ||
      /^omnivoice_/i.test(voice) ||
      /lồng tiếng|kể chuyện|tin tức|user\s*·/i.test(voice) ||
      /\s/.test(voice);
    if (!looksLikeEdge || looksForeign) {
      throw new Error(
        `Edge TTS: voice «${voice}» không phải giọng Microsoft Edge. ` +
          `Chọn lại trong dropdown Engine (vd. vi-VN-HoaiMyNeural / vi-VN-NamMinhNeural). ` +
          `Không đổi sang giọng khác ngầm.`,
      );
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
