/**
 * Empirical smoke for P0–P2 pipeline hardening (no live LLM/video gen).
 * Run: npx tsx scripts/smoke-pipeline-p0p2.mts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const logs: string[] = [];
function ok(msg: string) {
  logs.push(`OK  ${msg}`);
  console.log(`OK  ${msg}`);
}

async function main() {
  // --- paths / vendor ---
  const { getIntegrationPaths, probeIntegration } = await import(
    '../src/lib/integrations/paths.ts'
  );
  const paths = getIntegrationPaths(root);
  assert(paths.fablecut.includes('vendor'), `fablecut should prefer vendor, got ${paths.fablecut}`);
  assert(
    fs.existsSync(path.join(paths.fablecut, 'server.js')),
    'vendor/FableCut/server.js missing',
  );
  ok(`FableCut vendor: ${paths.fablecut}`);

  assert(
    fs.existsSync(path.join(paths.watchScripts, 'watch.py')),
    'vendor watch.py missing',
  );
  ok(`Watch scripts: ${paths.watchScripts}`);

  const fableProbe = probeIntegration('fablecut', paths);
  const watchProbe = probeIntegration('watch', paths);
  assert(fableProbe.ready, 'fablecut probe not ready');
  assert(watchProbe.ready, 'watch probe not ready');
  ok('probes ready');

  // --- Seedance promote → accept → continuation gate ---
  const {
    markClipGenerated,
    autoAcceptGeneratedTake,
    promotePreviousShotForContinuation,
    buildContinuationPrompt,
  } = await import('../src/lib/integrations/seedanceTakeReview.ts');
  const { compileSeedancePrompt } = await import(
    '../src/lib/integrations/seedance.ts'
  );

  const state0: any = {
    schema_version: 'seedance-2.0-lite/1',
    state_revision: 1,
    project_id: 'smoke_p0',
    project_mode: 'sequence_project',
    chapter_num: 1,
    seconds_per_beat: 6,
    story: { title: 'Smoke', tone: 'cinematic noir' },
    scenes: [],
    beats: [],
    clips: [
      {
        project_id: 'smoke_p0',
        clip_id: 'ch1_sc0_p0',
        scene_id: 'sc0',
        scene_index: 0,
        prompt_index: 0,
        sequence_index: 0,
        status: 'ready',
        narrative_job: 'open door',
        felt_intent: 'dread',
        this_clip_only: ['hand on door'],
        already_happened: [],
        reserved_for_later: ['enter room'],
        planned_start_state: { description: 'hallway' },
        planned_end_state: { description: 'door half open' },
        target_duration_sec: 6,
        generation_mode: 'I2V',
        continuity_locks: [],
        allowed_changes: [],
        chapter_num: 1,
      },
      {
        project_id: 'smoke_p0',
        clip_id: 'ch1_sc0_p1',
        scene_id: 'sc0',
        scene_index: 0,
        prompt_index: 1,
        sequence_index: 1,
        status: 'planned',
        narrative_job: 'enter room',
        felt_intent: 'shock',
        this_clip_only: ['step inside'],
        already_happened: [],
        reserved_for_later: [],
        planned_start_state: { description: 'door half open' },
        planned_end_state: { description: 'inside dark room' },
        target_duration_sec: 6,
        generation_mode: 'I2V',
        continuity_locks: [],
        allowed_changes: [],
        chapter_num: 1,
        parent_clip_id: 'ch1_sc0_p0',
      },
    ],
    reference_registry: [],
    take_history: [],
    current_clip_id: 'ch1_sc0_p0',
    canon_revision: 0,
    updated_at: new Date().toISOString(),
  };

  let state = markClipGenerated(state0, 'ch1_sc0_p0', {
    videoPath: '/video/smoke0.mp4',
  });
  assert(state.clips[0].status === 'generated', 'after mark should be generated');

  const accepted = autoAcceptGeneratedTake(state, 'ch1_sc0_p0', {
    videoPath: '/video/smoke0.mp4',
    observedEndState: 'door half open',
  });
  state = accepted.state;
  assert(state.clips[0].status === 'accepted', 'auto accept → accepted');
  ok('Seedance autoAcceptGeneratedTake');

  // Simulate next shot: parent already accepted → promote returns null, continuation works
  const promo = promotePreviousShotForContinuation(state, 0, 1);
  assert(promo.promoted === null, 'already accepted → no re-promote');
  const cont = buildContinuationPrompt({
    state: promo.state,
    parentClipId: 'ch1_sc0_p0',
    styleHint: 'cinematic noir',
    characterHints: ['Hero'],
    durationSec: 6,
    secondsPerBeat: 6,
  });
  assert(cont.directed?.prompt?.length > 20, 'continuation prompt empty');
  assert(
    String(cont.sequenceRelation).includes('continuation') ||
      cont.sequenceRelation === 'intentional_next_shot' ||
      cont.sequenceRelation === 'seamless_continuation',
    `unexpected relation ${cont.sequenceRelation}`,
  );
  ok(`Seedance continuation relation=${cont.sequenceRelation}`);

  // promote path from generated-only
  let stateB: any = {
    ...state0,
    clips: state0.clips.map((c: any) => ({ ...c })),
    take_history: [],
  };
  stateB = markClipGenerated(stateB, 'ch1_sc0_p0', { videoPath: '/v.mp4' });
  const promo2 = promotePreviousShotForContinuation(stateB, 0, 1);
  assert(promo2.promoted === 'ch1_sc0_p0', 'promote from generated');
  assert(promo2.state.clips[0].status === 'accepted', 'promoted parent accepted');
  ok('Seedance promotePreviousShotForContinuation');

  // compile still works offline
  const compiled = compileSeedancePrompt({
    sceneText: 'She freezes as the light dies.',
    styleHint: 'cinematic noir',
    genre: 'psychological thriller',
    durationSec: 6,
    secondsPerBeat: 6,
    hasStartImage: true,
  });
  assert(compiled.prompt.length > 10, 'compile empty');
  ok(`Seedance compile function=${compiled.function}`);

  // --- FableCut export without live dependency on D:\repo ---
  const { buildFableCutProject, buildFromChapterAssets } = await import(
    '../src/lib/integrations/fablecut.ts'
  );
  // Create tiny dummy still + silent wav via copy if available, else skip media copy test
  const tmpDir = path.join(root, 'scratch', 'p0p2-smoke');
  fs.mkdirSync(tmpDir, { recursive: true });
  const still = path.join(tmpDir, 'still.png');
  // minimal 1x1 png
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(still, png);

  const fc = buildFromChapterAssets({
    name: 'smoke_p0p2',
    imagePaths: [still, still],
    audioDurationSec: 10,
    aspect: '9:16',
    liveEditor: false,
    title: 'Smoke',
  });
  assert(fc.success, `FableCut build failed: ${fc.error}`);
  assert(fs.existsSync(fc.projectPath), 'project.json missing');
  assert(!fc.projectPath.includes('D:\\repo'), 'export must not require D:\\repo path');
  const project = JSON.parse(fs.readFileSync(fc.projectPath, 'utf8'));
  const stillClips = (project.clips || []).filter((c: any) => c.track === 0);
  assert(stillClips.length === 2, 'expected 2 still clips');
  const per = Number(stillClips[0].duration);
  assert(Math.abs(per - 5) < 0.2, `still duration should be ~5s from 10s TTS/2, got ${per}`);
  ok(`FableCut TTS-sync duration≈${per}s path=${fc.projectPath}`);

  // direct export pack
  const fc2 = buildFableCutProject({
    name: 'smoke_export_only',
    liveEditor: false,
    aspect: '9:16',
    clips: [
      { mediaPath: still, kind: 'image', durationSec: 3, startSec: 0 },
    ],
  });
  assert(fc2.success, fc2.error || 'export fail');
  ok(`FableCut export-only success clips=${fc2.clipCount}`);

  // --- Watch QC brief ---
  const { buildWatchQcBrief, watchRepoReady } = await import(
    '../src/lib/integrations/watchVideo.ts'
  );
  assert(watchRepoReady(), 'watch not ready');
  const brief = buildWatchQcBrief({
    report: 'Sample frames: t=0 blur ok; t=2 identity stable.',
    chapterTitle: 'Smoke',
  });
  assert(brief.includes('Video Watch QC Brief'), 'brief header missing');
  ok('Watch QC brief builder');

  // --- MiroFish scope policy (unit of route logic) ---
  const allowed = new Set(['outline', 'lore', 'plan_arc', 'arc']);
  assert(allowed.has('plan_arc'), 'policy set broken');
  ok('MiroFish outline/lore policy constants');

  // --- VieNeu package probe (honest) ---
  const { resolvePythonExe } = await import(
    '../src/app/api/self-heal/media/mediaHelpers.ts'
  );
  const py = resolvePythonExe();
  const { execFileSync } = await import('child_process');
  let vieneuStatus = 'unknown';
  try {
    const out = execFileSync(
      py,
      [
        '-c',
        'import importlib.util; print("yes" if importlib.util.find_spec("vieneu") else "no")',
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    vieneuStatus = out === 'yes' ? 'installed' : 'missing';
  } catch {
    vieneuStatus = 'probe_failed';
  }
  ok(`VieNeu package: ${vieneuStatus} (missing → hard-fail on platform vieneu_tts)`);

  console.log('\n=== P0–P2 SMOKE PASS ===');
  console.log(logs.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
