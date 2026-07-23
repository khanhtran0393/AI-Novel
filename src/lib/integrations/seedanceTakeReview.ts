/**
 * Take review + continuation handoff — aligned with
 * references/retake-protocol.md + references/continuation-handoff.md
 */
import type {
  SeedanceClipContract,
  SeedanceClipStatus,
  SeedanceProjectStateLite,
  SeedanceSequenceRelation,
} from './seedanceTypes';
import { buildClipContract, buildPromptSpec } from './seedanceSequence';
import { compileSeedancePrompt } from './seedance';
import type { SeedanceCompileResult } from './seedance';

export type TakeVerdict =
  | 'keep'
  | 'fix_in_post'
  | 'edit'
  | 're_roll'
  | 'rewrite';

export interface HandoffObservation {
  observed_start_state: string;
  observed_end_state: string;
  open_motion_vector?: string;
  camera_phase?: string;
  screen_direction?: string;
  character_pose?: string;
  prop_state?: string;
  location?: string;
  lighting_phase?: string;
  audio_phase?: string;
  observation_confidence: 'high' | 'medium' | 'low';
  uncertainties?: string[];
}

export interface TakeRecord {
  take_id: string;
  clip_id: string;
  take_index: number;
  video_path?: string;
  media_id?: string;
  prompt_snapshot?: string;
  changed_variable?: string;
  seed: 'same' | 'new' | 'unknown';
  verdict: TakeVerdict | 'pending';
  evidence?: string;
  created_at: string;
  reviewed_at?: string;
}

export interface TakeReviewInput {
  state: SeedanceProjectStateLite;
  clipId: string;
  verdict: TakeVerdict;
  evidence?: string;
  videoPath?: string;
  mediaId?: string;
  observation?: Partial<HandoffObservation>;
  /** If keep/accept: mark clip accepted */
  acceptAsCanon?: boolean;
}

export interface TakeReviewResult {
  state: SeedanceProjectStateLite;
  take: TakeRecord;
  clip: SeedanceClipContract;
  nextClipId: string | null;
  sequenceRelation: SeedanceSequenceRelation;
  message: string;
}

function nowIso() {
  return new Date().toISOString();
}

function bumpRevision(state: SeedanceProjectStateLite): SeedanceProjectStateLite {
  return {
    ...state,
    state_revision: (state.state_revision || 1) + 1,
    updated_at: nowIso(),
  };
}

/**
 * Map retake protocol verdict → clip status + whether canon advances.
 */
export function verdictToClipStatus(
  verdict: TakeVerdict,
  acceptAsCanon?: boolean,
): { status: SeedanceClipStatus; advanceCanon: boolean } {
  switch (verdict) {
    case 'keep':
      return {
        status: acceptAsCanon === false ? 'reviewed' : 'accepted',
        advanceCanon: acceptAsCanon !== false,
      };
    case 'fix_in_post':
      return { status: 'accepted_with_deviation', advanceCanon: true };
    case 'edit':
      return { status: 'repair', advanceCanon: false };
    case 're_roll':
      return { status: 'generated', advanceCanon: false };
    case 'rewrite':
      return { status: 'repair', advanceCanon: false };
    default:
      return { status: 'reviewed', advanceCanon: false };
  }
}

/** Append take log line (retake protocol shot log). */
export function appendTakeLog(
  state: SeedanceProjectStateLite,
  take: TakeRecord,
): SeedanceProjectStateLite {
  const history = Array.isArray(state.take_history) ? [...state.take_history] : [];
  history.push(take);
  return bumpRevision({ ...state, take_history: history });
}

/**
 * Review a generated take and update sequence canon.
 */
