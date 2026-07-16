import type { TTSProvider } from '../ttsTypes';
import { generateCapCutTTS, diagnoseCapCutInstall } from '../engines/capcut';
import { findCapCutSscronet, capCutDllMissingMessage } from '../engines/capcutDll';
import { resolveCapCutVoice } from '@/lib/capcutVoices';

/** Owner: TTS platform `capcut_tts` — hard-fail khi thiếu CapCut/sscronet */
export const provider_capcut_tts: TTSProvider = {
  name: 'CapCut TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const hit = findCapCutSscronet();
    if (!hit) {
      throw new Error(capCutDllMissingMessage());
    }

    const resolved = resolveCapCutVoice(opts.voice);
    // Map app speed (0.5–2) → CapCut prosody rate string
    const speed =
      typeof opts.speed === 'number' && Number.isFinite(opts.speed) && opts.speed > 0
        ? String(Math.min(2, Math.max(0.5, opts.speed)))
        : '1.0';

    const buffer = await generateCapCutTTS(text, opts.voice, speed);
    return {
      buffer,
      method: `CapCut TTS (${resolved.displayName} · ${resolved.resourceId})`,
      nativeSpeedApplied: speed !== '1.0',
      nativePitchApplied: false,
    };
  },
};

export { diagnoseCapCutInstall };
