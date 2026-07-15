/**
 * Project-level multi-character voice cast (Role Casting Studio).
 * Elevate existing multi-voice TTS — does not replace single-voice path.
 */

import {
  characterRoleId as contractCharacterRoleId,
  sceneAssetKey,
} from '@/contracts';

export type VoiceRoleKind = 'narrator' | 'character' | 'extra';

export type CastSegmentSource =
  | 'auto_name'
  | 'ai_tag'
  | 'manual'
  | 'narrator'
  | 'ambiguous';

export interface VoiceRole {
  id: string;
  label: string;
  kind: VoiceRoleKind;
  characterName?: string;
  voiceId: string;
  /** Last known voice per platform — migration cache */
  voicesByPlatform?: Partial<Record<string, string>>;
  /** MVP: generate always uses ttsConfig.platform */
  platform?: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  locked?: boolean;
  /**
   * Sticky integer for bulk #n and Vina roles.json keys.
   * Narrator: omit. Characters/extras: ≥ 1.
   */
  vinaRoleIndex?: number;
}

export interface CastSegment {
  id: string;
  chapter: number;
  sceneIndex: number;
  order: number;
  speakerRoleId: string;
  text: string;
  source: CastSegmentSource;
  locked?: boolean;
  confidence?: number;
}

export interface ProjectVoiceCast {
  version: 1;
  enabled: boolean;
  roles: VoiceRole[];
  segmentOverrides: Record<
    string,
    Partial<
      Pick<CastSegment, 'speakerRoleId' | 'source' | 'locked' | 'confidence' | 'text'>
    >
  >;
  boardScope?: 'scene' | 'chapter';
  sceneTextHashes?: Record<string, string>;
  vinaVoiceExePath?: string;
  allowTextOverride?: boolean;
}

export const EMPTY_VOICE_CAST: ProjectVoiceCast = {
  version: 1,
  enabled: false,
  roles: [],
  segmentOverrides: {},
  boardScope: 'scene',
  sceneTextHashes: {},
  allowTextOverride: false,
};

export const NARRATOR_ROLE_ID = 'narrator';

/** djb2 → 12 hex chars */
export function hash12(input: string): string {
  let h = 5381;
  const s = input.normalize('NFC');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h |= 0;
  }
  // unsigned + pad
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 12);
}

export function normalizeSegText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** @see contracts/keys.characterRoleId — same wire as characterImageKey */
export function characterRoleId(name: string): string {
  return contractCharacterRoleId(name);
}

export function makeSegmentId(params: {
  chapter: number;
  sceneIndex: number;
  text: string;
  speakerGuess: string | null;
}): string {
  const base = [
    params.chapter,
    params.sceneIndex,
    params.speakerGuess?.normalize('NFC') || '',
    normalizeSegText(params.text).slice(0, 80),
  ].join('|');
  return `seg_${hash12(base)}`;
}

export function normalizeVoiceRole(raw?: Partial<VoiceRole> | null): VoiceRole | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw.id || '').trim();
  if (!id) return null;
  const kind: VoiceRoleKind =
    raw.kind === 'character' || raw.kind === 'extra' || raw.kind === 'narrator'
      ? raw.kind
      : id === NARRATOR_ROLE_ID
        ? 'narrator'
        : 'character';
  return {
    id,
    label: (raw.label || id).trim(),
    kind,
    characterName: raw.characterName?.normalize('NFC'),
    voiceId: (raw.voiceId || '').trim(),
    voicesByPlatform: raw.voicesByPlatform && typeof raw.voicesByPlatform === 'object'
      ? { ...raw.voicesByPlatform }
      : {},
    platform: raw.platform,
    speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : undefined,
    pitch: typeof raw.pitch === 'number' && Number.isFinite(raw.pitch) ? raw.pitch : undefined,
    emotion: raw.emotion?.trim() || undefined,
    locked: !!raw.locked,
    vinaRoleIndex:
      typeof raw.vinaRoleIndex === 'number' && raw.vinaRoleIndex >= 1
        ? Math.floor(raw.vinaRoleIndex)
        : kind === 'narrator'
          ? undefined
          : undefined,
  };
}

