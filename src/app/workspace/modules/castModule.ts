/**
 * Role Casting Studio — resolve scene + bulk rules + API payload.
 */
import type { NhanVatPromptsMap } from '@/lib/characterProfile';
import { buildSceneCastSegments } from '@/lib/castDialogue';
import { getCharacterVoiceOptions, suggestVoiceFromProfile } from '@/lib/characterVoice';
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

  const platform = params.platform || 'edge_tts';
  const language = params.language || 'vi';
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
      : (role?.voiceId || defaultVoice).trim() || defaultVoice;
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
  const pool = getCharacterVoiceOptions(platform, language, {
    includeAllLanguages: false,
  });
  const fullPool =
    pool.length > 0
      ? pool
      : getCharacterVoiceOptions(platform, language, { includeAllLanguages: true });

  const used = new Set<string>();
  const out: VoiceRole[] = [];

  // Narrator first — keep default
  for (const r of roles) {
    if (r.id === NARRATOR_ROLE_ID || r.kind === 'narrator') {
      const v = (r.voiceId || defaultVoice).trim() || defaultVoice;
      used.add(v);
      out.push({ ...r, voiceId: v });
    }
  }

  for (const r of roles) {
    if (r.id === NARRATOR_ROLE_ID || r.kind === 'narrator') continue;
    if (r.locked && r.voiceId?.trim()) {
      used.add(r.voiceId.trim());
      out.push(r);
      continue;
    }

    const name = r.characterName || r.label || '';
    const profile = name ? prompts[name] : undefined;
    let v = (r.voiceId || '').trim();
    const explicit = (profile?.tts_voice || '').trim();
    if (explicit) v = explicit;
    const g = (profile?.gioi_tinh || '').toLowerCase();
    const wantF = /nữ|nu|female/.test(g);
    const wantM = (/nam|male/.test(g) && !wantF) || (!wantF && !g && r.kind === 'character');
    // Prefer gender-matched suggestion first
    if (!v || used.has(v)) {
      const suggested = suggestVoiceFromProfile(profile, platform, language);
      if (suggested && !used.has(suggested)) v = suggested;
    }
    if (!v || used.has(v)) {
      for (const opt of fullPool) {
        if (!opt.id || used.has(opt.id)) continue;
        if (wantF && opt.gender && opt.gender !== 'female') continue;
        if (wantM && !wantF && opt.gender && opt.gender !== 'male') continue;
        v = opt.id;
        break;
      }
    }
    // Prefer gender-correct voice even if shared (pitch diversifies multi-path)
    if (wantF) {
      const female = fullPool.find((o) => o.gender === 'female' || /hoaimy|nu|female/i.test(o.id + o.name));
      if (female?.id) v = female.id;
    } else if (wantM) {
      const male = fullPool.find((o) => o.gender === 'male' || /namminh|male/i.test(o.id + o.name));
      if (male?.id) v = male.id;
    }
    if (!v) {
      for (const opt of fullPool) {
        if (opt.id && !used.has(opt.id)) {
          v = opt.id;
          break;
        }
      }
    }
    if (!v) v = defaultVoice || fullPool[0]?.id || 'vi-VN-NamMinhNeural';
    used.add(v);
    out.push({
      ...r,
      voiceId: v,
      voicesByPlatform: {
        ...(r.voicesByPlatform || {}),
        [platform]: v,
      },
    });
  }

  // Preserve order similar to input
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
