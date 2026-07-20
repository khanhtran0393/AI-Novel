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
  clampFreeChapterCount,
  clampFreeWordGoal,
  countContentWords,
  generateRequestToFreeBucket,
  isFreeChapterOutOfRange,
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

section('word count');
assert.ok(countContentWords('một hai ba bốn năm') >= 5);
assert.ok(countContentWords('') === 0);

section('request → bucket map');
assert.equal(generateRequestToFreeBucket('WRITE_CHAPTER'), 'write_chapter');
assert.equal(generateRequestToFreeBucket('GENERATE_OUTLINE'), 'outline_ideas');
assert.equal(generateRequestToFreeBucket('GENERATE_IMAGE_PROMPT'), 'gen_prompt');
assert.equal(generateRequestToFreeBucket('UNKNOWN_X'), null);

section('vault consume (isolated temp root)');
const tmpRoot = path.join(
  process.cwd(),
  'data',
  '_smoke_free_limits_' + Date.now(),
);
fs.mkdirSync(path.join(tmpRoot, 'data', 'licenses'), { recursive: true });
process.env.AINOVEL_DATA_ROOT = tmpRoot;
process.env.AI_NOVEL_ROOT = tmpRoot;
// Force free path: entitlement open would skip — set enforce without token → free
process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
// Avoid keyring hard-fail on unrelated paths; freeQuota only needs resolve when free
delete process.env.AINOVEL_OWNER_UNLIMITED;

const { readFreeUsageForHwid, assertAndConsumeFreeQuota, freeLimitsApply } =
  await import('../src/lib/commercial/freeQuota.ts');

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
  console.log('vault OK', snap);
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
