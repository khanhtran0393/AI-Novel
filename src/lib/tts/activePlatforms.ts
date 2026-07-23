/**
 * Active TTS platforms (server registry + UI tabs).
 *
 * Environment split (UI):
 * - Tab **LA Studio**: `la_studio` + `omnivoice_local` (Omni is a LA family, not Engine)
 * - Tab **Engine chọn tay**: only `ENGINE_MANUAL_TTS_PLATFORMS`
 *
 * Removed platforms stay as hard-fail / auto-migrate only — no silent swap.
 */

export const ACTIVE_TTS_PLATFORMS = [
  'edge_tts',
  'piper',
  'omnivoice_local',
  'la_studio',
  'capcut_tts',
  'tiktok_tts',
  'gemini_tts',
] as const;

export type ActiveTtsPlatform = (typeof ACTIVE_TTS_PLATFORMS)[number];

/**
 * Platforms listed in tab «Engine chọn tay» only.
 * LA Studio + OmniVoice live exclusively on the LA Studio tab.
 */
export const ENGINE_MANUAL_TTS_PLATFORMS = [
  'edge_tts',
  'piper',
  'capcut_tts',
  'tiktok_tts',
  'gemini_tts',
] as const;

export type EngineManualTtsPlatform = (typeof ENGINE_MANUAL_TTS_PLATFORMS)[number];

/** Platforms owned by tab LA Studio (not selectable in Engine dropdown). */
export const LA_STUDIO_ENV_PLATFORMS = ['la_studio', 'omnivoice_local'] as const;

export type LaStudioEnvPlatform = (typeof LA_STUDIO_ENV_PLATFORMS)[number];

/** Platforms gỡ khỏi UI — persist cũ auto-migrate, API hard-fail. */
export const REMOVED_TTS_PLATFORMS = [
  'vieneu_tts',
  'vina_voice',
  'openai_tts',
  'google',
  'google_tts',
  'elevenlabs',
  'hotai_tts',
  'vbee',
] as const;

export type RemovedTtsPlatform = (typeof REMOVED_TTS_PLATFORMS)[number];

export const TTS_PLATFORM_LABELS: Record<string, string> = {
  edge_tts: 'Microsoft Edge TTS',
  piper: 'Piper VN (.onnx local)',
  omnivoice_local: 'OmniVoice Local (tab LA Studio)',
  la_studio: 'LA Studio (multi-family local)',
  capcut_tts: 'CapCut TTS',
  tiktok_tts: 'TikTok TTS',
  gemini_tts: 'Gemini TTS',
  // Legacy labels (stale persist / migrate toast)
  vina_voice: 'VinaVoice / Zero-Shot (đã gỡ → LA Studio)',
  vieneu_tts: 'VieNeu (đã gỡ)',
  openai_tts: 'OpenAI TTS (đã gỡ)',
  google: 'Google Cloud TTS (đã gỡ)',
  google_tts: 'Google Cloud TTS (đã gỡ)',
  elevenlabs: 'ElevenLabs (đã gỡ)',
  hotai_tts: 'Hotai TTS (đã gỡ)',
  vbee: 'VBee (đã gỡ)',
};

/** Default migrate target when user still has a removed platform in persist. */
export const REMOVED_PLATFORM_MIGRATE_TO: Record<string, ActiveTtsPlatform> = {
  vina_voice: 'la_studio',
  vieneu_tts: 'la_studio',
  openai_tts: 'edge_tts',
  google: 'edge_tts',
  google_tts: 'edge_tts',
  elevenlabs: 'edge_tts',
  hotai_tts: 'edge_tts',
  vbee: 'edge_tts',
};

export function isActiveTtsPlatform(platform: string): platform is ActiveTtsPlatform {
  const id = String(platform || '')
    .trim()
    .toLowerCase();
  return (ACTIVE_TTS_PLATFORMS as readonly string[]).includes(id);
}

export function isEngineManualTtsPlatform(
  platform: string,
): platform is EngineManualTtsPlatform {
  const id = String(platform || '')
    .trim()
    .toLowerCase();
  return (ENGINE_MANUAL_TTS_PLATFORMS as readonly string[]).includes(id);
}

export function isLaStudioEnvPlatform(
  platform: string,
): platform is LaStudioEnvPlatform {
  const id = String(platform || '')
    .trim()
    .toLowerCase();
  return (LA_STUDIO_ENV_PLATFORMS as readonly string[]).includes(id);
}

export function isRemovedTtsPlatform(platform: string): boolean {
  const id = String(platform || '')
    .trim()
    .toLowerCase();
  return (REMOVED_TTS_PLATFORMS as readonly string[]).includes(id);
}

export function normalizeTtsPlatformId(platform: string): string {
  return String(platform || '')
    .trim()
    .toLowerCase();
}

/**
 * Suggest migrate target for removed/stale platform.
 * Returns null if already active or empty.
 */
export function suggestMigrateTtsPlatform(
  platform: string,
): ActiveTtsPlatform | null {
  const id = normalizeTtsPlatformId(platform);
  if (!id) return null;
  if (isActiveTtsPlatform(id)) return null;
  if (REMOVED_PLATFORM_MIGRATE_TO[id]) return REMOVED_PLATFORM_MIGRATE_TO[id];
  // Unknown stale id → Edge (always free + local-ish)
  return 'edge_tts';
}

export function removedTtsPlatformMessage(platform: string): string {
  const id = normalizeTtsPlatformId(platform);
  const label = TTS_PLATFORM_LABELS[id] || id || '?';
  const to = suggestMigrateTtsPlatform(id) || 'edge_tts';
  const toLabel = TTS_PLATFORM_LABELS[to] || to;
  if (to === 'la_studio') {
    return (
      `Nền tảng TTS «${label}» đã gỡ khỏi app. ` +
      `Mở Cấu Hình Giọng → tab **LA Studio**. ` +
      `Không fallback ngầm sang engine khác.`
    );
  }
  return (
    `Nền tảng TTS «${label}» đã gỡ khỏi app. ` +
    `Mở Cấu Hình Giọng → tab Engine chọn tay → «${toLabel}». ` +
    `Không fallback ngầm sang engine khác.`
  );
}
