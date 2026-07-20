/**
 * Auto-wire Seedance sequence into video_prompt generation (no separate UI step).
 * - ensure project-state from chapter scenes when possible
 * - inject already_happened / reserved / felt continuity into each shot's video_prompt
 * - prefer continuation compiler when parent clip is accepted
 */
import type { SeedanceProjectStateLite } from './seedanceTypes';
import {
  ensureSeedanceProject,
  loadSeedanceProject,
  saveSeedanceProject,
} from './seedancePersist';
import { compileDirectedClip } from './seedance';
import {
  buildContinuationPrompt,
  markClipGenerated,
  promotePreviousShotForContinuation,
} from './seedanceTakeReview';

export type SceneBeatInput = {
  index: number;
  text: string;
  title?: string;
};

export type PromptShotInput = {
  sentence?: string;
  script_prompt?: string;
  image_prompt?: string;
  video_prompt?: string;
  prompt?: string;
  emotion?: string;
  timestamp?: string;
};

/**
 * Ensure project-state exists for this chapter (from scene list or single scene text).
 */
export function autoEnsureChapterProject(input: {
  chapterNum: number;
  title?: string;
  lorebook?: string;
  styleHint?: string;
  secondsPerBeat?: number;
  videoDuration?: number;
  scenes?: SceneBeatInput[];
  /** Fallback if no multi-scene list: whole chapter or one scene body */
  fallbackSceneText?: string;
  projectSlug?: string;
}): { state: SeedanceProjectStateLite; path: string; created: boolean } {
  let scenes = (input.scenes || []).filter((s) => (s.text || '').trim());
  if (!scenes.length && input.fallbackSceneText?.trim()) {
    scenes = [{ index: 0, text: input.fallbackSceneText.trim(), title: 'Scene' }];
  }
  if (!scenes.length) {
    scenes = [{ index: 0, text: 'empty scene', title: 'Empty' }];
  }
  return ensureSeedanceProject({
    chapterNum: input.chapterNum,
    title: input.title || `Chapter ${input.chapterNum}`,
    scenes,
    lorebook: input.lorebook,
    styleHint: input.styleHint,
    secondsPerBeat: input.secondsPerBeat,
    videoDuration: input.videoDuration,
    projectSlug: input.projectSlug || input.title,
    forceRebuild: false,
  });
}

/**
 * Rewrite each prompt's video_prompt with Seedance directed + sequence continuity.
 * Call after AI drafts exist (imagePrompt handler final pass).
 */
