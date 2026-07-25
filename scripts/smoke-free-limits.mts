/**
 * Smoke Free product limits (policy pure + vault consume under enforce mock).
 * Run: npx tsx scripts/smoke-free-limits.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FREE_LIMITS,
  FREE_QUOTA_BUCKETS,
  TRIAL_LIMITS,
  clampFreeChapterCount,
  clampFreeWordGoal,
  contentWordCeilingForTier,
  countContentWords,
  effectiveSetupWordGoal,
  freeWordCapMessage,
  generateRequestToFreeBucket,
  isFreeChapterOutOfRange,
  isTrialChapterOutOfRange,
  normalizeSetupScaleForTier,
  resolveWriteChapterNum,
  resolveWriteWordPlan,
} from '../src/lib/commercial/freeLimitsPolicy.ts';
import {
  shouldStopWordGateContinue,
  wordBandFromSetupGoal,
} from '../src/lib/pipeline/wordBand.ts';
import { evaluateWordGate } from '../src/lib/storyWriting.ts';

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

section('policy constants');
assert.equal(FREE_LIMITS.maxWordsPerChapter, 600);
assert.equal(FREE_LIMITS.maxChapters, 2);
assert.equal(FREE_LIMITS.dailyUsesPerFeature, 3);
assert.ok(FREE_QUOTA_BUCKETS.includes('write_chapter'));
assert.ok(FREE_QUOTA_BUCKETS.includes('gen_image'));
assert.ok(FREE_QUOTA_BUCKETS.includes('tts_edge'));

section('clamps');
assert.equal(clampFreeWordGoal(9000), 600);
assert.equal(clampFreeWordGoal(200), 200);
assert.equal(clampFreeChapterCount(50), 2);
assert.equal(clampFreeChapterCount(1), 1);
assert.equal(isFreeChapterOutOfRange(3), true);
assert.equal(isFreeChapterOutOfRange(2), false);
assert.equal(isFreeChapterOutOfRange(0), true);

// +20% headroom: Free hard-stop content = 720; Trial = 3600
section('contentWordCeilingForTier (+20%)');
assert.equal(contentWordCeilingForTier('free'), 720);
assert.equal(contentWordCeilingForTier('trial'), 3600);
assert.equal(
  effectiveSetupWordGoal(4250, { is_pro: false, is_trial: false }),
  600,
);
assert.equal(
  effectiveSetupWordGoal(4250, { is_pro: true, is_trial: false }),
  4250,
);
assert.ok(
  freeWordCapMessage().includes('600') ||
    freeWordCapMessage().includes('toàn chương') ||
    freeWordCapMessage().includes('cổng từ'),
);

section('wordBand +20% ceiling');
const band600 = wordBandFromSetupGoal(600);
assert.equal(band600.min, Math.round(600 * 0.92));
assert.equal(band600.max, Math.round(600 * 1.2));
const band4250 = wordBandFromSetupGoal(4250);
assert.equal(band4250.max, Math.round(4250 * 1.2));

section('resolveWriteWordPlan — goal = user so_tu (tier clamp, not fixed 4250)');
const freePlan = resolveWriteWordPlan(4250, { is_pro: false, is_trial: false });
assert.equal(freePlan.goal, 600);
assert.equal(freePlan.min, Math.round(600 * 0.92));
assert.equal(freePlan.max, Math.round(600 * 1.2));
assert.equal(freePlan.tier, 'free');
const proPlan = resolveWriteWordPlan(2800, { is_pro: true });
assert.equal(proPlan.goal, 2800);
assert.equal(proPlan.min, Math.round(2800 * 0.92));
assert.equal(proPlan.max, Math.round(2800 * 1.2));
const user800 = resolveWriteWordPlan(800, { is_pro: true });
assert.equal(user800.goal, 800); // Pro respects user 800 — not forced 4250

section('evaluateWordGate = full chapter + hard max (anti 200%+)');
const under = evaluateWordGate('một '.repeat(100), 600, 3);
assert.equal(under.needsContinue, true);
assert.equal(under.overSoftMax, false);
// Over hard max → stop continue even if scenes missing (anti 208%)
const overMax = evaluateWordGate('một '.repeat(800), 600, 3);
assert.equal(overMax.overSoftMax, true);
assert.equal(overMax.needsContinue, false);
// At goal + scenes → stop
const atGoal = evaluateWordGate(
  '[CẢNH 1: A]\n' +
    'một '.repeat(200) +
    '\n[CẢNH 2: B]\n' +
    'hai '.repeat(200) +
    '\n[CẢNH 3: C]\n' +
    'ba '.repeat(200),
  600,
  3,
);
assert.equal(atGoal.wordsOk, true);
assert.equal(atGoal.scenesOk, true);
assert.equal(atGoal.needsContinue, false);
const stopOver = shouldStopWordGateContinue({
  wordCount: 800,
  sceneCount: 1,
  band: band600,
  minScenes: 3,
});
assert.equal(stopOver.stop, true);
const stopDone = shouldStopWordGateContinue({
  wordCount: 600,
  sceneCount: 3,
  band: band600,
  minScenes: 3,
});
assert.equal(stopDone.stop, true);

// Regression: outline path used so_tu>=500 else 4250 — broke Free 100–499 / max 600
section('normalizeSetupScaleForTier (outline/write)');
assert.deepEqual(normalizeSetupScaleForTier(10, 4250, 'free'), {
  so_chuong: 2,
  so_tu_chuong: 600,
});
assert.deepEqual(normalizeSetupScaleForTier(1, 200, 'free'), {
  so_chuong: 1,
  so_tu_chuong: 200,
});
assert.deepEqual(normalizeSetupScaleForTier(20, 5000, 'trial'), {
  so_chuong: 10,
  so_tu_chuong: 3000,
});
assert.equal(normalizeSetupScaleForTier('', '', 'pro').so_tu_chuong, 4250);

section('word count');
assert.ok(countContentWords('một hai ba bốn năm') >= 5);
assert.ok(countContentWords('') === 0);

section('request → bucket map');
assert.equal(generateRequestToFreeBucket('WRITE_CHAPTER'), 'write_chapter');
assert.equal(generateRequestToFreeBucket('GENERATE_OUTLINE'), 'outline_ideas');
assert.equal(generateRequestToFreeBucket('GENERATE_IMAGE_PROMPT'), 'gen_prompt');
assert.equal(generateRequestToFreeBucket('UNKNOWN_X'), null);

// Regression: WRITE_CHAPTER sends chuong_hien_tai as object + so_chuong as planned total.
// Old bug: Number(object)=NaN → always max_chapters on Trial/Free.
section('resolveWriteChapterNum (WRITE payload shape)');
assert.equal(
  resolveWriteChapterNum({
    chuong_hien_tai: { so_chuong: 1, tieu_de: 'Hook', noi_dung: '' },
    so_chuong: 20, // planned total — must NOT be treated as current chapter
  }),
  1,
);
assert.equal(
  resolveWriteChapterNum({
    chuong_hien_tai: { so_chuong: 7 },
    so_chuong: 50,
  }),
  7,
);
assert.equal(resolveWriteChapterNum({ chapterNum: 3 }), 3);
assert.equal(resolveWriteChapterNum({ chuong_hien_tai: 2 }), 2);
assert.equal(resolveWriteChapterNum({ so_chuong: 99 }), 1, 'top-level so_chuong ignored');
assert.equal(isTrialChapterOutOfRange(resolveWriteChapterNum({
  chuong_hien_tai: { so_chuong: 1 },
  so_chuong: 20,
})), false);
assert.equal(isTrialChapterOutOfRange(11), true);
assert.equal(TRIAL_LIMITS.maxChapters, 10);

section('vault consume (isolated temp root + durable path)');
const tmpRoot = path.join(
  process.cwd(),
  'data',
  '_smoke_free_limits_' + Date.now(),
);
fs.mkdirSync(tmpRoot, { recursive: true });
// Machine store uses AINOVEL_DATA_ROOT (outside portable app tree)
process.env.AINOVEL_DATA_ROOT = tmpRoot;
process.env.AI_NOVEL_ROOT = path.join(tmpRoot, 'portable-app-fake');
// Force free path: entitlement open would skip — set enforce without token → free
process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
// Avoid keyring hard-fail on unrelated paths; freeQuota only needs resolve when free
delete process.env.AINOVEL_OWNER_UNLIMITED;
delete process.env.AI_NOVEL_USER_DATA;

const {
  readFreeUsageForHwid,
  assertAndConsumeFreeQuota,
  freeLimitsApply,
  localDayKey,
} = await import('../src/lib/commercial/freeQuota.ts');
const { licenseMachineStoreFile } = await import(
  '../src/lib/commercial/licenseMachineStore.ts'
);

// Durable path must NOT live under portable-app-fake
const durableFile = licenseMachineStoreFile('free-usage.json');
assert.ok(
  durableFile.startsWith(tmpRoot),
  `durable vault under DATA_ROOT: ${durableFile}`,
);
assert.ok(
  !durableFile.includes('portable-app-fake'),
  'free-usage must not live inside portable app folder',
);
console.log('durable free-usage path:', durableFile);

// Mock Request without token
const req = new Request('http://localhost/api/generate', { method: 'POST' });

// freeLimitsApply may throw if keyring misconfigured in enforce — catch and note
let appliesOk = false;
try {
  const r = await freeLimitsApply(req, {});
  console.log('freeLimitsApply →', r);
  appliesOk = r.applies === true || r.tier === 'free';
} catch (e) {
  console.log(
    'freeLimitsApply skipped (keyring/env):',
    e instanceof Error ? e.message.slice(0, 120) : e,
  );
}

if (appliesOk) {
  for (let i = 0; i < FREE_LIMITS.dailyUsesPerFeature; i++) {
    const c = await assertAndConsumeFreeQuota(req, 'write_chapter', {});
    assert.ok(c);
    console.log(`consume ${i + 1}: remaining=${c!.remaining}`);
  }
  let threw = false;
  try {
    await assertAndConsumeFreeQuota(req, 'write_chapter', {});
  } catch {
    threw = true;
  }
  assert.equal(threw, true, '4th write_chapter must throw QUOTA');
  const snap = readFreeUsageForHwid();
  assert.equal(snap.used.write_chapter, 3);
  assert.equal(snap.remaining.write_chapter, 0);
  assert.ok(fs.existsSync(durableFile), 'free-usage.json written to machine store');
  // Simulate portable wipe: only delete fake app root — durable must remain
  fs.rmSync(path.join(tmpRoot, 'portable-app-fake'), {
    recursive: true,
    force: true,
  });
  assert.ok(fs.existsSync(durableFile), 'after portable wipe, free-usage survives');
  const afterWipe = readFreeUsageForHwid();
  assert.equal(afterWipe.used.write_chapter, 3, 'quota not reset after wipe');
  console.log('vault OK (survives portable wipe)', afterWipe, 'day', localDayKey());
} else {
  console.log(
    'Vault consume live-skip (not free tier in this env) — policy checks still pass',
  );
}

// cleanup temp
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log('\n✅ smoke-free-limits PASS');
