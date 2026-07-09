/**
 * Export Role Casting → Vina-Voice compatible roles.json + Role-Profile map.
 */
import type { NhanVatPromptsMap } from './characterProfile';
import type { ProjectVoiceCast, VoiceRole } from './voiceCast';
import { normalizeVoiceCast } from './voiceCast';

export interface VinaRoleSlot {
  name: string;
  speed: number;
  pyworld_speed: number;
  pitch: number;
  formant: number;
  silence_threshold: number;
  use_clone: boolean;
  speaker_seed: number;
  style_seed: number;
  clone_profile_name: string;
  gender: string;
  area: string;
  group: string;
  emotion: string;
}

/** Map AI Novel gioi_tinh → Vina gender field (do not trust Vina sample gender). */
export function mapGenderToVina(gioiTinh?: string): 'male' | 'female' {
  const g = (gioiTinh || '').toLowerCase().normalize('NFC');
  if (/(nữ|nu|female|girl|woman|cô|chị|bà)/i.test(g)) return 'female';
  return 'male';
}

export function exportVinaRolesJson(
  cast: ProjectVoiceCast,
  defaults?: {
    speaker_seed?: number;
    style_seed?: number;
    gender?: string;
    area?: string;
    group?: string;
  },
  prompts?: NhanVatPromptsMap,
): Record<string, VinaRoleSlot> {
  const c = normalizeVoiceCast(cast);
  const out: Record<string, VinaRoleSlot> = {};
  for (const r of c.roles) {
    if (r.kind === 'narrator') continue;
    if (typeof r.vinaRoleIndex !== 'number' || r.vinaRoleIndex < 1) continue;
    const profileGender =
      r.characterName && prompts?.[r.characterName]?.gioi_tinh
        ? mapGenderToVina(prompts[r.characterName].gioi_tinh)
        : undefined;
    out[String(r.vinaRoleIndex)] = roleToVinaSlot(r, {
      ...defaults,
      gender: profileGender || defaults?.gender,
    });
  }
  return out;
}

function roleToVinaSlot(
  r: VoiceRole,
  defaults?: {
    speaker_seed?: number;
    style_seed?: number;
    gender?: string;
    area?: string;
    group?: string;
  },
): VinaRoleSlot {
  return {
    name: r.label || r.characterName || r.id,
    speed: typeof r.speed === 'number' ? r.speed : 1.0,
    pyworld_speed: typeof r.speed === 'number' ? r.speed : 1.0,
    pitch: typeof r.pitch === 'number' ? r.pitch : 0,
    formant: 1.0,
    silence_threshold: -10,
    use_clone: true,
    speaker_seed: defaults?.speaker_seed ?? 2336,
    style_seed: defaults?.style_seed ?? 4125,
    clone_profile_name: r.voiceId || r.label,
    gender: defaults?.gender || 'male',
    area: defaults?.area || 'southern',
    group: defaults?.group || 'story',
    emotion: r.emotion || 'neutral',
  };
}

/**
 * Role-Profile: characterName → roleId string.
 * Narrator is NOT a key; skip names without dialogue role can map to "0".
 */
export function exportVinaRoleProfile(
  cast: ProjectVoiceCast,
  characterNames: string[],
  opts?: { unassignedAsZero?: boolean },
): Record<string, string> {
  const c = normalizeVoiceCast(cast);
  const unassignedAsZero = opts?.unassignedAsZero !== false;
  const out: Record<string, string> = {};
  for (const name of characterNames) {
    const n = name.normalize('NFC').trim();
    if (!n) continue;
    const role = c.roles.find(
      (r) =>
        r.kind === 'character' &&
        (r.characterName?.normalize('NFC') === n || r.label.normalize('NFC') === n),
    );
    if (role && typeof role.vinaRoleIndex === 'number' && role.vinaRoleIndex >= 1) {
      out[n] = String(role.vinaRoleIndex);
    } else if (unassignedAsZero) {
      out[n] = '0';
    }
  }
  return out;
}

export function downloadJson(filename: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
