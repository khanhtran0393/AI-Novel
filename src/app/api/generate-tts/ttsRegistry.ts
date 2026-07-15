/**
 * TTS provider registry — thin map only.
 * Each platform lives in ./platforms/<id>.ts
 */
import type { TTSProvider } from './ttsTypes';
import { provider_piper } from './platforms/piper';
import { provider_edge_tts } from './platforms/edge_tts';
import { provider_vbee } from './platforms/vbee';
import { provider_google } from './platforms/google';
import { provider_elevenlabs } from './platforms/elevenlabs';
import { provider_vieneu_tts } from './platforms/vieneu_tts';
import { provider_capcut_tts } from './platforms/capcut_tts';
import { provider_tiktok_tts } from './platforms/tiktok_tts';
import { provider_openai_tts } from './platforms/openai_tts';
import { provider_hotai_tts } from './platforms/hotai_tts';
import { provider_omnivoice_local } from './platforms/omnivoice_local';
import { provider_vina_voice } from './platforms/vina_voice';
import { provider_gemini_tts } from './platforms/gemini_tts';

export const TTS_PROVIDERS: Record<string, TTSProvider> = {
  piper: provider_piper,
  edge_tts: provider_edge_tts,
  vbee: provider_vbee,
  google: provider_google,
  elevenlabs: provider_elevenlabs,
  vieneu_tts: provider_vieneu_tts,
  capcut_tts: provider_capcut_tts,
  tiktok_tts: provider_tiktok_tts,
  openai_tts: provider_openai_tts,
  hotai_tts: provider_hotai_tts,
  omnivoice_local: provider_omnivoice_local,
  vina_voice: provider_vina_voice,
  gemini_tts: provider_gemini_tts,
};
