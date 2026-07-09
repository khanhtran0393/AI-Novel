/**
 * Load Vina-style profiles from data/vina-voices (independent catalog).
 */
import fs from 'fs';
import path from 'path';
import type { VinaProfileEntry, VinaVoiceSettings } from './types';
import { DEFAULT_VINA_SETTINGS } from './types';

export function getVinaDataDir(cwd = process.cwd()): string {
  return path.join(cwd, 'data', 'vina-voices');
}

function loadProfilesFile(
  file: string,
): VinaProfileEntry[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      Omit<VinaProfileEntry, 'name'>
    >;
    return Object.entries(raw).map(([name, v]) => ({
      name,
      filename: v.filename,
      text: v.text || '',
      speed: v.speed,
      pyworld_speed: v.pyworld_speed,
      speaker_seed: v.speaker_seed,
      style_seed: v.style_seed,
      pitch_shift: v.pitch_shift,
      formant: v.formant,
      treble_boost: v.treble_boost,
      _source: v._source,
      _dir: v._dir,
    }));
  } catch {
    return [];
  }
}

/** Quét file WAV/MP3 trong user-clones chưa có trong profiles_user */
function scanUserCloneOrphans(cwd: string): VinaProfileEntry[] {
  const userDir = path.join(getVinaDataDir(cwd), 'user-clones');
  if (!fs.existsSync(userDir)) return [];
  try {
    return fs
      .readdirSync(userDir)
      .filter((f) => /\.(wav|mp3|m4a|flac|ogg)$/i.test(f) && !/_raw\./i.test(f))
      .map((f) => {
        const base = f.replace(/\.[^.]+$/, '');
        return {
          name: `USER · ${base}`,
          filename: f,
          text: '',
          speed: 1,
          speaker_seed: 2336,
          style_seed: 4125,
          pitch_shift: 0,
          _source: 'user_scan',
          _dir: userDir,
        } as VinaProfileEntry;
      });
  } catch {
    return [];
  }
}

export function loadVinaProfiles(cwd = process.cwd()): VinaProfileEntry[] {
  const dir = getVinaDataDir(cwd);
  const goc = loadProfilesFile(path.join(dir, 'profiles_goc.json'));
  const user = loadProfilesFile(path.join(dir, 'profiles_user.json'));
  // Gắn _dir cho user profiles nếu thiếu
  const userNorm = user.map((p) => ({
    ...p,
    _dir: p._dir || path.join(dir, 'user-clones'),
    _source: p._source || 'user_upload',
  }));
  const orphans = scanUserCloneOrphans(cwd).filter(
    (o) =>
      !userNorm.some(
        (u) => u.filename === o.filename || u.name === o.name,
      ),
  );
  // User clones first so they appear on top of filtered lists
  const mergedUser = [...userNorm, ...orphans];
  return [
    ...mergedUser,
    ...goc.filter((p) => !mergedUser.some((u) => u.name === p.name)),
  ];
}

export function loadDefaultRules(cwd = process.cwd()): VinaVoiceSettings['custom_rules'] {
  const file = path.join(getVinaDataDir(cwd), 'session_state.json');
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw?.settings?.custom_rules || [];
  } catch {
    return [];
  }
}

export function resolveSamplePath(
  profile: VinaProfileEntry,
  settings: Partial<VinaVoiceSettings>,
  cwd = process.cwd(),
): string {
  const candidates: string[] = [];
  // Absolute path stored as filename
  if (profile.filename && (profile.filename.includes('\\') || profile.filename.includes('/'))) {
    candidates.push(profile.filename);
  }
  if (settings.reference_audio) candidates.push(settings.reference_audio);
  if (settings.samples_dir) {
    candidates.push(path.join(settings.samples_dir, profile.filename));
  }
  if (profile._dir) {
    candidates.push(path.join(profile._dir, profile.filename));
  }
  const dataDir = getVinaDataDir(cwd);
  candidates.push(path.join(dataDir, 'samples', profile.filename));
  candidates.push(path.join(dataDir, 'user-clones', profile.filename));
  // fallback: original Vina install path (if still on disk)
  candidates.push(
    path.join('D:', 'Vina-Voice_V5.4', 'Vina-Voice_V5.4', 'VGA', 'saved_voices_goc', profile.filename),
    path.join('D:', 'Vina-Voice_V5.4', 'Vina-Voice_V5.4', 'VGA', 'saved_voices', profile.filename),
    path.join('D:', 'Vina-Voice_V5.4', 'Vina-Voice_V5.4', 'VGA', 'saved_voices_goc', path.basename(profile.filename || '')),
  );
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return '';
}

