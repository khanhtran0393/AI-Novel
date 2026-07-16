/**
 * Vina-Voice behavioral types — ported from Vina-Voice_V5.4 structure
 * (session_state / profiles_goc / help.json) — independent of the closed .exe.
 */

export type VinaGender = 'male' | 'female';
export type VinaArea = 'northern' | 'central' | 'southern';
export type VinaGroup =
  | 'story'
  | 'news'
  | 'audiobook'
  | 'ads'
  | 'dubbing'
  | 'review'
  | string;
export type VinaEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fear'
  | 'gentle'
  | 'tired'
  | string;

export interface VinaTextRule {
  active?: boolean;
  type?: 'simple' | 'smart' | string;
  pattern?: string;
  replacement?: string;
  case?: boolean;
  run_after?: boolean;
  /** smart-rule fields (ported for forward-compat; simple rules cover majority) */
  pattern_template?: string;
  replace_true?: string;
  replace_false?: string;
  condition_value?: string;
  operator?: string;
  logic_target?: string;
}

export interface VinaVoiceSettings {
  gender: VinaGender;
  area: VinaArea;
  group: VinaGroup;
  emotion: VinaEmotion;
  /** 0.5–2.0 relative speed (1.0 = normal) */
  speed: number;
  /** cross-fade between chunks, seconds */
  cross_fade_duration: number;
  speaker_seed: number;
  style_seed: number;
  /** absolute path or app-relative path to reference WAV for clone mode */
  reference_audio: string;
  reference_audio_b64?: string;
  reference_text: string;
  use_clone: boolean;
  chunking_strategy: 'automatic' | 'manual' | string;
  max_chars_per_chunk: number;
  chunk_length_buffer: number;
  list_markers: string;
  pause_dot_ms: number;
  pause_comma_ms: number;
  pause_question_ms: number;
  pause_semicolon_ms: number;
  pause_exclamation_ms: number;
  /** pitch shift semitones (pyworld-style) */
  pitch_shift: number;
  /** formant scale ~0.9–1.1 */
  formant: number;
  treble_boost: number;
  custom_rules: VinaTextRule[];
  /** directory of bundled/user sample wavs */
  samples_dir: string;
  /** optional external engine URL (http://127.0.0.1:8765) */
  engine_url: string;
}

export interface VinaProfileEntry {
  name: string;
  filename: string;
  text: string;
  speed?: number;
  pyworld_speed?: number;
  speaker_seed?: number;
  style_seed?: number;
  pitch_shift?: number;
  formant?: number;
  treble_boost?: number;
  _source?: string;
  _dir?: string;
}

export interface VinaChunk {
  index: number;
  text: string;
  pauseAfterMs: number;
}

export interface VinaSynthesizeRequest {
  text: string;
  settings?: Partial<VinaVoiceSettings>;
  /** profile name from profiles_goc / profiles_user */
  profileName?: string;
  /** Deprecated; kept for API compatibility. Vina no longer falls back to Edge. */
  forceBuiltin?: boolean;
  /**
   * Universal Zero-Shot mode (default true when brain ready).
   * Catalog + clone share the same ONNX path; no silent Edge.
   */
  universalBrainMode?: boolean;
  /** Preview path: lower nfe_step for faster first listen */
  isPreview?: boolean;
  /** Chapter/script batch: mid NFE (between preview and full) */
  isChapter?: boolean;
}

export interface VinaSynthesizeResult {
  ok: boolean;
  method: string;
  audioPath?: string;
  audioBase64?: string;
  mimeType?: string;
  durationSec?: number;
  chunks: number;
  warnings: string[];
  error?: string;
  /** Structured error for UVE */
  errorCode?: VinaUveErrorCode;
  /** Speaker used for zero-shot (when resolved) */
  speakerId?: string;
}

/** Zero-shot speaker = ref audio + transcript + seeds (not a separate neural engine). */
export interface SpeakerRef {
  id: string;
  kind: 'catalog' | 'user_clone' | 'role_override' | 'ad_hoc' | 'default_narrator';
  reference_audio: string;
  reference_text: string;
  speaker_seed: number;
  style_seed: number;
  speed: number;
  pitch_shift: number;
  formant: number;
  treble_boost: number;
  displayName: string;
}

export type VinaUveErrorCode =
  | 'CODE_BRAIN_MISSING'
  | 'CODE_REF_MISSING'
  | 'CODE_REF_TEXT_EMPTY'
  | 'CODE_PROFILE_NOT_FOUND'
  | 'CODE_INFER_FAILED'
  | 'CODE_EMPTY_TEXT'
  | 'CODE_EMERGENCY_EDGE';

export const DEFAULT_VINA_SETTINGS: VinaVoiceSettings = {
  gender: 'male',
  area: 'southern',
  group: 'story',
  emotion: 'neutral',
  speed: 1.0,
  cross_fade_duration: 0.098,
  speaker_seed: 2336,
  style_seed: 4125,
  reference_audio: '',
  reference_text: '',
  /** Universal Zero-Shot: catalog + clone share ONNX brain */
  use_clone: true,
  chunking_strategy: 'automatic',
  max_chars_per_chunk: 125,
  chunk_length_buffer: 50,
  list_markers: '- * •',
  pause_dot_ms: 600,
  pause_comma_ms: 250,
  pause_question_ms: 600,
  pause_semicolon_ms: 600,
  pause_exclamation_ms: 600,
  pitch_shift: 0,
  formant: 1.0,
  treble_boost: 0,
  custom_rules: [],
  samples_dir: '',
  engine_url: 'http://127.0.0.1:8765',
};
