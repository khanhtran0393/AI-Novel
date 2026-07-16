/**
 * Sequence project-state lite — maps AI Novel chapter/scenes → Seedance project state
 * (schemas/project-state.schema.json + clip-contract.schema.json subset).
 */
import type {
  SeedanceBeat,
  SeedanceClipContract,
  SeedanceProjectStateLite,
  SeedancePromptSpec,
  SeedanceScenePlan,
  SeedanceSequenceRelation,
} from './seedanceTypes';
import { planMultishot } from './seedanceMultishot';

function arcForIndex(i: number, total: number): SeedanceScenePlan['arc_position'] {
  if (total <= 1) return 'open';
  const t = i / Math.max(1, total - 1);
  if (t < 0.15) return 'open';
  if (t < 0.45) return 'rising';
  if (t < 0.7) return 'turn';
  if (t < 0.9) return 'climax';
  return 'release';
}

export function buildProjectStateFromChapter(input: {
  projectId?: string;
  title: string;
  chapterNum: number;
  logline?: string;
  lorebook?: string;
  scenes: Array<{ index: number; text: string; title?: string }>;
  styleHint?: string;
  secondsPerBeat?: number;
  clipBudgetSec?: number;
}): SeedanceProjectStateLite {
  const project_id =
    input.projectId ||
    `ainovel_ch${input.chapterNum}_${Date.now().toString(36)}`;
  const scenesIn = input.scenes.filter((s) => (s.text || '').trim());
  const project_mode =
    scenesIn.length > 1 ? 'sequence_project' : 'standalone_clip';

  const scenes: SeedanceScenePlan[] = [];
  const beats: SeedanceBeat[] = [];
  const clips: SeedanceClipContract[] = [];

  let prevClipId: string | null = null;
  scenesIn.forEach((sc, i) => {
    const scene_id = `ch${input.chapterNum}_sc${sc.index}`;
    const clip_id = `${scene_id}_clip01`;
    const excerpt = (sc.text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    const beat_id = `${scene_id}_beat01`;

    scenes.push({
      scene_id,
      scene_index: i + 1,
      narrative_function: sc.title || `Scene ${sc.index + 1}`,
      arc_position: arcForIndex(i, scenesIn.length),
      location: 'as established in chapter lore',
      time_of_day: 'story-internal',
      anchor_source: [],
      max_chain_depth: 2,
      audio_plan: 'TTS bed + sparse ambience; no wall-to-wall score',
      assigned_clip_ids: [clip_id],
      transition_out: i < scenesIn.length - 1 ? 'cut_to_next_scene' : 'hold_end',
      status: i === 0 ? 'current' : 'planned',
      script_excerpt: excerpt,
    });

    beats.push({
      beat_id,
      description: excerpt || 'visible dramatic beat',
      narrative_function: 'this_clip_only',
      status: i === 0 ? 'current' : 'planned',
      assigned_clip_id: clip_id,
      dependencies: prevClipId ? [`${scenesIn[i - 1]?.index}_done`] : [],
    });

    const already = scenesIn
      .slice(0, i)
      .map((p) => (p.text || '').slice(0, 80).trim())
      .filter(Boolean);
    const reserved = scenesIn
      .slice(i + 1)
      .map((p) => (p.text || '').slice(0, 80).trim())
      .filter(Boolean);

    const clipDur =
      Number(input.clipBudgetSec) > 0
        ? Number(input.clipBudgetSec)
        : Number(input.secondsPerBeat) > 0
          ? Number(input.secondsPerBeat)
          : 0;
    if (!clipDur) {
      throw new Error(
        'Thieu clipBudgetSec/secondsPerBeat cho Seedance project. App khong tu gan 6s.',
      );
    }
    const multishot = planMultishot({
      durationSec: clipDur,
      secondsPerBeat: input.secondsPerBeat,
    });

    clips.push({
      project_id,
      clip_id,
      parent_clip_id: prevClipId,
      scene_id,
      sequence_index: i + 1,
      narrative_job: excerpt || 'deliver one visible beat',
      felt_intent: 'make the audience feel the beat through camera, light, and body — not adjectives',
      target_duration_sec: clipDur,
      generation_mode: 'I2V',
      shot_structure: multishot.shotStructure,
      already_happened: already,
      this_clip_only: [excerpt || 'current beat'],
      reserved_for_later: reserved,
      planned_start_state: {
        description: already[already.length - 1] || 'chapter open state',
      },
      planned_end_state: {
        description: `Endpoint after: ${excerpt.slice(0, 120)}`,
      },
      continuity_locks: [
        'character identity locks',
        'wardrobe signature',
        'visual DNA style',
      ],
      allowed_changes: ['camera move', 'expression', 'minor blocking'],
      status: i === 0 ? 'ready' : 'planned',
      chapter_num: input.chapterNum,
      scene_index: sc.index,
      prompt_index: 0,
    });

    prevClipId = clip_id;
  });

  const current = clips[0]?.clip_id || '';
  return {
    schema_version: 'seedance-2.0-lite/1',
    state_revision: 1,
    project_id,
    project_mode,
    surface: {
      name: 'ainovel-video-bridge',
      notes:
        'Prompt compiler only — generation via Flow/Luma/etc. Not a Seedance API surface.',
    },
    clip_budget_sec: input.clipBudgetSec ?? null,
    prompt_budget: 900,
    story: {
      logline: input.logline || input.title || 'AI Novel chapter',
      story_promise: input.title || '',
      objective: 'Deliver chapter scenes as directed video prompts',
      initial_condition: scenesIn[0]?.text?.slice(0, 120) || '',
      final_outcome: scenesIn[scenesIn.length - 1]?.text?.slice(0, 120) || '',
      target_duration_sec: input.clipBudgetSec
        ? input.clipBudgetSec * Math.max(1, scenesIn.length)
        : null,
      tone: input.styleHint || '',
      medium: 'ai-novel-storyboard-video',
    },
    world_bible: {
      lorebook_excerpt: (input.lorebook || '').slice(0, 2000),
      style: input.styleHint || '',
    },
    reference_registry: [],
    scenes,
    beats,
    clips,
    take_history: [],
    current_clip_id: current,
    canon_revision: 1,
    updated_at: new Date().toISOString(),
    chapter_num: input.chapterNum,
    seconds_per_beat: input.secondsPerBeat,
    source: 'seedance-bridge-v2',
  };
}

export function buildClipContract(input: {
  projectId: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex?: number;
  sceneText: string;
  durationSec?: number;
  secondsPerBeat?: number;
  hasStartImage?: boolean;
  parentClipId?: string | null;
  sequenceIndex?: number;
  alreadyHappened?: string[];
  reservedLater?: string[];
}): SeedanceClipContract {
  const scene_id = `ch${input.chapterNum}_sc${input.sceneIndex}`;
  const pIdx = input.promptIndex ?? 0;
  const clip_id = `${scene_id}_p${pIdx}`;
  const excerpt = (input.sceneText || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const clipDur =
    Number(input.durationSec) > 0
      ? Number(input.durationSec)
      : Number(input.secondsPerBeat) > 0
        ? Number(input.secondsPerBeat)
        : 0;
  if (!clipDur) {
    throw new Error(
      'Thieu durationSec/secondsPerBeat cho buildClipContract. App khong tu gan 6s.',
    );
  }
  const plan = planMultishot({
    durationSec: clipDur,
    secondsPerBeat: input.secondsPerBeat,
  });
  return {
    project_id: input.projectId,
    clip_id,
    parent_clip_id: input.parentClipId ?? null,
    scene_id,
    sequence_index: input.sequenceIndex ?? pIdx + 1,
    narrative_job: excerpt || 'one visible beat',
    felt_intent:
      'one intention: camera, light, and performance serve the same dramatic job',
    target_duration_sec: clipDur,
    generation_mode: input.hasStartImage ? 'I2V' : 'T2V',
    shot_structure: plan.shotStructure,
    already_happened: input.alreadyHappened || [],
    this_clip_only: [excerpt],
    reserved_for_later: input.reservedLater || [],
    planned_start_state: { description: 'from prior clip or still frame' },
    planned_end_state: { description: `Stop when: ${excerpt.slice(0, 100)}` },
    continuity_locks: ['face lock', 'wardrobe', 'visual DNA'],
    allowed_changes: ['micro expression', 'camera endpoint'],
    status: 'ready',
    chapter_num: input.chapterNum,
    scene_index: input.sceneIndex,
    prompt_index: pIdx,
  };
}

export function buildPromptSpec(input: {
  contract: SeedanceClipContract;
  naturalLanguagePrompt: string;
  sequenceRelation?: SeedanceSequenceRelation;
  referenceRoles?: Array<{ tag: string; role: string }>;
  shotCount?: number;
}): SeedancePromptSpec {
  const c = input.contract;
  return {
    project_id: c.project_id,
    clip_id: c.clip_id,
    prompt_version: 'v2',
    sequence_relation:
      input.sequenceRelation ||
      (c.parent_clip_id ? 'seamless_continuation' : 'sequence_first_clip'),
    generation_mode: c.generation_mode,
    reference_roles: input.referenceRoles || [],
    opening_state_source: c.parent_clip_id
      ? 'observed_end_state'
      : 'planned_start_state',
    current_clip_action: c.narrative_job,
    endpoint: String(
      (c.planned_end_state as { description?: string })?.description ||
        'complete the beat',
    ),
    completed_beat_exclusions: c.already_happened,
    reserved_future_exclusions: c.reserved_for_later,
    natural_language_prompt: input.naturalLanguagePrompt,
    felt_intent: c.felt_intent,
    shot_structure: c.shot_structure,
    shot_count: input.shotCount,
  };
}