/** Probe HTTP engine (8765) — clone XTTS / fallback */
export async function probeVinaEngine(
  engineUrl?: string,
  timeoutMs = 2500,
): Promise<{
  online: boolean;
  url: string;
  xtts_available?: boolean;
  clone_ready?: boolean;
  error?: string;
}> {
  const url = (engineUrl || process.env.VINA_ENGINE_URL || 'http://127.0.0.1:8765').replace(
    /\/$/,
    '',
  );
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { online: false, url, error: `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as {
      xtts_available?: boolean;
      clone_ready?: boolean;
    };
    return {
      online: true,
      url,
      xtts_available: !!data.xtts_available,
      clone_ready: data.clone_ready !== false,
    };
  } catch (e) {
    return {
      online: false,
      url,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function mergeSettings(
  partial?: Partial<VinaVoiceSettings>,
  cwd = process.cwd(),
): VinaVoiceSettings {
  const rules = partial?.custom_rules?.length
    ? partial.custom_rules
    : loadDefaultRules(cwd);
  return {
    ...DEFAULT_VINA_SETTINGS,
    ...partial,
    custom_rules: rules,
  };
}

/**
 * Profile speed trong Vina data có 2 kiểu:
 * - Tương đối 0.5–2.0 (roles.json: speed: 1.0)
 * - Phần trăm 50–200 (một số export cũ)
 * Không được chia 100 khi đã là 1.0 → trước đây làm ra 0.01 rồi clamp 0.5.
 */
export function normalizeProfileSpeedFactor(raw?: number | null): number {
  if (raw == null || !Number.isFinite(Number(raw))) return 1;
  const n = Number(raw);
  if (n > 2.5) {
    // percent style (e.g. 100 = 1.0x)
    return Math.max(0.5, Math.min(2, n / 100));
  }
  if (n > 0) return Math.max(0.5, Math.min(2, n));
  return 1;
}

/**
 * Gộp profile clone + settings UI.
 * **Speed / pitch từ UI (settings) luôn thắng** — profile chỉ nhân hệ số speed gốc
 * và cộng pitch_shift gốc của profile (nếu có).
 */
export function applyProfileToSettings(
  settings: VinaVoiceSettings,
  profile: VinaProfileEntry,
  cwd = process.cwd(),
): VinaVoiceSettings {
  const sample = resolveSamplePath(profile, settings, cwd);
  const userSpeed =
    typeof settings.speed === 'number' && Number.isFinite(settings.speed)
      ? settings.speed
      : 1;
  const profileSpeedFactor = normalizeProfileSpeedFactor(
    profile.speed ?? profile.pyworld_speed ?? 1,
  );
  // UI speed là tốc độ người dùng muốn; profile 1.0 → giữ nguyên UI
  const mergedSpeed = Math.max(0.5, Math.min(2, userSpeed * profileSpeedFactor));

  const userPitch =
    typeof settings.pitch_shift === 'number' && Number.isFinite(settings.pitch_shift)
      ? settings.pitch_shift
      : 0;
  const profilePitch =
    typeof profile.pitch_shift === 'number' && Number.isFinite(profile.pitch_shift)
      ? profile.pitch_shift
      : 0;
  // UI pitch + profile base (không để profile.pitch_shift = 0 ghi đè mất UI)
  const mergedPitch = userPitch + profilePitch;

  return {
    ...settings,
    speed: mergedSpeed,
    speaker_seed: profile.speaker_seed ?? settings.speaker_seed,
    style_seed: profile.style_seed ?? settings.style_seed,
    pitch_shift: mergedPitch,
    formant:
      typeof profile.formant === 'number' && Number.isFinite(profile.formant)
        ? profile.formant
        : settings.formant,
    treble_boost:
      typeof profile.treble_boost === 'number' && Number.isFinite(profile.treble_boost)
        ? profile.treble_boost
        : settings.treble_boost,
    reference_audio: sample || settings.reference_audio,
    reference_text: profile.text || settings.reference_text,
    use_clone: !!(sample || settings.use_clone),
  };
}

/** Map Vina gender/area/group → Edge neural voice (builtin backend) */
export function mapToEdgeVoice(settings: VinaVoiceSettings): string {
  if (settings.gender === 'female') {
    // Edge has limited VI voices
    return 'vi-VN-HoaiMyNeural';
  }
  return 'vi-VN-NamMinhNeural';
}

/** Emotion / area micro-adjust pitch (semitones) */
export function emotionPitchBias(settings: VinaVoiceSettings): number {
  let p = settings.pitch_shift || 0;
  if (settings.area === 'northern') p += 0.3;
  if (settings.area === 'southern') p -= 0.2;
  switch (settings.emotion) {
    case 'happy':
      p += 0.8;
      break;
    case 'sad':
      p -= 1.2;
      break;
    case 'angry':
      p += 0.4;
      break;
    case 'fear':
      p += 1.0;
      break;
    case 'gentle':
      p -= 0.4;
      break;
    case 'tired':
      p -= 0.8;
      break;
    default:
      break;
  }
  // seed-stable tiny jitter (not random each call)
  const seedJitter = ((settings.speaker_seed % 17) - 8) * 0.05;
  return p + seedJitter;
}
