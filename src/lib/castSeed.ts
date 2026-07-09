/**
 * Seed / migrate Role Cast — pure helpers (safe for store + UI).
 */
import type { NhanVatProfile, NhanVatPromptsMap } from './characterProfile';
import {
  suggestProsodyFromProfile,
  suggestVoiceFromProfile,
} from './characterVoice';
import {
  EMPTY_VOICE_CAST,
  NARRATOR_ROLE_ID,
  characterRoleId,
  maxVinaRoleIndex,
  normalizeVoiceCast,
  type ProjectVoiceCast,
  type VoiceRole,
} from './voiceCast';

export type CastSeedSnapshot = {
  nhan_vat: string[];
  nhan_vat_prompts: NhanVatPromptsMap;
  ttsConfig: {
    platform: string;
    language?: string;
    voice: string;
    speed: number;
    pitch: number;
  };
  voiceCast?: ProjectVoiceCast | null;
};

/** Gắn speed/pitch/emotion từ quirk hồ sơ (không đụng role locked). */
function applyProsodyFromProfile(
  role: VoiceRole,
  profile: Partial<NhanVatProfile> | undefined,
  baseSpeed: number,
  basePitch: number,
  opts?: { force?: boolean },
): VoiceRole {
  if (role.locked && !opts?.force) return role;
  const prosody = suggestProsodyFromProfile(profile, { baseSpeed, basePitch });
  const force = opts?.force === true;
  return {
    ...role,
    speed:
      force || role.speed == null || !Number.isFinite(role.speed)
        ? prosody.speed
        : role.speed,
    pitch:
      force || role.pitch == null || !Number.isFinite(role.pitch)
        ? prosody.pitch
        : role.pitch,
    emotion: force || !role.emotion ? prosody.emotion || role.emotion : role.emotion,
  };
}

export function seedRolesFromProject(state: CastSeedSnapshot): VoiceRole[] {
  const platform = state.ttsConfig.platform || 'edge_tts';
  const language = state.ttsConfig.language || 'vi';
  const defaultVoice = (state.ttsConfig.voice || '').trim();
  const baseSpeed =
    typeof state.ttsConfig.speed === 'number' && Number.isFinite(state.ttsConfig.speed)
      ? state.ttsConfig.speed
      : 1;
  const basePitch =
    typeof state.ttsConfig.pitch === 'number' && Number.isFinite(state.ttsConfig.pitch)
      ? state.ttsConfig.pitch
      : 0;
  const existing = normalizeVoiceCast(state.voiceCast).roles;
  const existingByChar = new Map<string, VoiceRole>();
  let narrator = existing.find((r) => r.id === NARRATOR_ROLE_ID);
  for (const r of existing) {
    if (r.kind === 'character' && r.characterName) {
      existingByChar.set(r.characterName.normalize('NFC'), r);
    }
  }

  const roles: VoiceRole[] = [];
  if (!narrator) {
    narrator = {
      id: NARRATOR_ROLE_ID,
      label: 'Người kể',
      kind: 'narrator',
      voiceId: defaultVoice,
      voicesByPlatform: defaultVoice ? { [platform]: defaultVoice } : {},
      speed: baseSpeed,
      pitch: basePitch,
      emotion: 'neutral',
    };
  } else if (!narrator.voiceId && defaultVoice) {
    narrator = {
      ...narrator,
      voiceId: defaultVoice,
      voicesByPlatform: {
        ...(narrator.voicesByPlatform || {}),
        [platform]: defaultVoice,
      },
      speed: narrator.speed ?? baseSpeed,
      pitch: narrator.pitch ?? basePitch,
    };
  } else {
    narrator = {
      ...narrator,
      speed: narrator.speed ?? baseSpeed,
      pitch: narrator.pitch ?? basePitch,
    };
  }
  roles.push(narrator);

  const wasEmpty =
    existing.filter((r) => r.kind === 'character' || r.kind === 'extra').length === 0;
  let nextIndex = wasEmpty ? 1 : maxVinaRoleIndex(existing) + 1;

  for (const name of state.nhan_vat || []) {
    const n = name.normalize('NFC').trim();
    if (!n) continue;
    const profile = state.nhan_vat_prompts?.[n] as Partial<NhanVatProfile> | undefined;
    const prev = existingByChar.get(n);
    if (prev) {
      // Giữ role cũ; nếu thiếu speed/pitch → bù từ quirk hồ sơ (trừ khi locked)
      const filled = applyProsodyFromProfile(prev, profile, baseSpeed, basePitch, {
        force: false,
      });
      roles.push({
        ...filled,
        id: characterRoleId(n),
        characterName: n,
        label: filled.label || n,
        kind: 'character',
        vinaRoleIndex:
          typeof filled.vinaRoleIndex === 'number' && filled.vinaRoleIndex >= 1
            ? filled.vinaRoleIndex
            : nextIndex++,
      });
      continue;
    }
    const explicit = (profile?.tts_voice || '').trim();
    const voiceId =
      explicit ||
      suggestVoiceFromProfile(profile, platform, language) ||
      defaultVoice;
    const prosody = suggestProsodyFromProfile(profile, { baseSpeed, basePitch });
    roles.push({
      id: characterRoleId(n),
      label: n,
      kind: 'character',
      characterName: n,
      voiceId,
      voicesByPlatform: voiceId ? { [platform]: voiceId } : {},
      speed: prosody.speed,
      pitch: prosody.pitch,
      emotion: prosody.emotion,
      vinaRoleIndex: nextIndex++,
    });
  }

  for (const r of existing) {
    if (r.kind === 'extra' && !roles.some((x) => x.id === r.id)) {
      roles.push({
        ...r,
        vinaRoleIndex:
          typeof r.vinaRoleIndex === 'number' && r.vinaRoleIndex >= 1
            ? r.vinaRoleIndex
            : nextIndex++,
      });
    }
  }

  for (const r of roles) {
    if (r.kind === 'narrator') r.vinaRoleIndex = undefined;
  }

  return roles;
}

