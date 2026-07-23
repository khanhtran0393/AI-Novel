/**
 * Shared TTS preview defaults — client + server must stay in lockstep.
 * Drift (e.g. client nfe=16 / server nfe=20) causes cache replay of noisy audio
 * or permanent MISS thrash.
 */

/** Flow-matching NFE for isPreview (Vina Zero-Shot). Floor for quality. */
export const VINA_PREVIEW_NFE_DEFAULT = 20;

/** Minimum allowed when env VINA_NFE_PREVIEW overrides. */
export const VINA_PREVIEW_NFE_FLOOR = 16;

/** Canonical short sentence for modal «Nghe thử» (server cache key uses cleaned text). */
export const TTS_PREVIEW_SCENE_TEXT = 'Xin chào, đây là giọng đọc thử.';

/** Browser Cache API name — bump to invalidate sealed wrong-MIME / noisy blobs. */
export const TTS_PRELISTEN_CACHE_NAME = 'tts-prelisten-cache-v8';
