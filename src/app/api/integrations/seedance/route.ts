import { NextRequest, NextResponse } from 'next/server';
import {
  compileSeedanceBatch,
  compileSeedancePrompt,
  compileDirectedClip,
  persistSeedanceCompile,
  seedanceRepoReady,
  loadSeedanceReference,
  buildProjectStateFromChapter,
  buildClipContract,
  buildPromptSpec,
  planMultishot,
} from '@/lib/integrations/seedance';
import { getIntegrationPaths } from '@/lib/integrations/paths';
import {
  ensureSeedanceProject,
  loadSeedanceProject,
  saveSeedanceProject,
  listSeedanceProjects,
} from '@/lib/integrations/seedancePersist';
import {
  reviewTake,
  buildContinuationPrompt,
  markClipGenerated,
  type TakeVerdict,
} from '@/lib/integrations/seedanceTakeReview';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'integrations_pipeline');
  if (denied) return denied;
  const paths = getIntegrationPaths();
  return NextResponse.json({
    success: true,
    ready: seedanceRepoReady(),
    bridge: 'seedance-bridge-v2',
    repoPath: paths.seedance,
    workPath: paths.seedanceWork,
    projects: listSeedanceProjects(),
    capabilities: [
      'compile_prompt',
      'compile_batch',
      'compile_directed_clip',
      'project_state',
      'ensure_project',
      'clip_contract',
      'prompt_spec',
      'multishot_plan',
      'review_take',
      'continue',
      'mark_generated',
    ],
    directingSnippet: loadSeedanceReference('references/directing-engine.md', 1200),
    multishotSnippet: loadSeedanceReference('references/multishot-grammar.md', 800),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'integrations_pipeline', body);
    if (denied) return denied;
    const persist = Boolean(body.persist);
    const action = String(body.action || 'compile').trim();
    const projectSlug =
      typeof body.projectSlug === 'string'
        ? body.projectSlug
        : typeof body.title === 'string'
          ? body.title
          : undefined;

    // --- List disk projects ---
    if (action === 'list_projects') {
      return NextResponse.json({
        success: true,
        projects: listSeedanceProjects(),
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Load saved project for chapter ---
    if (action === 'load_project') {
      const chapterNum = Number(body.chapterNum) || 1;
      const state = loadSeedanceProject(chapterNum, projectSlug);
      return NextResponse.json({
        success: true,
        state,
        found: Boolean(state),
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Ensure / rebuild project from scenes ---
    if (action === 'ensure_project') {
      const chapterNum = Number(body.chapterNum) || 1;
      const scenes = Array.isArray(body.scenes) ? body.scenes : [];
      const result = ensureSeedanceProject({
        chapterNum,
        title: body.title || body.ten_tac_pham || 'AI Novel',
        scenes: scenes.map(
          (
            s: { index?: number; sceneIndex?: number; text?: string; title?: string },
            i: number,
          ) => ({
            index: Number(s.index ?? s.sceneIndex ?? i),
            text: s.text || '',
            title: s.title,
          }),
        ),
        lorebook: body.lorebook,
        styleHint: body.styleHint,
        secondsPerBeat: body.secondsPerBeat,
        videoDuration: body.videoDuration ?? body.clipBudgetSec,
        projectSlug,
        forceRebuild: Boolean(body.forceRebuild),
      });
      return NextResponse.json({
        success: true,
        ...result,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Save project state blob ---
    if (action === 'save_project') {
      if (!body.state?.project_id) {
        return NextResponse.json(
          { success: false, error: 'Missing state.project_id' },
          { status: 400 },
        );
      }
      const pathSaved = saveSeedanceProject(body.state, projectSlug);
      return NextResponse.json({
        success: true,
        path: pathSaved,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Project state (ephemeral build, optional persist) ---
    if (action === 'project_state' || action === 'sequence') {
      const scenes = Array.isArray(body.scenes) ? body.scenes : [];
      const state = buildProjectStateFromChapter({
        projectId: body.projectId,
        title: body.title || body.ten_tac_pham || 'AI Novel',
        chapterNum: Number(body.chapterNum) || 1,
        logline: body.logline,
        lorebook: body.lorebook,
        scenes: scenes.map(
          (
            s: { index?: number; sceneIndex?: number; text?: string; title?: string },
            i: number,
          ) => ({
            index: Number(s.index ?? s.sceneIndex ?? i),
            text: s.text || '',
            title: s.title,
          }),
        ),
        styleHint: body.styleHint,
        secondsPerBeat: body.secondsPerBeat,
        clipBudgetSec: body.clipBudgetSec ?? body.videoDuration,
      });
      const savedPath = persist
        ? saveSeedanceProject(state, projectSlug)
        : undefined;
      return NextResponse.json({
        success: true,
        state,
        savedPath,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Review take (retake protocol) ---
    if (action === 'review_take') {
      const chapterNum = Number(body.chapterNum) || 1;
      let state =
        body.state || loadSeedanceProject(chapterNum, projectSlug);
      if (!state) {
        return NextResponse.json(
          { success: false, error: 'No project state — call ensure_project first' },
          { status: 400 },
        );
      }
      const verdict = String(body.verdict || 'keep') as TakeVerdict;
      const result = reviewTake({
        state,
        clipId: String(body.clipId || state.current_clip_id),
        verdict,
        evidence: body.evidence,
        videoPath: body.videoPath,
        mediaId: body.mediaId,
        observation: body.observation,
        acceptAsCanon: body.acceptAsCanon,
      });
      const pathSaved = saveSeedanceProject(result.state, projectSlug);
      return NextResponse.json({
        success: true,
        ...result,
        path: pathSaved,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Mark clip generated (after video API success) ---
    if (action === 'mark_generated') {
      const chapterNum = Number(body.chapterNum) || 1;
      let state =
        body.state || loadSeedanceProject(chapterNum, projectSlug);
      if (!state) {
        return NextResponse.json(
          { success: false, error: 'No project state' },
          { status: 400 },
        );
      }
      const clipId = String(body.clipId || state.current_clip_id);
      state = markClipGenerated(state, clipId, {
        videoPath: body.videoPath,
        mediaId: body.mediaId,
        prompt: body.prompt,
      });
      const pathSaved = saveSeedanceProject(state, projectSlug);
      return NextResponse.json({
        success: true,
        state,
        path: pathSaved,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Continuation handoff ---
    if (action === 'continue' || action === 'continuation') {
      const chapterNum = Number(body.chapterNum) || 1;
      const state = (body.state ||
        loadSeedanceProject(chapterNum, projectSlug)) as
        | import('@/lib/integrations/seedanceTypes').SeedanceProjectStateLite
        | null;
      if (!state) {
        return NextResponse.json(
          { success: false, error: 'No project state' },
          { status: 400 },
        );
      }
      const pack = buildContinuationPrompt({
        state,
        parentClipId: String(body.parentClipId || state.current_clip_id),
        nextClipId: body.nextClipId,
        styleHint: body.styleHint,
        characterHints: body.characterHints,
        durationSec: body.durationSec ?? body.duration,
        secondsPerBeat: body.secondsPerBeat || state.seconds_per_beat,
        observation: body.observation,
      });
      // Advance current pointer to next if present in state
      if (
        pack.next &&
        state.clips.some((c: { clip_id: string }) => c.clip_id === pack.next.clip_id)
      ) {
        const nextState = {
          ...state,
          current_clip_id: pack.next.clip_id,
          updated_at: new Date().toISOString(),
        };
        if (persist !== false) saveSeedanceProject(nextState, projectSlug);
      }
      return NextResponse.json({
        success: true,
        ...pack,
        prompt: pack.directed.prompt,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Clip contract only ---
    if (action === 'clip_contract') {
      const contract = buildClipContract({
        projectId: body.projectId || `ainovel_${Date.now().toString(36)}`,
        chapterNum: Number(body.chapterNum) || 1,
        sceneIndex: Number(body.sceneIndex) || 0,
        promptIndex: Number(body.promptIndex) || 0,
        sceneText: String(body.sceneText || body.text || ''),
        durationSec: body.durationSec ?? body.duration,
        secondsPerBeat: body.secondsPerBeat,
        hasStartImage: Boolean(body.hasStartImage || body.startImage),
        parentClipId: body.parentClipId ?? null,
        alreadyHappened: body.alreadyHappened,
        reservedLater: body.reservedLater,
      });
      return NextResponse.json({ success: true, contract, repoReady: seedanceRepoReady() });
    }

    // --- Multishot plan only ---
    if (action === 'multishot_plan') {
      const plan = planMultishot({
        durationSec: Number(body.durationSec ?? body.duration) || 6,
        secondsPerBeat: body.secondsPerBeat,
      });
      return NextResponse.json({ success: true, plan, repoReady: seedanceRepoReady() });
    }

    // --- Full directed clip ---
    if (action === 'compile_clip' || action === 'directed_clip') {
      const sceneText = String(body.sceneText || body.text || body.prompt || '').trim();
      if (!sceneText) {
        return NextResponse.json({ success: false, error: 'Missing sceneText' }, { status: 400 });
      }
      const pack = compileDirectedClip({
        projectId: body.projectId,
        chapterNum: Number(body.chapterNum) || 1,
        sceneIndex: Number(body.sceneIndex) || 0,
        promptIndex: Number(body.promptIndex) || 0,
        sceneText,
        videoPrompt: body.videoPrompt,
        characterHints: body.characterHints || body.characters,
        environmentHint: body.environmentHint,
        styleHint: body.styleHint,
        genre: body.genre,
        durationSec: body.durationSec ?? body.duration,
        secondsPerBeat: body.secondsPerBeat,
        hasStartImage: Boolean(body.hasStartImage || body.startImage),
        hasEndImage: Boolean(body.hasEndImage || body.endImage),
        parentClipId: body.parentClipId,
        alreadyHappened: body.alreadyHappened,
        reservedLater: body.reservedLater,
      });
      const savedPath = persist
        ? persistSeedanceCompile(pack, `clip_${pack.contract.clip_id}`)
        : undefined;
      return NextResponse.json({
        success: true,
        ...pack,
        savedPath,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Batch scenes ---
    if (Array.isArray(body.scenes) && (action === 'compile' || action === 'batch')) {
      const batch = compileSeedanceBatch(
        body.scenes.map(
          (s: {
            id?: string;
            text?: string;
            sceneText?: string;
            characters?: string[];
            environment?: string;
            hasStartImage?: boolean;
            durationSec?: number;
          }, i: number) => ({
            id: s.id || `scene_${i + 1}`,
            text: s.text || s.sceneText || '',
            characters: s.characters,
            environment: s.environment,
            hasStartImage: s.hasStartImage,
            durationSec: s.durationSec,
          }),
        ),
        { styleHint: body.styleHint, genre: body.genre },
      );
      const savedPath = persist ? persistSeedanceCompile(batch, 'batch') : undefined;
      return NextResponse.json({
        success: true,
        results: batch,
        savedPath,
        repoReady: seedanceRepoReady(),
      });
    }

    // --- Default: single compile ---
    const sceneText = String(body.sceneText || body.text || body.prompt || '').trim();
    if (!sceneText) {
      return NextResponse.json({ success: false, error: 'Missing sceneText' }, { status: 400 });
    }

    const result = compileSeedancePrompt({
      sceneText,
      characterHints: body.characterHints || body.characters,
      environmentHint: body.environmentHint || body.environment,
      styleHint: body.styleHint,
      mode: body.mode,
      hasStartImage: Boolean(body.hasStartImage || body.startImage),
      hasEndImage: Boolean(body.hasEndImage || body.endImage),
      durationSec: body.durationSec ?? body.duration,
      genre: body.genre,
      language: body.language,
      secondsPerBeat: body.secondsPerBeat,
      forceMultishot: Boolean(body.forceMultishot),
    });

    let promptSpec = null;
    if (body.withSpec) {
      const contract = buildClipContract({
        projectId: body.projectId || `ainovel_${Date.now().toString(36)}`,
        chapterNum: Number(body.chapterNum) || 1,
        sceneIndex: Number(body.sceneIndex) || 0,
        sceneText,
        durationSec: body.durationSec ?? body.duration,
        secondsPerBeat: body.secondsPerBeat,
        hasStartImage: Boolean(body.hasStartImage || body.startImage),
      });
      promptSpec = buildPromptSpec({
        contract,
        naturalLanguagePrompt: result.prompt,
        shotCount: result.shotCount,
      });
    }

    const savedPath = persist ? persistSeedanceCompile(result, 'single') : undefined;
    return NextResponse.json({
      success: true,
      result,
      promptSpec,
      savedPath,
      repoReady: seedanceRepoReady(),
    });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
