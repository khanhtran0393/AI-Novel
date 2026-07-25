import type { TTSProvider } from '../ttsTypes';
import { generatePiperTTS } from '../engines/piper';
import {
  resolvePiperModelPath,
  assertPiperRuntime,
} from '@/lib/tts/piperPaths';

/** Owner: TTS platform `piper` — hard-fail if runtime/model missing (B10). */
export const provider_piper: TTSProvider = {
  name: 'Piper TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    assertPiperRuntime();
    const resolved = resolvePiperModelPath(opts.voice || '');
    const voiceTag =
      resolved.speakerId > 0
        ? `${resolved.modelName}#${resolved.speakerId}`
        : resolved.modelName;
    const buffer = await generatePiperTTS(
      text,
      voiceTag,
      opts.speed,
      resolved.speakerId,
    );
    return {
      buffer,
      method: `Piper TTS (${voiceTag})`,
      nativeSpeedApplied: true,
      nativePitchApplied: false,
    };
  },
};
