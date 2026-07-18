/**
 * Resolve global TTS config for TTS Batch SRT.
 * Same source of truth as scene TTS: store.ttsConfig (+ optional narrator cast).
 * Always returns a plain JSON-serializable snapshot (no Proxy / stale closure).
 */
import type { TTSConfig } from '@/store/novelTypes';
import {
  NARRATOR_ROLE_ID,
  normalizeVoiceCast,
  type ProjectVoiceCast,
} from '@/lib/voiceCast';

export type GlobalTtsSnapshot = {
  platform: string;
  language: string;
  voice: string;
  /** Full plain object for server / generate-tts parity */
  ttsConfig: Record<string, unknown>;
};

function pickNum(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build payload from live store (or partial). Prefer getState() at click time.
 */
export function resolveGlobalTtsForBatch(input: {
  ttsConfig?: Partial<TTSConfig> | null;
  voiceCast?: ProjectVoiceCast | null;
  /** Optional explicit override */
  voiceOverride?: string | null;
}): GlobalTtsSnapshot {
  const cfg = (input.ttsConfig || {}) as Partial<TTSConfig>;
  const platform = String(cfg.platform || '').trim();
  const language = String(cfg.language || '').trim() || 'vi';

  let voice = String(input.voiceOverride || cfg.voice || '').trim();

  // Fallback: narrator Role Cast (global storytelling voice)
  if (!voice && input.voiceCast) {
    const cast = normalizeVoiceCast(input.voiceCast);
    const nar =
      cast.roles.find((r) => r.id === NARRATOR_ROLE_ID) ||
      cast.roles.find((r) => r.kind === 'narrator');
    if (nar?.voiceId?.trim()) {
      voice = nar.voiceId.trim();
    }
  }

  // Plain snapshot — every field generate-tts / vina / edge care about
  const ttsConfig: Record<string, unknown> = {
    platform,
    language,
    voice,
    speed: pickNum(cfg.speed, 1),
    pitch: pickNum(cfg.pitch, 0),
    tiktokSessionId: String(cfg.tiktokSessionId || ''),
    api_url_vieneu: String(
      cfg.api_url_vieneu || 'https://api.vieneu.com/tts',
    ),
    syncMode: cfg.syncMode || 'default',
    vinaGender: cfg.vinaGender ?? 'male',
    vinaArea: cfg.vinaArea ?? 'southern',
    vinaGroup: cfg.vinaGroup ?? 'story',
    vinaEmotion: cfg.vinaEmotion ?? 'neutral',
    vinaUseClone: cfg.vinaUseClone !== false,
    vinaReferenceAudio: cfg.vinaReferenceAudio || '',
    vinaReferenceAudioB64: cfg.vinaReferenceAudioB64 || '',
    vinaReferenceText: cfg.vinaReferenceText || '',
    vinaSpeakerSeed:
      typeof cfg.vinaSpeakerSeed === 'number' ? cfg.vinaSpeakerSeed : 2336,
    vinaStyleSeed:
      typeof cfg.vinaStyleSeed === 'number' ? cfg.vinaStyleSeed : 4125,
    vinaEngineUrl: cfg.vinaEngineUrl || '',
    googleCloudApiKey: cfg.googleCloudApiKey || '',
    vbeeApiKey: cfg.vbeeApiKey || '',
    vbeeAppId: cfg.vbeeAppId || '',
  };

  return { platform, language, voice, ttsConfig };
}

export function assertGlobalTtsReady(s: GlobalTtsSnapshot): void {
  if (!s.platform) {
    throw new Error(
      'Thiếu engine TTS toàn cục. Mở Cấu hình giọng đọc → chọn platform.',
    );
  }
  if (!s.voice) {
    throw new Error(
      'Thiếu giọng TTS toàn cục. Mở Cấu hình giọng đọc → chọn voice/profile (hoặc gán Narrator Role Cast).',
    );
  }
  if (!s.language) {
    throw new Error('Thiếu language TTS toàn cục.');
  }
}
