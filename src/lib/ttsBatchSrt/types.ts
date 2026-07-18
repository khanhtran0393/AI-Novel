/**
 * TTS Batch SRT — types (toolbox tool).
 * CapAssist-style pipe: extract → STT → translate → parallel TTS → CapCut draft inject
 * (optional full FFmpeg mux). Không hard-render full video trên nhánh draft.
 */

export type TtsBatchAlignMode = 'sequential' | 'timeline';

/**
 * draft = CapCut draft inject (default, không re-encode full video)
 * full_mux = optional FFmpeg 04_final_dub
 * (legacy alias: fast42 → draft)
 */
export type TtsBatchPipelineMode = 'draft' | 'full_mux';

/** STT — Google AI Studio only (no local Whisper). */
export type TtsBatchSttProvider = 'google_studio';

/** Cloud TTS engines allowed on this pipe (no Piper/Vina/local). */
export const GOOGLE_STUDIO_TTS_PLATFORMS = [
  'gemini_tts',
  'google',
] as const;

export type SrtCue = {
  /** 1-based index from file */
  index: number;
  startMs: number;
  endMs: number;
  /** Raw multi-line text (may include "Speaker: …") */
  text: string;
  /** Optional speaker from "Name: dialogue" first line */
  speaker?: string;
};

export type TtsBatchPlatform =
  | 'piper'
  | 'omnivoice_local'
  | 'vina_voice'
  | 'edge_tts'
  | 'tiktok_tts'
  | 'vieneu_tts'
  | 'gemini_tts'
  | 'openai_tts'
  | 'google'
  | 'capcut_tts'
  | string;

export type TtsBatchRequest = {
  srtText: string;
  /** Full ttsConfig from store (platform, voice, speed, pitch, vina*, tiktok…) */
  ttsConfig: Record<string, unknown>;
  /** Override voice id (else ttsConfig.voice) */
  voice?: string;
  apiKeys?: string[];
  /** Override auto concurrency */
  concurrency?: number;
  /**
   * sequential = nối phần theo thứ tự (audiobook nhanh)
   * timeline = chèn silence theo start timestamp SRT (khớp video)
   */
  alignMode?: TtsBatchAlignMode;
  applyLoudnorm?: boolean;
  jobName?: string;
  /** When true, fill trailing silence to cue.endMs if speech shorter */
  padToCueEnd?: boolean;
  /** Stretch speech when longer than cue window (default true on timeline) */
  fitToCue?: boolean;
  /**
   * Optional multi-voice: speaker label (NFC) → voice id (same platform).
   * Unmatched speakers use global voice.
   */
  speakerVoiceMap?: Record<string, string>;
  /**
   * Default true: only Google AI Studio / Cloud TTS (gemini_tts | google).
   * Rejects Piper/Vina/local — hard-fail (B10 no silent swap).
   */
  forceGoogleStudioCloud?: boolean;
};

/** Normalize pipeline mode; accept legacy `fast42` → `draft`. */
export function normalizePipelineMode(raw: unknown): TtsBatchPipelineMode {
  if (raw === 'full_mux') return 'full_mux';
  // legacy
  if (raw === 'fast42' || raw === 'draft' || raw == null || raw === '') return 'draft';
  return 'draft';
}

export type TtsBatchCueResult = {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  /** Public URL under /audio/... */
  audioPath?: string;
  /** Absolute disk path for CapCut draft inject */
  diskPath?: string;
  durationSec?: number;
  error?: string;
};

export type TtsBatchResult = {
  ok: true;
  audioPath: string;
  duration: number;
  cueCount: number;
  concurrency: number;
  alignMode: TtsBatchAlignMode;
  platform: string;
  voice: string;
  method?: string;
  cues: TtsBatchCueResult[];
  /** Absolute job directory on disk */
  jobDirAbs?: string;
  jobDir: string;
  stretchCount?: number;
};

export type TtsBatchProgressEvent =
  | {
      type: 'start';
      cueCount: number;
      concurrency: number;
      platform: string;
      alignMode: TtsBatchAlignMode;
      /** Resolved global voice id for this batch */
      voice?: string;
    }
  | { type: 'cue'; current: number; total: number; index: number; ok: boolean; label?: string }
  | { type: 'concat'; label: string }
  | { type: 'done'; result: TtsBatchResult }
  | { type: 'error'; error: string };

export type CapCutDraftArtifact = {
  draftId: string;
  filePath: string;
  draftsDir: string;
  displayName?: string;
  captionCount: number;
  audioClipCount?: number;
  method: 'capcut_draft_inject';
};