export function normalizeVoiceCast(raw?: Partial<ProjectVoiceCast> | null): ProjectVoiceCast {
  const base = { ...EMPTY_VOICE_CAST };
  if (!raw || typeof raw !== 'object') return { ...base };
  const roles = (Array.isArray(raw.roles) ? raw.roles : [])
    .map((r) => normalizeVoiceRole(r))
    .filter((r): r is VoiceRole => !!r);
  return {
    ...base,
    ...raw,
    version: 1,
    roles,
    segmentOverrides:
      raw.segmentOverrides && typeof raw.segmentOverrides === 'object'
        ? { ...raw.segmentOverrides }
        : {},
    sceneTextHashes:
      raw.sceneTextHashes && typeof raw.sceneTextHashes === 'object'
        ? { ...raw.sceneTextHashes }
        : {},
    boardScope: raw.boardScope === 'chapter' ? 'chapter' : 'scene',
    allowTextOverride: raw.allowTextOverride === true,
    // Corrupt enabled+empty → disabled
    enabled: raw.enabled === true && roles.length > 0,
  };
}

/** Sole generate-path gate */
export function isCastActive(cast?: ProjectVoiceCast | null): boolean {
  return (
    !!cast &&
    cast.enabled === true &&
    Array.isArray(cast.roles) &&
    cast.roles.length > 0
  );
}

export function maxVinaRoleIndex(roles: VoiceRole[]): number {
  let max = 0;
  for (const r of roles) {
    if (typeof r.vinaRoleIndex === 'number' && r.vinaRoleIndex > max) {
      max = r.vinaRoleIndex;
    }
  }
  return max;
}

export function findRoleByCharacter(
  roles: VoiceRole[],
  characterName: string,
): VoiceRole | undefined {
  const n = characterName.normalize('NFC').trim();
  return roles.find(
    (r) =>
      r.kind === 'character' &&
      (r.characterName?.normalize('NFC') === n || r.label.normalize('NFC') === n),
  );
}

export function findRoleByVinaIndex(
  roles: VoiceRole[],
  index: number,
): VoiceRole | undefined {
  if (index === 0) return roles.find((r) => r.id === NARRATOR_ROLE_ID);
  return roles.find((r) => r.vinaRoleIndex === index);
}

/**
 * Gate multi-path when cast is active.
 * Compares only vs ttsConfig defaults — NEVER storyboard sceneEmotion.
 * Also multi when ≥2 speaker roles (nhân vật khác nhau) — even if voice id temporarily same
 * (caller should diversify voice/pitch first).
 */
export function shouldUseCastMulti(
  segments: Array<{
    voice: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
    speakerRoleId?: string;
  }>,
  global: { voice: string; speed: number; pitch: number },
): boolean {
  if (!segments.length) return false;
  const voices = new Set(segments.map((s) => (s.voice || global.voice).trim()).filter(Boolean));
  if (voices.size > 1) return true;

  const roles = new Set(
    segments.map((s) => (s.speakerRoleId || '').trim()).filter((id) => id && id !== 'narrator'),
  );
  // ≥1 character role + narrator, or ≥2 character roles → multi path needed
  const hasNarr = segments.some(
    (s) => !s.speakerRoleId || s.speakerRoleId === 'narrator' || s.speakerRoleId === NARRATOR_ROLE_ID,
  );
  if (roles.size >= 2) return true;
  if (roles.size >= 1 && hasNarr && segments.length >= 2) return true;

  for (const s of segments) {
    if (typeof s.speed === 'number' && Math.abs(s.speed - global.speed) > 0.001) return true;
    if (typeof s.pitch === 'number' && Math.abs(s.pitch - global.pitch) > 0.001) return true;
  }

  const ems = new Set(segments.map((s) => (s.emotion || '').trim()));
  if (ems.size > 1) return true;

  return false;
}

export interface ResolvedSeg {
  id: string;
  speaker: string | null;
  speakerRoleId: string;
  text: string;
  voice: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  source: CastSegmentSource;
  locked?: boolean;
}

/** @see contracts/keys.sceneAssetKey */
export function sceneKey(chapter: number, sceneIndex: number): string {
  return sceneAssetKey(chapter, sceneIndex);
}
