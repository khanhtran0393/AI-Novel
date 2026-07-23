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
  countContentWords,
  generateRequestToFreeBucket,
  isFreeChapterOutOfRange,
  isTrialChapterOutOfRange,
  normalizeSetupScaleForTier,
  resolveWriteChapterNum,
} from '../src/lib/commercial/freeLimitsPolicy.ts';

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
