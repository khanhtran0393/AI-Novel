/**
 * Build speaker → voice map from Role Cast for TTS Batch multi-voice.
 */
import {
  normalizeVoiceCast,
  type ProjectVoiceCast,
} from '@/lib/voiceCast';

function key(name: string): string {
  return String(name || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Map role labels / character names → voiceId (same global platform).
 */
export function speakerVoiceMapFromCast(
  voiceCast?: ProjectVoiceCast | null,
): Record<string, string> {
  const cast = normalizeVoiceCast(voiceCast);
  if (!cast.enabled || !cast.roles.length) return {};
  const out: Record<string, string> = {};
  for (const r of cast.roles) {
    const voiceId = String(r.voiceId || '').trim();
    if (!voiceId) continue;
    if (r.label) out[key(r.label)] = voiceId;
    if (r.characterName) out[key(r.characterName)] = voiceId;
  }
  return out;
}
