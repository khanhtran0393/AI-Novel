import type { TTSProvider } from '../ttsTypes';
import { removedTtsPlatformMessage } from '@/lib/tts/activePlatforms';

/** Hard-fail provider for platforms đã gỡ khỏi UI (B10: no silent fallback). */
export function makeRemovedProvider(
  platformId: string,
  displayName: string,
): TTSProvider {
  return {
    name: `${displayName} (removed)`,
    supportsNativeSpeed: false,
    supportsNativePitch: false,
    generate: async () => {
      throw new Error(removedTtsPlatformMessage(platformId));
    },
  };
}

export const provider_vieneu_tts = makeRemovedProvider('vieneu_tts', 'VieNeu TTS');
export const provider_openai_tts = makeRemovedProvider('openai_tts', 'OpenAI TTS');
export const provider_google = makeRemovedProvider('google', 'Google Cloud TTS');
export const provider_elevenlabs = makeRemovedProvider('elevenlabs', 'ElevenLabs');
export const provider_hotai_tts = makeRemovedProvider('hotai_tts', 'Hotai TTS');
export const provider_vbee = makeRemovedProvider('vbee', 'VBee');