export function ensureSeededCast(state: CastSeedSnapshot): ProjectVoiceCast {
  const current = normalizeVoiceCast(state.voiceCast);
  // Roles already present: merge new characters (sticky indices), enable cast
  if (current.roles.length > 0) {
    const seeded = seedRolesFromProject(state);
    return normalizeVoiceCast({
      ...current,
      enabled: true,
      roles: seeded,
    });
  }
  // First seed from empty
  const roles = seedRolesFromProject({
    ...state,
    voiceCast: { ...EMPTY_VOICE_CAST, roles: [] },
  });
  return normalizeVoiceCast({
    ...current,
    enabled: roles.length > 0,
    roles,
  });
}

export function migrateRolesForPlatform(
  roles: VoiceRole[],
  newPlatform: string,
  language: string,
  prompts: NhanVatPromptsMap,
  defaultVoice: string,
  opts?: { baseSpeed?: number; basePitch?: number },
): VoiceRole[] {
  const baseSpeed = opts?.baseSpeed ?? 1;
  const basePitch = opts?.basePitch ?? 0;
  return roles.map((r) => {
    const cached = r.voicesByPlatform?.[newPlatform]?.trim();
    if (cached) {
      return { ...r, voiceId: cached };
    }
    if (r.kind === 'narrator') {
      const v = defaultVoice || r.voiceId;
      return {
        ...r,
        voiceId: v,
        voicesByPlatform: { ...(r.voicesByPlatform || {}), [newPlatform]: v },
      };
    }
    if (r.kind === 'character' && r.characterName) {
      const profile = prompts[r.characterName];
      const v =
        (profile?.tts_voice || '').trim() ||
        suggestVoiceFromProfile(profile, newPlatform, language) ||
        defaultVoice ||
        r.voiceId;
      const withVoice = {
        ...r,
        voiceId: v,
        voicesByPlatform: { ...(r.voicesByPlatform || {}), [newPlatform]: v },
      };
      return applyProsodyFromProfile(withVoice, profile, baseSpeed, basePitch, {
        force: false,
      });
    }
    return {
      ...r,
      voiceId: defaultVoice || r.voiceId,
      voicesByPlatform: {
        ...(r.voicesByPlatform || {}),
        [newPlatform]: defaultVoice || r.voiceId,
      },
    };
  });
}

/**
 * Ép gợi ý lại voice + speed/pitch/emotion từ quirk cho mọi NV (bỏ qua locked).
 * Dùng nút "Gợi ý tất cả" trong Studio.
 */
export function suggestAllRolesFromProfiles(
  roles: VoiceRole[],
  prompts: NhanVatPromptsMap,
  platform: string,
  language: string,
  baseSpeed: number,
  basePitch: number,
): { roles: VoiceRole[]; updated: number } {
  let updated = 0;
  const next = roles.map((r) => {
    if (r.kind === 'narrator' || r.locked) return r;
    if (r.kind !== 'character' || !r.characterName) return r;
    const profile = prompts[r.characterName];
    const voiceId =
      (profile?.tts_voice || '').trim() ||
      suggestVoiceFromProfile(profile, platform, language) ||
      r.voiceId;
    const prosody = suggestProsodyFromProfile(profile, { baseSpeed, basePitch });
    const changed =
      voiceId !== r.voiceId ||
      prosody.speed !== r.speed ||
      prosody.pitch !== r.pitch ||
      (prosody.emotion || '') !== (r.emotion || '');
    if (!changed) return r;
    updated += 1;
    return {
      ...r,
      voiceId,
      voicesByPlatform: {
        ...(r.voicesByPlatform || {}),
        [platform]: voiceId,
      },
      speed: prosody.speed,
      pitch: prosody.pitch,
      emotion: prosody.emotion,
    };
  });
  return { roles: next, updated };
}
