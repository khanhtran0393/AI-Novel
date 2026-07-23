/**
 * Speaker Registry — every "voice" is a zero-shot SpeakerRef
 * (reference_audio + reference_text + seeds), not a separate engine.
 *
 * Catalog studio WAV and user clones share the same ONNX brain path.
 */
import fs from 'fs';
import path from 'path';
import type { SpeakerRef, VinaProfileEntry, VinaVoiceSettings } from './types';
import {
  applyProfileToSettings,
  getVinaDataDir,
  loadVinaProfiles,
  mergeSettings,
  resolveSamplePath,
} from './profiles';

export class SpeakerResolveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SpeakerResolveError';
  }
}

function kindFromProfile(p: VinaProfileEntry): SpeakerRef['kind'] {
  const src = (p._source || '').toLowerCase();
  if (src.includes('user') || src.includes('upload') || src.includes('scan')) {
    return 'user_clone';
  }
  return 'catalog';
}

function profileToSpeaker(
  profile: VinaProfileEntry,
  settings: VinaVoiceSettings,
  cwd: string,
  kind?: SpeakerRef['kind'],
): SpeakerRef {
  const merged = applyProfileToSettings(settings, profile, cwd);
  const ref = (merged.reference_audio || '').trim();
  if (!ref || !fs.existsSync(ref)) {
    throw new SpeakerResolveError(
      'CODE_REF_MISSING',
      `Profile "${profile.name}" không có file mẫu trên disk (filename=${profile.filename}). ` +
        `Kiểm tra data/vina-voices/samples hoặc user-clones.`,
    );
  }
  return {
    id: profile.name,
    kind: kind || kindFromProfile(profile),
    reference_audio: path.resolve(ref),
    reference_text: (merged.reference_text || profile.text || '').trim(),
    speaker_seed: merged.speaker_seed ?? 2336,
    style_seed: merged.style_seed ?? 4125,
    speed: merged.speed ?? 1,
    pitch_shift: merged.pitch_shift ?? 0,
    formant: merged.formant ?? 1,
    treble_boost: merged.treble_boost ?? 0,
    displayName: profile.name,
  };
}

/**
 * First catalog/user profile that has a resolvable sample WAV on disk.
 * Used as DEFAULT_NARRATOR when no voice/profile selected.
 */
export function resolveDefaultNarratorProfile(
  cwd = process.cwd(),
): VinaProfileEntry | null {
  const profiles = loadVinaProfiles(cwd);
  const preferredNames = [
    'Lồng Tiếng Phim - Nam Già 1',
    'Lồng Tiếng Phim - Nữ Trẻ 1',
    'Tin Tức - Nam Trẻ 1',
  ];
  for (const name of preferredNames) {
    const hit = profiles.find((p) => p.name === name);
    if (hit && resolveSamplePath(hit, {}, cwd)) return hit;
  }
  for (const p of profiles) {
    if (resolveSamplePath(p, {}, cwd)) return p;
  }
  return null;
}

/**
 * Resolve a SpeakerRef from profile name or ad-hoc settings.
 *
 * Important: when `profileName` is set (catalog dropdown), always resolve by
 * that profile's WAV. Never let a stale `settings.reference_audio` from the
 * previous voice win — that made every preview sound identical.
 */
export function resolveSpeaker(opts: {
  cwd?: string;
  profileName?: string;
  settings?: Partial<VinaVoiceSettings>;
  /** Explicit opt-in only; preview/global TTS must not silently swap voices. */
  allowDefaultNarrator?: boolean;
  /**
   * Only used when there is NO profileName (Create-voice / ad-hoc upload).
   * Default true for that path; ignored when profileName is present.
   */
  preferAdHocRef?: boolean;
}): SpeakerRef {
  const cwd = opts.cwd || process.cwd();
  const settings = mergeSettings(opts.settings, cwd);
  const profiles = loadVinaProfiles(cwd);
  const adHoc = (settings.reference_audio || '').trim();

  // 1) Named catalog/user profile ALWAYS wins over leftover UI ref audio
  if (opts.profileName) {
    const hit = profiles.find((p) => p.name === opts.profileName);
    if (!hit) {
      throw new SpeakerResolveError(
        'CODE_PROFILE_NOT_FOUND',
        `Không thấy profile "${opts.profileName}" trong profiles_goc/user.`,
      );
    }
    return profileToSpeaker(hit, settings, cwd);
  }

  // 2) Ad-hoc ref only for Create-voice / upload (no profile name)
  if (opts.preferAdHocRef !== false && adHoc && fs.existsSync(adHoc)) {
    return {
      id: 'ad_hoc_ref',
      kind: 'ad_hoc',
      reference_audio: path.resolve(adHoc),
      reference_text: (settings.reference_text || '').trim(),
      speaker_seed: settings.speaker_seed ?? 2336,
      style_seed: settings.style_seed ?? 4125,
      speed: settings.speed ?? 1,
      pitch_shift: settings.pitch_shift ?? 0,
      formant: settings.formant ?? 1,
      treble_boost: settings.treble_boost ?? 0,
      displayName: 'Ad-hoc clone ref',
    };
  }

  // 3) settings.reference_audio without profile name
  if (adHoc && fs.existsSync(adHoc)) {
    return {
      id: 'settings_ref',
      kind: 'ad_hoc',
      reference_audio: path.resolve(adHoc),
      reference_text: (settings.reference_text || '').trim(),
      speaker_seed: settings.speaker_seed ?? 2336,
      style_seed: settings.style_seed ?? 4125,
      speed: settings.speed ?? 1,
      pitch_shift: settings.pitch_shift ?? 0,
      formant: settings.formant ?? 1,
      treble_boost: settings.treble_boost ?? 0,
      displayName: 'Settings reference',
    };
  }

  // 4) Default narrator — always a real studio/user sample
  if (opts.allowDefaultNarrator !== true) {
    throw new SpeakerResolveError(
      'CODE_REF_MISSING',
      'VinaVoice: chưa chọn profile Zero-Shot hoặc reference_audio hợp lệ. Không dùng DEFAULT_NARRATOR.',
    );
  }

  const def = resolveDefaultNarratorProfile(cwd);
  if (!def) {
    throw new SpeakerResolveError(
      'CODE_REF_MISSING',
      `Không resolve được DEFAULT_NARRATOR: không có sample WAV trong ` +
        `${path.join(getVinaDataDir(cwd), 'samples')}.`,
    );
  }
  return profileToSpeaker(def, settings, cwd, 'default_narrator');
}

/** Apply SpeakerRef fields onto VinaVoiceSettings for native infer + prosody. */
export function speakerToSettings(
  speaker: SpeakerRef,
  base?: Partial<VinaVoiceSettings>,
  cwd = process.cwd(),
): VinaVoiceSettings {
  return mergeSettings(
    {
      ...base,
      reference_audio: speaker.reference_audio,
      reference_text: speaker.reference_text,
      speaker_seed: speaker.speaker_seed,
      style_seed: speaker.style_seed,
      speed: speaker.speed,
      pitch_shift: speaker.pitch_shift,
      formant: speaker.formant,
      treble_boost: speaker.treble_boost,
      use_clone: true,
    },
    cwd,
  );
}

export function listResolvableSpeakers(cwd = process.cwd()): SpeakerRef[] {
  const settings = mergeSettings({}, cwd);
  const out: SpeakerRef[] = [];
  for (const p of loadVinaProfiles(cwd)) {
    try {
      out.push(profileToSpeaker(p, settings, cwd));
    } catch {
      /* skip missing samples */
    }
  }
  return out;
}
