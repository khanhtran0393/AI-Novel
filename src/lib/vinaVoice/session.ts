/**
 * Session state — mirrors Vina session_state.json settings block.
 * Runtime overrides live in data/vina-voices/session/runtime.json
 */
import fs from 'fs';
import { vinaPaths, ensureVinaEnvironment } from './paths';
import type { VinaTextRule, VinaVoiceSettings } from './types';
import { DEFAULT_VINA_SETTINGS } from './types';

export interface VinaSessionSettings {
  gender: string;
  area: string;
  group: string;
  emotion: string;
  speed: number;
  cross_fade_duration: number;
  speaker_seed: number;
  style_seed: number;
  reference_audio: string;
  reference_text: string;
  use_clone: boolean;
  chunking_strategy: string;
  max_chars_per_chunk: number;
  chunk_length_buffer: number;
  list_markers: string;
  pause_dot_ms: number;
  pause_comma_ms: number;
  pause_question_ms: number;
  pause_semicolon_ms: number;
  pause_exclamation_ms: number;
  stream_buffer_size: number;
  pitch_shift: number;
  formant: number;
  treble_boost: number;
  custom_rules: VinaTextRule[];
  engine_url: string;
  samples_dir: string;
}

export interface VinaSessionFile {
  active_tab?: number;
  text_content?: string;
  settings?: Partial<VinaSessionSettings> & { custom_rules?: VinaTextRule[] };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Load Vina-compatible defaults + optional runtime override */
export function loadVinaSession(cwd = process.cwd()): VinaSessionSettings {
  ensureVinaEnvironment(cwd);
  const p = vinaPaths(cwd);
  const base = readJson<VinaSessionFile>(p.sessionState, {});
  const runtime = readJson<VinaSessionFile>(p.sessionRuntime, {});
  const s = {
    ...(base.settings || {}),
    ...(runtime.settings || {}),
  };

  return {
    gender: (s.gender as string) || DEFAULT_VINA_SETTINGS.gender,
    area: (s.area as string) || DEFAULT_VINA_SETTINGS.area,
    group: (s.group as string) || DEFAULT_VINA_SETTINGS.group,
    emotion: (s.emotion as string) || DEFAULT_VINA_SETTINGS.emotion,
    speed: typeof s.speed === 'number' ? s.speed : DEFAULT_VINA_SETTINGS.speed,
    cross_fade_duration:
      typeof s.cross_fade_duration === 'number'
        ? s.cross_fade_duration
        : DEFAULT_VINA_SETTINGS.cross_fade_duration,
    speaker_seed: s.speaker_seed ?? DEFAULT_VINA_SETTINGS.speaker_seed,
    style_seed: s.style_seed ?? DEFAULT_VINA_SETTINGS.style_seed,
    reference_audio: s.reference_audio || '',
    reference_text: s.reference_text || '',
    use_clone: s.use_clone ?? false,
    chunking_strategy: s.chunking_strategy || 'automatic',
    max_chars_per_chunk: s.max_chars_per_chunk ?? 125,
    chunk_length_buffer: s.chunk_length_buffer ?? 50,
    list_markers: s.list_markers || '- * •',
    pause_dot_ms: s.pause_dot_ms ?? 600,
    pause_comma_ms: s.pause_comma_ms ?? 250,
    pause_question_ms: s.pause_question_ms ?? 600,
    pause_semicolon_ms: s.pause_semicolon_ms ?? 600,
    pause_exclamation_ms: s.pause_exclamation_ms ?? 600,
    stream_buffer_size: s.stream_buffer_size ?? 6,
    pitch_shift: s.pitch_shift ?? 0,
    formant: s.formant ?? 1,
    treble_boost: s.treble_boost ?? 0,
    custom_rules: Array.isArray(s.custom_rules) ? s.custom_rules : [],
    engine_url: s.engine_url || DEFAULT_VINA_SETTINGS.engine_url,
    samples_dir: s.samples_dir || p.samples,
  };
}

export function saveVinaSessionPartial(
  partial: Partial<VinaSessionSettings>,
  cwd = process.cwd(),
): VinaSessionSettings {
  ensureVinaEnvironment(cwd);
  const p = vinaPaths(cwd);
  const current = loadVinaSession(cwd);
  const next = { ...current, ...partial };
  const file: VinaSessionFile = {
    settings: next,
    text_content: '',
  };
  fs.writeFileSync(p.sessionRuntime, JSON.stringify(file, null, 2), 'utf8');
  return next;
}

export function sessionToVoiceSettings(
  session: VinaSessionSettings,
): VinaVoiceSettings {
  return {
    ...DEFAULT_VINA_SETTINGS,
    gender: (session.gender as VinaVoiceSettings['gender']) || 'male',
    area: (session.area as VinaVoiceSettings['area']) || 'southern',
    group: session.group,
    emotion: session.emotion,
    speed: session.speed,
    cross_fade_duration: session.cross_fade_duration,
    speaker_seed: session.speaker_seed,
    style_seed: session.style_seed,
    reference_audio: session.reference_audio,
    reference_text: session.reference_text,
    use_clone: session.use_clone,
    chunking_strategy: session.chunking_strategy,
    max_chars_per_chunk: session.max_chars_per_chunk,
    chunk_length_buffer: session.chunk_length_buffer,
    list_markers: session.list_markers,
    pause_dot_ms: session.pause_dot_ms,
    pause_comma_ms: session.pause_comma_ms,
    pause_question_ms: session.pause_question_ms,
    pause_semicolon_ms: session.pause_semicolon_ms,
    pause_exclamation_ms: session.pause_exclamation_ms,
    pitch_shift: session.pitch_shift,
    formant: session.formant,
    treble_boost: session.treble_boost,
    custom_rules: session.custom_rules,
    engine_url: session.engine_url,
    samples_dir: session.samples_dir,
  };
}
