export type TtsCacheVariantConfig = {
  platform?: unknown;
  vinaGender?: unknown;
  vinaArea?: unknown;
  vinaGroup?: unknown;
  vinaEmotion?: unknown;
  vinaReferenceAudio?: unknown;
  vinaReferenceAudioB64?: unknown;
  vinaReferenceText?: unknown;
};

function stableTinyHash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function norm(value: unknown): string {
  return String(value ?? '').normalize('NFC').trim().toLowerCase();
}

function compactPathToken(value: unknown): string {
  const s = String(value ?? '').normalize('NFC').trim();
  if (!s) return '';
  return `${s.length}:${stableTinyHash(s)}`;
}

function compactTextToken(value: unknown): string {
  const s = String(value ?? '').normalize('NFC').trim();
  if (!s) return '';
  return `${s.length}:${stableTinyHash(s.slice(0, 600))}`;
}

/**
 * Settings that change how a selected TTS voice sounds, beyond speed/pitch.
 * This is intentionally small and client-safe so preview cache and server
 * scene cache invalidate in the same situations.
 */
export function buildTtsCacheVariantKey(config?: TtsCacheVariantConfig | null): string {
  const platform = norm(config?.platform);
  if (platform !== 'vina_voice') return '';

  return [
    'vina-v2',
    `g=${norm(config?.vinaGender) || 'male'}`,
    `a=${norm(config?.vinaArea) || 'southern'}`,
    `grp=${norm(config?.vinaGroup) || 'story'}`,
    `emo=${norm(config?.vinaEmotion) || 'neutral'}`,
    `ref=${compactPathToken(config?.vinaReferenceAudio)}`,
    `refText=${compactTextToken(config?.vinaReferenceText)}`,
    `refB64=${compactTextToken(config?.vinaReferenceAudioB64)}`,
  ].join('|');
}
