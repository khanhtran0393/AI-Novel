/**
 * Smoke: appWork detached runner (GUI display-only contract).
 * Run: npx tsx scripts/smoke-app-work.mts
 */
import assert from 'node:assert/strict';
import {
  scheduleAppWork,
  fireAppWork,
  cancelAppWork,
  getAppWork,
  getActiveAppWorks,
  runGuiSafePool,
  yieldToUi,
} from '../src/lib/appWork/index.ts';
import {
  beginPersistMute,
  endPersistMute,
  isPersistMuted,
} from '../src/store/persistStorage.ts';

function ok(l: string) {
  console.log(`  OK  ${l}`);
}

// --- yieldToUi ---
const t0 = Date.now();
await yieldToUi();
assert.ok(Date.now() - t0 < 500);
ok('yieldToUi');

// --- scheduleAppWork detaches + mutes persist ---
let sawMute = false;
let order: string[] = [];
order.push('before');
const { id, promise } = scheduleAppWork({
  kind: 'other',
  title: 'smoke-job',
  mutePersist: true,
  yieldBeforeStart: true,
  run: async (ctl) => {
    order.push('run');
    sawMute = isPersistMuted();
    ctl.setProgress(50, 'half');
    await ctl.yieldUi();
    ctl.setProgress(100, 'done');
    return 42;
  },
});
order.push('after-schedule');
assert.ok(id.startsWith('work_'));
const snapQ = getAppWork(id);
assert.ok(snapQ);
assert.ok(snapQ!.status === 'queued' || snapQ!.status === 'running');
ok('schedule returns id immediately');

const result = await promise;
assert.equal(result, 42);
assert.equal(sawMute, true, 'run must see persist muted');
assert.equal(isPersistMuted(), false, 'mute ends after work');
assert.deepEqual(order.slice(0, 2), ['before', 'after-schedule']);
assert.ok(order.includes('run'));
const snapDone = getAppWork(id);
assert.equal(snapDone?.status, 'done');
assert.equal(snapDone?.progress, 100);
ok('scheduleAppWork mute + detach + done');

// --- cancel ---
const { id: id2, promise: p2 } = scheduleAppWork({
  kind: 'tts',
  title: 'cancel-me',
  run: async (ctl) => {
    for (let i = 0; i < 50; i++) {
      if (ctl.isCancelled()) throw new DOMException('Aborted', 'AbortError');
      await new Promise((r) => setTimeout(r, 20));
    }
    return 'nope';
  },
});
setTimeout(() => cancelAppWork(id2), 30);
await assert.rejects(() => p2, (e: unknown) => {
  return e instanceof DOMException && e.name === 'AbortError';
});
assert.equal(getAppWork(id2)?.status, 'cancelled');
ok('cancelAppWork');

// --- fireAppWork ---
const firedId = fireAppWork({
  kind: 'image',
  title: 'fire',
  run: async () => 'ok',
});
assert.ok(firedId);
// wait a tick for completion
await new Promise((r) => setTimeout(r, 80));
assert.equal(getAppWork(firedId)?.status, 'done');
ok('fireAppWork');

// --- runGuiSafePool ---
const items = [1, 2, 3, 4];
const seen: number[] = [];
const pool = await runGuiSafePool({
  items,
  concurrency: 2,
  worker: async (n) => {
    seen.push(n);
    await new Promise((r) => setTimeout(r, 5));
  },
});
assert.equal(pool.done, 4);
assert.equal(seen.length, 4);
ok('runGuiSafePool');

// nested mute still works
beginPersistMute();
assert.equal(isPersistMuted(), true);
endPersistMute();
assert.equal(isPersistMuted(), false);
ok('persist mute nest independent');

assert.equal(getActiveAppWorks().length, 0);
ok('no active works left');

console.log('\n[smoke-app-work] PASS');
