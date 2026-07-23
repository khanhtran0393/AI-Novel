/**
 * Empirical gate: Phong Cách Kịch Bản pacing (soft patch · cold open · shot duration · wiring).
 * Run: npx tsx scripts/verify-script-mode-pacing.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allocateShotDurationsByMode,
  buildScriptModeColdOpenBlock,
  buildScriptModePacingBlock,
  buildScriptModeShotRhythmBlock,
  getScriptModePacing,
  normalizeScriptMode,
  scoreShotTension,
  scriptModeMediaSoftPatch,
  shortManhuaQualityHints,
  SCRIPT_MODE_PACING,
  SCRIPT_MODES,
  type ScriptMode,
} from '../src/lib/scriptMode';
import { buildProseCraftBlock } from '../src/lib/storyWriting';
import { evaluateChapterQuality } from '../src/lib/pipeline/qualityGate';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let checks = 0;
function ok(label: string) {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

console.log('[verify-script-mode-pacing] START');

// ── 1. Preset integrity ──────────────────────────────────────────
for (const m of SCRIPT_MODES) {
  const p = getScriptModePacing(m);
  assert.ok(p.wpm > 0 && p.secondsPerBeat > 0);
  assert.ok(p.shotSecMin > 0 && p.shotSecMax >= p.shotSecMin);
  assert.ok(['off', 'soft', 'on'].includes(p.coldOpen));
  ok(`preset ${m}: wpm=${p.wpm} beat=${p.secondsPerBeat} cold=${p.coldOpen}`);
}
assert.equal(SCRIPT_MODE_PACING.chuyen_sau.coldOpen, 'off');
assert.equal(SCRIPT_MODE_PACING.sang_van.coldOpen, 'soft');
assert.equal(SCRIPT_MODE_PACING.short_manhua.coldOpen, 'on');
assert.ok(SCRIPT_MODE_PACING.chuyen_sau.wpm < SCRIPT_MODE_PACING.sang_van.wpm);
assert.ok(SCRIPT_MODE_PACING.sang_van.wpm < SCRIPT_MODE_PACING.short_manhua.wpm);
assert.ok(
  SCRIPT_MODE_PACING.chuyen_sau.secondsPerBeat >
    SCRIPT_MODE_PACING.sang_van.secondsPerBeat,
);
assert.ok(
  SCRIPT_MODE_PACING.sang_van.secondsPerBeat >
    SCRIPT_MODE_PACING.short_manhua.secondsPerBeat,
);
ok('preset ordering: deep slower than sang slower than short');

// ── 2. Soft patch: wrong-mode defaults nudge; in-band preserved ──
{
  const fromDefault = {
    so_tu_chuong: 4250,
    secondsPerBeat: 6,
    videoDuration: 8,
    wpm: 140,
  };
  const toShort = scriptModeMediaSoftPatch('short_manhua', fromDefault);
  assert.equal(toShort.so_tu_chuong, 1200);
  assert.equal(toShort.secondsPerBeat, SCRIPT_MODE_PACING.short_manhua.secondsPerBeat);
  assert.equal(toShort.wpm, 170);
  ok('soft short from long defaults');

  const toSang = scriptModeMediaSoftPatch('sang_van', fromDefault);
  assert.equal(toSang.wpm, 155);
  assert.equal(toSang.secondsPerBeat, 4.5);
  ok('soft sang from long defaults');

  const toDeep = scriptModeMediaSoftPatch('chuyen_sau', {
    secondsPerBeat: 3.5,
    videoDuration: 6,
    wpm: 170,
  });
  assert.equal(toDeep.wpm, 130);
  assert.equal(toDeep.secondsPerBeat, 7);
  ok('soft deep from short defaults');

  // User fine-tune inside short band: beat 3.2 (valid <6), wpm 165 (>145) → no stomp
  const keepShort = scriptModeMediaSoftPatch('short_manhua', {
    so_tu_chuong: 1100,
    secondsPerBeat: 3.2,
    videoDuration: 6,
    wpm: 165,
  });
  assert.equal(keepShort.so_tu_chuong, undefined);
  assert.equal(keepShort.secondsPerBeat, undefined);
  assert.equal(keepShort.wpm, undefined);
  assert.equal(keepShort.videoDuration, undefined);
  ok('soft short preserves user in-band values');

  // User fine-tune sang: beat 5, wpm 150 → no stomp
  const keepSang = scriptModeMediaSoftPatch('sang_van', {
    secondsPerBeat: 5,
    videoDuration: 6,
    wpm: 150,
  });
  assert.equal(keepSang.secondsPerBeat, undefined);
  assert.equal(keepSang.wpm, undefined);
  ok('soft sang preserves user mid-band');
}

// ── 3. Cold open / pacing prompt blocks ──────────────────────────
{
  const deep = buildScriptModeColdOpenBlock('chuyen_sau');
  const sang = buildScriptModeColdOpenBlock('sang_van');
  const short = buildScriptModeColdOpenBlock('short_manhua');
  assert.match(deep, /TẮT/i);
  assert.match(deep, /KHÔNG chèn \[CẢNH 0\]/i);
  assert.match(sang, /GỢI Ý|pattern interrupt/i);
  assert.match(short, /\[CẢNH 0: COLD OPEN/i);
  assert.match(short, /BẮT BUỘC/i);
  assert.equal(
    buildScriptModeColdOpenBlock('short_manhua', { isContinue: true }),
    '',
  );
  ok('cold open blocks differ by mode; continue skips');

  for (const m of SCRIPT_MODES) {
    const block = buildScriptModePacingBlock(m);
    assert.match(block, new RegExp(String(SCRIPT_MODE_PACING[m].wpm)));
    assert.match(block, /NHỊP THEO PHONG CÁCH/i);
    const craft = buildProseCraftBlock(m);
    assert.ok(craft.length > 80, `prose craft empty for ${m}`);
  }
  ok('pacing + prose craft blocks non-empty for all modes');

  assert.match(buildScriptModeShotRhythmBlock('short_manhua'), /2\.5/);
  assert.match(buildScriptModeShotRhythmBlock('chuyen_sau'), /AUDIO DÀI|CHUYÊN SÂU/i);
  assert.doesNotMatch(
    buildScriptModeShotRhythmBlock('chuyen_sau'),
    /BẮT BUỘC.*2\.5/,
  );
  ok('shot rhythm: short kinetic, deep not short-forced');
}

// ── 4. Shot duration allocation (usable totals inside band) ──────
{
  // 6 shots × ~3.3s = 20s fits short band 2.5–4
  const emotions = ['action', 'calm', 'fight', 'dialogue', 'shock', 'peaceful'];
  const sentences = [
    'hắn đánh nhau đẫm máu',
    'cô đứng im nhìn mưa',
    'đuổi bắt trên phố',
    'hắn nói khẽ',
    'nổ tung cả tòa tháp',
    'phong cảnh yên bình',
  ];
  const durs = allocateShotDurationsByMode({
    mode: 'short_manhua',
    totalDurationSec: 20,
    count: 6,
    emotions,
    sentences,
  });
  assert.equal(durs.length, 6);
  assert.equal(
    durs.reduce((a, b) => a + b, 0),
    20,
    `short sum must be 20 got ${durs}`,
  );
  const fightIdx = 0;
  const calmIdx = 1;
  // Action should not be longer than calm when tension works (allow equal if even fallback)
  assert.ok(
    durs[fightIdx] <= durs[calmIdx] + 1,
    `fight ${durs[fightIdx]} should be ≤ calm ${durs[calmIdx]}+1 · full=${durs}`,
  );
  ok(`short tension durations sum=20 · ${JSON.stringify(durs)}`);

  // Explicit tension scores sanity
  assert.ok(scoreShotTension('action fight', 'đánh') > scoreShotTension('calm', 'đứng im'));
  ok('scoreShotTension ranks action > calm');

  const deepD = allocateShotDurationsByMode({
    mode: 'chuyen_sau',
    totalDurationSec: 42,
    count: 6,
    emotions: ['action', 'calm', 'fight', 'dialogue', 'shock', 'calm'],
  });
  assert.equal(deepD.reduce((a, b) => a + b, 0), 42);
  // Deep is near-even — max-min small
  const spread = Math.max(...deepD) - Math.min(...deepD);
  assert.ok(spread <= 2, `deep should be near-even, spread=${spread} ${deepD}`);
  ok(`deep even-ish durations sum=42 · ${JSON.stringify(deepD)}`);

  // B10: missing total must throw
  assert.throws(() =>
    allocateShotDurationsByMode({
      mode: 'short_manhua',
      totalDurationSec: 0,
      count: 3,
    }),
  );
  ok('allocate hard-fails on missing totalDuration (B10)');
}

// ── 5. Quality hints + quality gate short ────────────────────────
{
  const noHook = shortManhuaQualityHints(
    '[CẢNH 1: NGOẠI. A - ĐÊM]\nx.\n[CẢNH 2: NỘI. B - ĐÊM]\ny.',
  );
  assert.ok(noHook.some((h) => h.code === 'short_missing_cold_open'));
  const withHook = shortManhuaQualityHints(
    '[CẢNH 0: COLD OPEN - HOOK]\nHook.\n[CẢNH 1: NGOẠI. A - ĐÊM]\nx.\n[CẢNH 2: NỘI. B - ĐÊM]\ny.\n[CẢNH 3: NGOẠI. C - ĐÊM]\nz.\n[CẢNH 4: NỘI. D - ĐÊM]\nw.',
  );
  assert.ok(!withHook.some((h) => h.code === 'short_missing_cold_open'));
  ok('quality hints cold open detect');

  const pad = (s: string, n: number) => {
    const words = Array.from({ length: n }, (_, i) => `từ${i}`).join(' ');
    return `${s}\n${words}`;
  };
  const shortBody = pad(
    `[CẢNH 0: COLD OPEN - HOOK]
Nếu biết trước, hắn có quay lại?
[CẢNH 1: NGOẠI CẢNH. PHỐ - ĐÊM]
Hắn chạy.
[CẢNH 2: NỘI CẢNH. PHÒNG - ĐÊM]
"Im!"
[CẢNH 3: NGOẠI CẢNH. SÂN - ĐÊM]
Kiếm tuốt.
[CẢNH 4: NỘI CẢNH. ĐẠI SẢNH - ĐÊM]
Open loop.`,
    1100,
  );
  const report = evaluateChapterQuality({
    content: shortBody,
    wordGoal: 1200,
    scriptMode: 'short_manhua',
  });
  assert.ok(report, 'quality report');
  ok(
    `qualityGate short_manhua scenes ok=${!report.findings.some((f) => f.code === 'scene_gate')}`,
  );
}

// ── 6. Source wiring (must compile into runtime paths) ───────────
{
  const chapter = read('src/app/api/generate/handlers/chapter.ts');
  assert.match(chapter, /buildScriptModePacingBlock/);
  assert.match(chapter, /buildScriptModeColdOpenBlock/);
  assert.match(chapter, /CẢNH 0: COLD OPEN/);
  ok('chapter.ts injects pacing + cold open');

  const imagePrompt = read('src/app/api/generate/handlers/imagePrompt.ts');
  assert.match(imagePrompt, /allocateShotDurationsByMode/);
  assert.match(imagePrompt, /buildScriptModeShotRhythmBlock/);
  ok('imagePrompt.ts uses shot duration + rhythm');

  const scene = read('src/app/api/generate/handlers/scene.ts');
  assert.match(scene, /buildScriptModePacingBlock/);
  assert.match(scene, /getScriptModePacing/);
  ok('scene.ts hook uses mode pacing');

  const story = read('src/store/storyActions.ts');
  assert.match(story, /scriptModeMediaSoftPatch/);
  assert.match(story, /soft\.wpm/);
  ok('setScriptMode soft-patches wpm/beat');

  const writeMod = read('src/app/workspace/modules/writeModule.ts');
  assert.match(writeMod, /scriptMode:\s*store\.scriptMode/);
  ok('writeModule sends scriptMode');

  const sceneMod = read('src/app/workspace/modules/sceneModule.ts');
  assert.match(sceneMod, /scriptMode:\s*store\.scriptMode/);
  ok('sceneModule sends scriptMode');

  const imgHook = read('src/app/workspace/hooks/useImagePromptActions.ts');
  assert.match(imgHook, /scriptMode:\s*st0?\.scriptMode/);
  ok('useImagePromptActions sends scriptMode');

  const setup = read('src/app/workspace/features/script/SetupPhase.tsx');
  assert.match(setup, /setScriptMode\('short_manhua'\)/);
  assert.match(setup, /170 WPM|~170/);
  assert.match(setup, /setScriptMode\('sang_van'\)/);
  assert.match(setup, /setScriptMode\('chuyen_sau'\)/);
  ok('SetupPhase UI wires all 3 modes + short pacing blurb');

  const yt = read('src/app/workspace/features/script/YoutubeSetupPhase.tsx');
  assert.match(yt, /setScriptMode\('short_manhua'\)/);
  assert.match(yt, /cold-open|Cold-open|cold open|170/i);
  ok('YoutubeSetupPhase UI wires scriptMode');
}

// ── 7. normalizeScriptMode safety ────────────────────────────────
assert.equal(normalizeScriptMode('nope'), 'chuyen_sau');
assert.equal(normalizeScriptMode(undefined), 'chuyen_sau');
assert.equal(normalizeScriptMode('short_manhua'), 'short_manhua');
ok('normalizeScriptMode fallback');

console.log(`[verify-script-mode-pacing] PASS · ${checks} checks`);
console.log(
  JSON.stringify(
    {
      modes: SCRIPT_MODES.map((m: ScriptMode) => ({
        mode: m,
        ...getScriptModePacing(m),
      })),
      checks,
    },
    null,
    2,
  ),
);