export function reviewTake(input: TakeReviewInput): TakeReviewResult {
  let state = { ...input.state };
  const clips = state.clips.map((c) => ({ ...c }));
  const idx = clips.findIndex((c) => c.clip_id === input.clipId);
  if (idx < 0) {
    throw new Error(`Clip not found: ${input.clipId}`);
  }

  const clip = { ...clips[idx] };
  const priorTakes = (state.take_history as TakeRecord[]).filter(
    (t) => t && (t as TakeRecord).clip_id === input.clipId,
  );
  const take: TakeRecord = {
    take_id: `${input.clipId}_t${priorTakes.length + 1}`,
    clip_id: input.clipId,
    take_index: priorTakes.length + 1,
    video_path: input.videoPath,
    media_id: input.mediaId,
    seed: 'unknown',
    verdict: input.verdict,
    evidence: input.evidence,
    created_at: nowIso(),
    reviewed_at: nowIso(),
  };

  const { status, advanceCanon } = verdictToClipStatus(
    input.verdict,
    input.acceptAsCanon,
  );
  clip.status = status;

  if (advanceCanon && input.observation?.observed_end_state) {
    clip.planned_end_state = {
      ...clip.planned_end_state,
      observed: true,
      description: input.observation.observed_end_state,
    };
  }
  if (advanceCanon && input.observation?.observed_start_state) {
    clip.planned_start_state = {
      ...clip.planned_start_state,
      observed: true,
      description: input.observation.observed_start_state,
    };
  }

  // Mark beat completed when accepted
  const beats = state.beats.map((b) => {
    if (b.assigned_clip_id === input.clipId && advanceCanon) {
      return { ...b, status: 'completed' as const };
    }
    return b;
  });

  clips[idx] = clip;
  state = appendTakeLog(
    {
      ...state,
      clips,
      beats,
      current_clip_id: advanceCanon
        ? nextClipIdAfter(clips, input.clipId) || input.clipId
        : input.clipId,
      canon_revision: advanceCanon
        ? state.canon_revision + 1
        : state.canon_revision,
    },
    take,
  );

  const nextId = nextClipIdAfter(state.clips, input.clipId);
  const relation: SeedanceSequenceRelation = advanceCanon
    ? nextId
      ? sameScene(state, input.clipId, nextId)
        ? 'seamless_continuation'
        : 'intentional_next_shot'
      : 'standalone'
    : input.verdict === 'rewrite'
      ? 'repair_tail'
      : 'standalone';

  const messages: Record<TakeVerdict, string> = {
    keep: 'Đã chấp nhận take — quan sát end-state trở thành canon.',
    fix_in_post: 'Accept with deviation — mang sang post; sequence có thể tiến.',
    edit: 'Giữ footage, chỉ sửa layer (edit) — chưa advance sequence.',
    re_roll: 'Re-roll: giữ prompt, đổi seed — chưa advance.',
    rewrite: 'Rewrite: đổi 1 biến trong prompt — chưa advance.',
  };

  return {
    state,
    take,
    clip,
    nextClipId: advanceCanon ? nextId : null,
    sequenceRelation: relation,
    message: messages[input.verdict],
  };
}

function nextClipIdAfter(
  clips: SeedanceClipContract[],
  clipId: string,
): string | null {
  const sorted = [...clips].sort((a, b) => a.sequence_index - b.sequence_index);
  const i = sorted.findIndex((c) => c.clip_id === clipId);
  if (i < 0 || i >= sorted.length - 1) return null;
  return sorted[i + 1].clip_id;
}

function sameScene(
  state: SeedanceProjectStateLite,
  a: string,
  b: string,
): boolean {
  const ca = state.clips.find((c) => c.clip_id === a);
  const cb = state.clips.find((c) => c.clip_id === b);
  return Boolean(ca && cb && ca.scene_id === cb.scene_id);
}

/**
 * Build continuation prompt for next clip after accepted parent.
 * Source gate: requires parent accepted / accepted_with_deviation.
 */