export function applySequenceToVideoPrompts(input: {
  chapterNum: number;
  sceneIndex: number;
  prompts: PromptShotInput[];
  characterHints?: string[];
  styleHint?: string;
  genre?: string;
  secondsPerBeat?: number;
  durationSecPerShot?: number;
  title?: string;
  lorebook?: string;
  /** All scenes in chapter for project-state (optional) */
  chapterScenes?: SceneBeatInput[];
  sceneText?: string;
  projectSlug?: string;
}): {
  prompts: PromptShotInput[];
  projectId: string;
  clipIds: string[];
  sequenceApplied: boolean;
} {
  const {
    chapterNum,
    sceneIndex,
    prompts,
    characterHints,
    styleHint,
    genre,
    secondsPerBeat,
    durationSecPerShot,
  } = input;

  if (!prompts?.length) {
    return { prompts: prompts || [], projectId: '', clipIds: [], sequenceApplied: false };
  }

  // B10: ensure project hard-fail — no silent "compile only" path
  const ensured = autoEnsureChapterProject({
    chapterNum,
    title: input.title,
    lorebook: input.lorebook,
    styleHint,
    secondsPerBeat,
    videoDuration: durationSecPerShot,
    scenes: input.chapterScenes,
    fallbackSceneText: input.sceneText,
    projectSlug: input.projectSlug || input.title,
  });
  let state: SeedanceProjectStateLite = ensured.state;
  const projectId = state.project_id;
  const clipIds: string[] = [];
  const beatSec = Number(secondsPerBeat) > 0 ? Number(secondsPerBeat) : 6;
  const perShot =
    Number(durationSecPerShot) > 0 ? Number(durationSecPerShot) : beatSec;

  const out = prompts.map((p, i) => {
    const sentence = (p.sentence || p.script_prompt || '').trim();
    const img = (p.image_prompt || p.prompt || '').trim();
    // B10: do not invent video_prompt from image/sentence
    let vid = (p.video_prompt || '').trim();
    if (!img || !vid) {
      throw new Error(
        `Seedance sequence: shot #${i + 1} thieu image_prompt hoac video_prompt. ` +
          `Khong fill ngam — sua AI prompt / gen lai.`,
      );
    }

    const already = prompts
      .slice(0, i)
      .map((x) => (x.sentence || x.script_prompt || '').trim())
      .filter(Boolean);
    const reserved = prompts
      .slice(i + 1)
      .map((x) => (x.sentence || x.script_prompt || '').trim())
      .filter(Boolean);

    try {
      // If previous shot's clip is accepted in project state, try continuation compiler
      let usedContinuation = false;
      if (state && i > 0) {
        const prevClip = state.clips.find(
          (c) =>
            c.scene_index === sceneIndex && (c.prompt_index ?? 0) === i - 1,
        );
        if (
          prevClip &&
          (prevClip.status === 'accepted' ||
            prevClip.status === 'accepted_with_deviation')
        ) {
          try {
            const cont = buildContinuationPrompt({
              state,
              parentClipId: prevClip.clip_id,
              styleHint,
              characterHints,
              durationSec: perShot,
              secondsPerBeat: beatSec,
              observation: {
                observed_start_state: String(
                  (prevClip.planned_end_state as { description?: string })
                    ?.description || already[already.length - 1] || '',
                ),
                observed_end_state: sentence,
                observation_confidence: 'medium',
              },
            });
            vid = cont.directed.prompt;
            clipIds.push(cont.next.clip_id);
            usedContinuation = true;
          } catch {
            /* fall through to directed clip */
          }
        }
      }

      if (!usedContinuation) {
        const pack = compileDirectedClip({
          projectId,
          chapterNum,
          sceneIndex,
          promptIndex: i,
          sceneText: sentence || vid,
          videoPrompt: vid,
          characterHints,
          styleHint,
          genre: (() => {
            const g = String(genre || '').trim();
            if (!g && !String(styleHint || '').trim()) {
              throw new Error(
                'Thieu genre/styleHint cho Seedance sequence. Cau hinh Setup + Visual DNA. App khong tu gan mat the.',
              );
            }
            return g || String(styleHint || '').trim();
          })(),
          durationSec: perShot,
          secondsPerBeat: beatSec,
          hasStartImage: Boolean(img),
          alreadyHappened: already,
          reservedLater: reserved,
        });
        vid = pack.directed.prompt;
        clipIds.push(pack.contract.clip_id);

        // Upsert clip into project state for later mark_generated / review
        if (state) {
          const exists = state.clips.some((c) => c.clip_id === pack.contract.clip_id);
          if (!exists) {
            state = {
              ...state,
              clips: [...state.clips, pack.contract],
              updated_at: new Date().toISOString(),
            };
          } else {
            state = {
              ...state,
              clips: state.clips.map((c) =>
                c.clip_id === pack.contract.clip_id
                  ? {
                      ...c,
                      ...pack.contract,
                      status: c.status === 'accepted' ? c.status : pack.contract.status,
                    }
                  : c,
              ),
              updated_at: new Date().toISOString(),
            };
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Seedance sequence shot #${i + 1} compile failed: ${msg}. Khong giu draft ngam (B10).`,
      );
    }

    return {
      ...p,
      video_prompt: vid,
      image_prompt: img || p.image_prompt,
      prompt: img || p.prompt,
    };
  });

  if (state) {
    try {
      // Point current to first non-accepted clip of this scene
      const pending = state.clips.find(
        (c) =>
          c.scene_index === sceneIndex &&
          c.status !== 'accepted' &&
          c.status !== 'accepted_with_deviation',
      );
      if (pending) state = { ...state, current_clip_id: pending.clip_id };
      saveSeedanceProject(state, input.projectSlug || input.title);
    } catch (e) {
      console.warn('[Seedance auto] save project failed', e);
    }
  }

  return {
    prompts: out,
    projectId,
    clipIds,
    sequenceApplied: true,
  };
}

/**
 * Resolve a single video generation prompt with full sequence awareness.
 * Used by /api/generate-video before provider call.
 * Packaged: directed clip compile via cloud IP when entitlementToken provided / cloud mode.
 */
export async function resolveVideoPromptWithSequence(input: {
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  promptText: string;
  characterHints?: string[];
  environmentHint?: string;
  styleHint?: string;
  genre?: string;
  durationSec?: number;
  secondsPerBeat?: number;
  hasStartImage?: boolean;
  hasEndImage?: boolean;
  title?: string;
  projectSlug?: string;
  /** Prior sentences in same scene (optional continuity) */
  priorSentences?: string[];
  laterSentences?: string[];
  entitlementToken?: string | null;
}): Promise<{
  promptText: string;
  clipId: string;
  projectId: string;
  sequenceRelation: string;
  usedContinuation: boolean;
}> {
  const slug = input.projectSlug || input.title;
  let state = loadSeedanceProject(input.chapterNum, slug);
  if (!state) {
    try {
      const ensured = autoEnsureChapterProject({
        chapterNum: input.chapterNum,
        title: input.title,
        styleHint: input.styleHint,
        secondsPerBeat: input.secondsPerBeat,
        videoDuration: input.durationSec,
        fallbackSceneText: input.promptText,
        projectSlug: slug,
      });
      state = ensured.state;
    } catch {
      state = null;
    }
  }

  const already = input.priorSentences || [];
  const reserved = input.laterSentences || [];

  // Promote previous generated take → accepted so continuation source-gate can fire
  if (state && input.promptIndex > 0) {
    try {
      const promo = promotePreviousShotForContinuation(
        state,
        input.sceneIndex,
        input.promptIndex,
      );
      if (promo.promoted) {
        state = promo.state;
        saveSeedanceProject(state, slug);
        console.log(
          `[Seedance auto] promoted parent ${promo.promoted} for continuation sc=${input.sceneIndex} p=${input.promptIndex}`,
        );
      }
    } catch (e) {
      console.warn('[Seedance auto] promote parent failed', e);
    }
  }

  // Prefer continuation from accepted parent (previous prompt in scene)
  if (state && input.promptIndex > 0) {
    const parent = state.clips.find(
      (c) =>
        c.scene_index === input.sceneIndex &&
        (c.prompt_index ?? 0) === input.promptIndex - 1,
    );
    if (
      parent &&
      (parent.status === 'accepted' || parent.status === 'accepted_with_deviation')
    ) {
      try {
        const cont = buildContinuationPrompt({
          state,
          parentClipId: parent.clip_id,
          styleHint: input.styleHint,
          characterHints: input.characterHints,
          durationSec: input.durationSec,
          secondsPerBeat: input.secondsPerBeat,
          observation: {
            observed_start_state: String(
              (parent.planned_end_state as { description?: string })?.description ||
                already[already.length - 1] ||
                '',
            ),
            observed_end_state: input.promptText.slice(0, 240),
            observation_confidence: 'medium',
          },
        });
        return {
          promptText: cont.directed.prompt,
          clipId: cont.next.clip_id,
          projectId: state.project_id,
          sequenceRelation: cont.sequenceRelation,
          usedContinuation: true,
        };
      } catch (e) {
        console.warn('[Seedance auto] continuation skip', e);
      }
    }
  }

  const { resolveCompileDirectedClip } = await import(
    '@/lib/commercial/ip/seedanceCloudBridge'
  );
  const pack = await resolveCompileDirectedClip(
    {
      projectId: state?.project_id,
      chapterNum: input.chapterNum,
      sceneIndex: input.sceneIndex,
      promptIndex: input.promptIndex,
      sceneText: input.promptText,
      videoPrompt: input.promptText,
      characterHints: input.characterHints,
      environmentHint: input.environmentHint,
      styleHint: input.styleHint,
      genre: input.genre,
      durationSec: input.durationSec,
      secondsPerBeat: input.secondsPerBeat,
      hasStartImage: input.hasStartImage,
      hasEndImage: input.hasEndImage,
      alreadyHappened: already,
      reservedLater: reserved,
    },
    { entitlementToken: input.entitlementToken },
  );

  if (state) {
    try {
      const exists = state.clips.some((c) => c.clip_id === pack.contract.clip_id);
      const clips = exists
        ? state.clips.map((c) =>
            c.clip_id === pack.contract.clip_id ? { ...c, ...pack.contract } : c,
          )
        : [...state.clips, pack.contract];
      saveSeedanceProject(
        {
          ...state,
          clips,
          current_clip_id: pack.contract.clip_id,
          updated_at: new Date().toISOString(),
        },
        slug,
      );
    } catch {
      /* ignore */
    }
  }

  return {
    promptText: pack.directed.prompt,
    clipId: pack.contract.clip_id,
    projectId: pack.projectId,
    sequenceRelation: pack.contract.parent_clip_id
      ? 'seamless_continuation'
      : 'sequence_first_clip',
    usedContinuation: false,
  };
}

export { markClipGenerated };
