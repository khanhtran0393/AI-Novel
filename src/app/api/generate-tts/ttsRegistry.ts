/**
 * TTS provider registry — thin map only.
 * Active platforms: ./platforms/<id>.ts
 * Removed platforms: hard-fail stubs (no silent fallback).
 */
import type { TTSProvider } from './ttsTypes';
import { provider_piper } from './platforms/piper';
import { provider_edge_tts } from './platforms/edge_tts';
import { provider_capcut_tts } from './platforms/capcut_tts';
import { provider_tiktok_tts } from './platforms/tiktok_tts';
import { provider_omnivoice_local } from './platforms/omnivoice_local';
import { provider_vina_voice } from './platforms/vina_voice';
import { provider_gemini_tts } from './platforms/gemini_tts';
import { provider_la_studio } from './platforms/la_studio';
import {
  provider_vbee,
  provider_google,
  provider_elevenlabs,
  provider_vieneu_tts,
  provider_openai_tts,
  provider_hotai_tts,
} from './platforms/removed';

export const TTS_PROVIDERS: Record<string, TTSProvider> = {
  // ── Active (UI Engine dropdown) ──
  edge_tts: provider_edge_tts,
  piper: provider_piper,
  omnivoice_local: provider_omnivoice_local,
  la_studio: provider_la_studio,
  capcut_tts: provider_capcut_tts,
  tiktok_tts: provider_tiktok_tts,
  gemini_tts: provider_gemini_tts,
  // ── Removed — hard-fail + migrate message ──
  vina_voice: provider_vina_voice, // legacy hard-fail via removed path? keep stub behavior
  vbee: provider_vbee,
  google: provider_google,
  elevenlabs: provider_elevenlabs,
  vieneu_tts: provider_vieneu_tts,
  openai_tts: provider_openai_tts,
  hotai_tts: provider_hotai_tts,
};
