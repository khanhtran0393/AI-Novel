/**
 * Smoke: chapter TTS UI freeze guards (persist mute + queue prepare + throttle).
 * No network / no real TTS — pure module contracts.
 * Run: npx tsx scripts/smoke-chapter-tts-ui-freeze.mts
 */
import assert from 'node:assert/strict';
import {
  beginPersistMute,
  endPersistMute,
  isPersistMuted,
  runWithPersistMuted,
  yieldToUi,
  createDeferredPersistStorage,
} from '../src/store/persistStorage.ts';
import {
  beginChapterQueuePrepare,
  clearChapterQueuePrepare,
  cancelChapterQueue,
  getChapterQueueState,
  startChapterQueue,
  setChapterQueueNotice,
  resolveChapterTtsConcurrency,
} from '../src/lib/ttsChapterQueue.ts';

function ok(l: string) {
  console.log(`  OK  ${l}`);
}

// --- persist mute ---
assert.equal(isPersistMuted(), false);
beginPersistMute();
assert.equal(isPersistMuted(), true);
beginPersistMute();
assert.equal(isPersistMuted(), true);
endPersistMute();
assert.equal(isPersistMuted(), true);
endPersistMute();
assert.equal(isPersistMuted(), false);
ok('begin/endPersistMute nest');

let ran = false;
await runWithPersistMuted(async () => {
  assert.equal(isPersistMuted(), true);
  ran = true;
});
assert.equal(ran, true);
assert.equal(isPersistMuted(), false);
ok('runWithPersistMuted');

const t0 = Date.now();
await yieldToUi();
assert.ok(Date.now() - t0 < 500, 'yieldToUi should resolve quickly');
ok('yieldToUi');

// deferred storage skips stringify body while muted
const storage = createDeferredPersistStorage();
beginPersistMute();
storage.setItem('test', { state: { huge: 'x'.repeat(1000) }, version: 1 });
endPersistMute(); // flush once
ok('createDeferredPersistStorage mute + flush');

// --- concurrency policy ---
assert.equal(resolveChapterTtsConcurrency('vina_voice'), 1);
assert.equal(resolveChapterTtsConcurrency('edge_tts'), 3);
assert.equal(resolveChapterTtsConcurrency('piper'), 3);
ok('resolveChapterTtsConcurrency');

// --- prepare → cancel unlocks GUI ---
beginChapterQueuePrepare(7, 'Đang chuẩn bị TTS chương…');
let snap = getChapterQueueState();
assert.equal(snap.running, true);
assert.equal(snap.total, 0);
assert.match(snap.status, /chuẩn bị|TTS/i);
ok('beginChapterQueuePrepare sets running');

cancelChapterQueue();
snap = getChapterQueueState();
assert.equal(snap.running, false, 'cancel during prepare must unlock');
ok('cancel during prepare unlocks');

// --- prepare → clear on preflight fail ---
beginChapterQueuePrepare(3, 'prep');
clearChapterQueuePrepare('❌ preflight fail');
snap = getChapterQueueState();
assert.equal(snap.running, false);
assert.match(snap.status, /preflight fail/);
ok('clearChapterQueuePrepare');

// --- prepare → startChapterQueue transition ---
beginChapterQueuePrepare(2, 'prep');
const jobs = [
  { sceneIndex: 0, text: 'A', title: 'C1' },
  { sceneIndex: 1, text: 'B', title: 'C2' },
];
const result = await startChapterQueue({
  chapterNumber: 2,
  jobs,
  skipExisting: false,
  concurrency: 1,
  hasExistingAudio: () => false,
  deductCredit: () => true,
  generateOne: async () => {
    /* no-op */
  },
});
assert.equal(result.ok, 2);
assert.equal(result.fail, 0);
snap = getChapterQueueState();
assert.equal(snap.running, false);
assert.equal(snap.ok, 2);
ok('prepare → startChapterQueue transition');

// notice while idle
setChapterQueueNotice('idle note');
assert.equal(getChapterQueueState().status, 'idle note');
ok('setChapterQueueNotice');

// --- inventory: large-scale ops must detach via appWork (static contract) ---
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname || __dirname, '..');
const mustDetach = [
  ['src/app/workspace/hooks/chapterTtsActions.ts', 'scheduleAppWork'],
  ['src/app/workspace/hooks/useImagePromptActions.ts', 'scheduleAppWork'],
  ['src/app/workspace/hooks/useCharacterActions.ts', 'scheduleAppWork'],
  ['src/app/workspace/hooks/useSetupActions.ts', 'scheduleAppWork'],
  ['src/app/workspace/hooks/writeChapterFinish.ts', 'scheduleAppWork'],
  ['src/app/workspace/hooks/useWriteChapter.ts', 'skipWordCount'],
  ['src/lib/jobQueue.ts', 'yieldToUi'],
  ['src/lib/appWork/runner.ts', 'setTimeout'],
];
for (const [rel, needle] of mustDetach) {
  const src = readFileSync(join(root, rel), 'utf8');
  assert.match(src, new RegExp(needle), `${rel} missing ${needle}`);
  ok(`guard ${rel} has ${needle}`);
}

console.log('\n[smoke-chapter-tts-ui-freeze] PASS');
