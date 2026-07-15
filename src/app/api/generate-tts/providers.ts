/**
 * TTS provider registry barrel.
 * Engines live in ./engines/* — one engine = one synthesis path.
 * Route imports TTS_PROVIDERS from here only.
 */
export type { TTSOptions, TTSProvider } from './ttsTypes';
export { TTS_PROVIDERS } from './ttsRegistry';