export function buildContinuationPrompt(input: {
  state: SeedanceProjectStateLite;
  parentClipId: string;
  nextClipId?: string | null;
  styleHint?: string;
  characterHints?: string[];
  durationSec?: number;
  secondsPerBeat?: number;
  observation?: Partial<HandoffObservation>;
}): {
  parent: SeedanceClipContract;
  next: SeedanceClipContract;
  directed: SeedanceCompileResult;
  promptSpec: ReturnType<typeof buildPromptSpec>;
  sequenceRelation: SeedanceSequenceRelation;
  handoff: HandoffObservation;
} {
  const parent = input.state.clips.find((c) => c.clip_id === input.parentClipId);
  if (!parent) throw new Error(`Parent clip missing: ${input.parentClipId}`);

  if (
    parent.status !== 'accepted' &&
    parent.status !== 'accepted_with_deviation'
  ) {
    throw new Error(
      `Source gate: parent ${parent.clip_id} chưa accepted (status=${parent.status}). Review take trước khi continue.`,
    );
  }

  const nextId =
    input.nextClipId || nextClipIdAfter(input.state.clips, input.parentClipId);
  let next = nextId
    ? input.state.clips.find((c) => c.clip_id === nextId)
    : undefined;

  if (!next) {
    // Synthesize intentional next shot from reserved beats
    const reserved = parent.reserved_for_later[0] || 'next dramatic beat';
    next = buildClipContract({
      projectId: input.state.project_id,
      chapterNum: parent.chapter_num || input.state.chapter_num || 1,
      sceneIndex: (parent.scene_index ?? 0) + 1,
      promptIndex: 0,
      sceneText: reserved,
      durationSec: (() => {
        const d =
          Number(input.durationSec) > 0
            ? Number(input.durationSec)
            : Number(parent.target_duration_sec) > 0
              ? Number(parent.target_duration_sec)
              : 0;
        if (!d) {
          throw new Error(
            'Thieu durationSec cho continuation clip. App khong tu gan 6s.',
          );
        }
        return d;
      })(),
      secondsPerBeat: input.secondsPerBeat || input.state.seconds_per_beat,
      hasStartImage: true,
      parentClipId: parent.clip_id,
      sequenceIndex: parent.sequence_index + 1,
      alreadyHappened: [
        ...parent.already_happened,
        ...parent.this_clip_only,
      ],
      reservedLater: parent.reserved_for_later.slice(1),
    });
  }

  const relation: SeedanceSequenceRelation =
    parent.scene_id === next.scene_id
      ? 'seamless_continuation'
      : 'intentional_next_shot';

  const obs: HandoffObservation = {
    observed_start_state:
      input.observation?.observed_start_state ||
      String(
        (parent.planned_end_state as { description?: string })?.description ||
          'from accepted parent end frame',
      ),
    observed_end_state:
      input.observation?.observed_end_state ||
      next.this_clip_only[0] ||
      next.narrative_job,
    open_motion_vector: input.observation?.open_motion_vector || 'unknown',
    camera_phase: input.observation?.camera_phase || 'unknown',
    audio_phase: input.observation?.audio_phase || 'sparse ambient continue',
    observation_confidence: input.observation?.observation_confidence || 'medium',
    uncertainties: input.observation?.uncertainties || [
      'open motion at cut',
      'camera phase',
      'audio phase',
    ],
  };

  const exclusions = [
    ...parent.already_happened,
    ...parent.this_clip_only,
  ]
    .filter(Boolean)
    .slice(0, 8);

  const reserved = (next.reserved_for_later || []).slice(0, 6);

  const sceneText = [
    `Continue from accepted parent ${parent.clip_id}.`,
    `Begin with observed end: ${obs.observed_start_state}.`,
    `This clip only: ${next.this_clip_only.join('; ') || next.narrative_job}.`,
    `Felt intent: ${next.felt_intent}.`,
    exclusions.length
      ? `Do not replay completed: ${exclusions.join(' | ')}.`
      : '',
    reserved.length
      ? `Do not yet: ${reserved.join(' | ')}.`
      : '',
    `Stop when: ${String((next.planned_end_state as { description?: string })?.description || 'beat complete')}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const contDur =
    Number(input.durationSec) > 0
      ? Number(input.durationSec)
      : Number(next.target_duration_sec) > 0
        ? Number(next.target_duration_sec)
        : 0;
  if (!contDur) {
    throw new Error(
      'Thieu durationSec cho compileSeedance continuation. App khong tu gan 6s.',
    );
  }
  const styleHint = String(
    input.styleHint || input.state.story.tone || '',
  ).trim();
  if (!styleHint) {
    throw new Error(
      'Thieu styleHint/tone cho continuation. Cau hinh Visual DNA. App khong tu gan the loai mac dinh.',
    );
  }
  const directed = compileSeedancePrompt({
    sceneText,
    characterHints: input.characterHints,
    styleHint,
    hasStartImage: true,
    durationSec: contDur,
    secondsPerBeat: input.secondsPerBeat || input.state.seconds_per_beat,
  });

  const promptSpec = buildPromptSpec({
    contract: { ...next, parent_clip_id: parent.clip_id },
    naturalLanguagePrompt: directed.prompt,
    sequenceRelation: relation,
    shotCount: directed.shotCount,
    referenceRoles: input.state.reference_registry.map((r) => ({
      tag: r.tag,
      role: r.role,
    })),
  });

  return {
    parent,
    next: { ...next, parent_clip_id: parent.clip_id },
    directed,
    promptSpec,
    sequenceRelation: relation,
    handoff: obs,
  };
}

/** Record that a generation started / finished without full review yet */
export function markClipGenerated(
  state: SeedanceProjectStateLite,
  clipId: string,
  extra?: { videoPath?: string; mediaId?: string; prompt?: string },
): SeedanceProjectStateLite {
  const clips = state.clips.map((c) =>
    c.clip_id === clipId ? { ...c, status: 'generated' as const } : c,
  );
  const prior = (state.take_history as TakeRecord[]).filter(
    (t) => t?.clip_id === clipId,
  );
  const take: TakeRecord = {
    take_id: `${clipId}_t${prior.length + 1}`,
    clip_id: clipId,
    take_index: prior.length + 1,
    video_path: extra?.videoPath,
    media_id: extra?.mediaId,
    prompt_snapshot: extra?.prompt?.slice(0, 500),
    seed: 'unknown',
    verdict: 'pending',
    created_at: nowIso(),
  };
  return appendTakeLog({ ...state, clips, current_clip_id: clipId }, take);
}

/**
 * Provisional accept after a successful generate-video so the next shot can use
 * continuation handoff. Not a creative QC substitute — evidence is tagged auto.
 */
export function autoAcceptGeneratedTake(
  state: SeedanceProjectStateLite,
  clipId: string,
  opts?: {
    videoPath?: string;
    mediaId?: string;
    observedEndState?: string;
    observedStartState?: string;
  },
): TakeReviewResult {
  return reviewTake({
    state,
    clipId,
    verdict: 'keep',
    acceptAsCanon: true,
    videoPath: opts?.videoPath,
    mediaId: opts?.mediaId,
    evidence: 'auto-accept after successful generate-video (provisional canon for continuity)',
    observation: {
      observed_start_state:
        opts?.observedStartState ||
        'start of accepted take (auto)',
      observed_end_state:
        opts?.observedEndState ||
        'end frame of accepted take (auto — refine via take review if needed)',
      observation_confidence: 'low',
      uncertainties: ['auto-accept without human/watch review'],
    },
  });
}

/**
 * Promote prior shot in the same scene from `generated` → accepted so
 * buildContinuationPrompt source-gate can fire for the current promptIndex.
 */
export function promotePreviousShotForContinuation(
  state: SeedanceProjectStateLite,
  sceneIndex: number,
  promptIndex: number,
): { state: SeedanceProjectStateLite; promoted: string | null } {
  if (promptIndex <= 0) return { state, promoted: null };
  const parent = state.clips.find(
    (c) =>
      c.scene_index === sceneIndex && (c.prompt_index ?? 0) === promptIndex - 1,
  );
  if (!parent) return { state, promoted: null };
  if (
    parent.status === 'accepted' ||
    parent.status === 'accepted_with_deviation'
  ) {
    return { state, promoted: null };
  }
  if (parent.status !== 'generated' && parent.status !== 'reviewed') {
    return { state, promoted: null };
  }
  type TakeHist = { clip_id?: string; video_path?: string; media_id?: string };
  const lastTake = [...(state.take_history || [])]
    .reverse()
    .find((t) => (t as TakeHist | undefined)?.clip_id === parent.clip_id) as
    | TakeHist
    | undefined;
  const result = autoAcceptGeneratedTake(state, parent.clip_id, {
    videoPath: lastTake?.video_path,
    mediaId: lastTake?.media_id,
    observedEndState: String(
      (parent.planned_end_state as { description?: string })?.description ||
        parent.this_clip_only?.[0] ||
        parent.narrative_job ||
        '',
    ),
  });
  return { state: result.state, promoted: parent.clip_id };
}
