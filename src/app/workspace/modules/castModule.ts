/**
 * Role Casting Studio — resolve scene + bulk rules + API payload.
 */
import type { NhanVatPromptsMap } from '@/lib/characterProfile';
import { buildSceneCastSegments } from '@/lib/castDialogue';
import {
  ensureSeededCast,
  seedRolesFromProject,
  migrateRolesForPlatform,
  type CastSeedSnapshot,
} from '@/lib/castSeed';
import {
  NARRATOR_ROLE_ID,
  findRoleByCharacter,
  findRoleByVinaIndex,
  isCastActive,
  normalizeVoiceCast,
  shouldUseCastMulti,
  type ProjectVoiceCast,
  type ResolvedSeg,
  type VoiceRole,
  sceneKey,
} from '@/lib/voiceCast';

export type { CastSeedSnapshot };
export {
  seedRolesFromProject,
  ensureSeededCast,
  migrateRolesForPlatform,
  isCastActive,
  sceneKey,
};

export function resolveSceneCast(params: {
  sceneText: string;
  chapter: number;
  sceneIndex: number;
  cast: ProjectVoiceCast;
  characterNames: string[];
  nhanVatPrompts: NhanVatPromptsMap;
  defaultVoice: string;
  platform: string;
  language?: string;
  globalSpeed: number;
  globalPitch: number;
}): { segments: ResolvedSeg[]; useMulti: boolean; textHash: string } {
  const {
    sceneText,
    chapter,
    sceneIndex,
    cast,
    characterNames,
    defaultVoice,
    globalSpeed,
    globalPitch,
  } = params;

  const castNorm = normalizeVoiceCast(cast);
  const { segments: boardSegs, textHash } = buildSceneCastSegments({
    sceneText,
    chapter,
    sceneIndex,
    characterNames,
    cast: castNorm,
  });

  const platform = (params.platform || '').trim();
  if (!platform) {
    throw new Error('Chua chon engine TTS (platform).');
  }
  const language = (params.language || '').trim();
  const prompts = params.nhanVatPrompts || {};

  // Diversify role voiceIds so different characters don't all share global default
  const diversifiedRoles = diversifyRoleVoices(
    castNorm.roles,
    platform,
    language,
    prompts,
    defaultVoice,
  );
  const roleById = new Map(diversifiedRoles.map((r) => [r.id, r]));
  const narrator = roleById.get(NARRATOR_ROLE_ID);
  const narrVoice = (narrator?.voiceId || defaultVoice).trim();

  // Stable pitch offsets when voices still collide (same engine voice for 2 males)
  const pitchBump = new Map<string, number>();
  let bump = 0;
  for (const r of diversifiedRoles) {
    if (r.kind === 'character' || r.kind === 'extra') {
      if (typeof r.pitch !== 'number') {
        pitchBump.set(r.id, bump);
        bump += 1;
      }
    }
  }

  const resolved: ResolvedSeg[] = boardSegs.map((seg) => {
    let role = roleById.get(seg.speakerRoleId);
    if (!role && seg.speakerRoleId.startsWith('char_')) {
      const name = seg.speakerRoleId.slice(5);
      role = findRoleByCharacter(diversifiedRoles, name);
    }
    const isNarr = !role || role.id === NARRATOR_ROLE_ID || role.kind === 'narrator';
    const voice = isNarr
      ? narrVoice
      : (role?.voiceId || '').trim();
    const speaker = isNarr ? null : role?.characterName || role?.label || null;
    const roleId = role?.id || (isNarr ? NARRATOR_ROLE_ID : seg.speakerRoleId);
    const pitch =
      typeof role?.pitch === 'number'
        ? role.pitch
        : !isNarr
          ? (pitchBump.get(roleId) ?? 0) || undefined
          : undefined;

    return {
      id: seg.id,
      speaker,
      speakerRoleId: roleId,
      text: seg.text,
      voice,
      speed: role?.speed,
      pitch,
      emotion: role?.emotion,
      source: seg.source,
      locked: seg.locked,
    };
  });

  const useMulti =
    isCastActive(castNorm) &&
    shouldUseCastMulti(
      resolved.map((s) => ({
        voice: s.voice,
        speed: s.speed ?? globalSpeed,
        pitch: s.pitch ?? globalPitch,
        emotion: s.emotion,
        speakerRoleId: s.speakerRoleId,
      })),
      { voice: defaultVoice, speed: globalSpeed, pitch: globalPitch },
    );

  return { segments: resolved, useMulti, textHash };
}

/**
 * Assign distinct voiceIds per character role when they all collapse to the same default.
 * Prefers profile gender / explicit tts_voice; then unused options from catalog.
 */
export function diversifyRoleVoices(
  roles: VoiceRole[],
  platform: string,
  language: string,
  prompts: NhanVatPromptsMap,
  defaultVoice: string,
): VoiceRole[] {
  void language;
  const out: VoiceRole[] = [];

  for (const r of roles) {
    if (r.id === NARRATOR_ROLE_ID || r.kind === 'narrator') {
      const v = (r.voiceId || defaultVoice).trim();
      out.push(v ? { ...r, voiceId: v } : { ...r, voiceId: '' });
      continue;
    }

    const name = r.characterName || r.label || '';
    const explicit = name ? (prompts[name]?.tts_voice || '').trim() : '';
    const v = (r.voiceId || explicit || '').trim();
    out.push({
      ...r,
      voiceId: v,
      voicesByPlatform: v
        ? {
            ...(r.voicesByPlatform || {}),
            [platform]: v,
          }
        : r.voicesByPlatform,
    });
  }

  const byId = new Map(out.map((r) => [r.id, r]));
  return roles.map((r) => byId.get(r.id) || r);
}

export function toApiVoiceSegments(
  resolved: ResolvedSeg[],
  global: { speed: number; pitch: number },
): Array<{
  speaker: string | null;
  text: string;
  voice: string;
  speed: number;
  pitch: number;
  emotion: string;
}> {
  return resolved
    .filter((s) => s.text?.trim() && s.voice)
    .map((s) => ({
      speaker: s.speaker,
      text: s.text,
      voice: s.voice,
      speed: typeof s.speed === 'number' ? s.speed : global.speed,
      pitch: typeof s.pitch === 'number' ? s.pitch : global.pitch,
      emotion: (s.emotion || '').trim(),
    }));
}

export function applyBulkRoleRule(params: {
  segments: Array<{ id: string; order: number }>;
  selectedOrders: number[];
  rule: string;
  roles: VoiceRole[];
}): { updates: { segmentId: string; speakerRoleId: string }[]; errors: string[] } {
  const tokens = (params.rule || '')
    .split(/[-–—,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/^#/, ''));

  const indices = tokens.map((t) => parseInt(t, 10)).filter((n) => Number.isFinite(n));
  const updates: { segmentId: string; speakerRoleId: string }[] = [];
  const errors: string[] = [];
  if (!indices.length) {
    errors.push('Quy tắc bulk rỗng hoặc không hợp lệ (vd: #1-#2-#1).');
    return { updates, errors };
  }

  const selected = [...params.selectedOrders].sort((a, b) => a - b);
  selected.forEach((order, i) => {
    const ruleIdx = indices[i % indices.length];
    const role = findRoleByVinaIndex(params.roles, ruleIdx);
    if (!role) {
      errors.push(`Vai #${ruleIdx} không tồn tại (sticky hole hoặc chưa seed).`);
      return;
    }
    const seg = params.segments.find((s) => s.order === order);
    if (!seg) return;
    updates.push({ segmentId: seg.id, speakerRoleId: role.id });
  });

  return { updates, errors };
}
