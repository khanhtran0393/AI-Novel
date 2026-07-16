/**
 * Seedance 2.0 types — aligned with D:\repo\seedance-2.0-main/schemas/*
 * Lite subset used inside AI Novel (prompt compiler + sequence planning).
 * Full OS (take history, surface matrix, retake protocol) stays in the repo skill.
 */

export type SeedanceSequenceRelation =
  | 'standalone'
  | 'sequence_first_clip'
  | 'seamless_continuation'
  | 'intentional_next_shot'
  | 'bridge_between_known_states'
  | 'repair_tail'
  | 'reanchor_after_drift';

export type SeedanceShotStructure =
  | 'compact_single_take'
  | 'phased_single_take'
  | 'dense_multishot'
  | 'first_last_frame_transition'
  | 'video_edit_contract';

export type SeedanceClipStatus =
  | 'planned'
  | 'ready'
  | 'generated'
  | 'reviewed'
  | 'accepted'
  | 'accepted_with_deviation'
  | 'repair'
  | 'rejected';

export type SeedanceBeatBucketStatus =
  | 'planned'
  | 'current'
  | 'completed'
  | 'omitted'
  | 'replaced';

/** schemas/clip-contract.schema.json — required fields + AI Novel extras */
export interface SeedanceClipContract {
  project_id: string;
  clip_id: string;
  parent_clip_id: string | null;
  scene_id: string;
  sequence_index: number;
  narrative_job: string;
  felt_intent: string;
  target_duration_sec: number | null;
  generation_mode: string;
  shot_structure: SeedanceShotStructure;
  already_happened: string[];
  this_clip_only: string[];
  reserved_for_later: string[];
  planned_start_state: Record<string, unknown>;
  planned_end_state: Record<string, unknown>;
  continuity_locks: string[];
  allowed_changes: string[];
  status: SeedanceClipStatus;
  /** AI Novel: chapter/scene linkage */
  chapter_num?: number;
  scene_index?: number;
  prompt_index?: number;
}

/** schemas/prompt-spec.schema.json */
export interface SeedancePromptSpec {
  project_id: string;
  clip_id: string;
  prompt_version: string;
  sequence_relation: SeedanceSequenceRelation;
  generation_mode: string;
  reference_roles: Array<{ tag: string; role: string }>;
  opening_state_source:
    | 'planned_start_state'
    | 'observed_end_state'
    | 'user_supplied_final_frame'
    | 'source_clip';
  current_clip_action: string;
  endpoint: string;
  completed_beat_exclusions: string[];
  reserved_future_exclusions: string[];
  natural_language_prompt: string;
  /** compiled craft metadata */
  felt_intent?: string;
  shot_structure?: SeedanceShotStructure;
  shot_count?: number;
}

export interface SeedanceBeat {
  beat_id: string;
  description: string;
  narrative_function: string;
  status: SeedanceBeatBucketStatus;
  assigned_clip_id: string | null;
  dependencies: string[];
}

export interface SeedanceScenePlan {
  scene_id: string;
  scene_index: number;
  narrative_function: string;
  arc_position: 'open' | 'rising' | 'turn' | 'climax' | 'release';
  location: string;
  time_of_day: string;
  anchor_source: string[];
  max_chain_depth: number;
  audio_plan: string;
  assigned_clip_ids: string[];
  transition_out: string;
  status: SeedanceBeatBucketStatus;
  script_excerpt?: string;
}

/** schemas/project-state.schema.json — lite for AI Novel chapter */
export interface SeedanceProjectStateLite {
  schema_version: string;
  state_revision: number;
  project_id: string;
  project_mode: 'standalone_clip' | 'sequence_project';
  surface: { name: string; notes: string };
  clip_budget_sec: number | null;
  prompt_budget: number | null;
  story: {
    logline: string;
    story_promise: string;
    objective: string;
    initial_condition: string;
    final_outcome: string;
    target_duration_sec: number | null;
    tone: string;
    medium: string;
  };
  world_bible: Record<string, unknown>;
  reference_registry: Array<{ tag: string; role: string; preserve_exact_tag: true }>;
  scenes: SeedanceScenePlan[];
  beats: SeedanceBeat[];
  clips: SeedanceClipContract[];
  take_history: unknown[];
  current_clip_id: string;
  canon_revision: number;
  updated_at: string;
  /** AI Novel extras */
  chapter_num?: number;
  seconds_per_beat?: number;
  source: 'seedance-bridge-v2';
}

export interface MultishotPlan {
  shotCount: number;
  shotStructure: SeedanceShotStructure;
  secondsPerShot: number;
  labels: string[];
}
