/**
 * Empirical: ghost media reconcile + key-rotate auth/pacing fixes.
 * Run: npx tsx scripts/smoke-media-reconcile-and-keys.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  mediaReconcileSummary,
  reconcileMediaMapsAgainstDisk,
} from '../src/lib/mediaDiskReconcile.ts';
import {
  classifyLimitMessage,
  clearAllKeyCooldowns,
  formatQuotaWaitMessage,
  getPoolWaitInfo,
  markKeyLimited,
  registerKeys,
} from '../src/lib/apiKeyRotate.ts';
import { resolveFlowImageModelName } from '../src/lib/flow-bridge/modelCatalog.ts';

const root = process.cwd();
const scratch = path.join(root, 'scratch', 'reconcile-smoke');
fs.mkdirSync(scratch, { recursive: true });

// Real files
const realWav = path.join(scratch, 'ok.wav');
const realPng = path.join(scratch, 'ok.png');
fs.writeFileSync(realWav, Buffer.alloc(200, 1));
fs.writeFileSync(
  realPng,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

// Copy into public layout so /audio resolve works
const pubAudio = path.join(root, 'public', 'audio', '_smoke_reconcile.wav');
const pubImg = path.join(root, 'public', 'images', '_smoke_reconcile.png');
fs.mkdirSync(path.dirname(pubAudio), { recursive: true });
fs.mkdirSync(path.dirname(pubImg), { recursive: true });
fs.copyFileSync(realWav, pubAudio);
fs.copyFileSync(realPng, pubImg);

const r = reconcileMediaMapsAgainstDisk({
  cwd: root,
  generatedAudioPaths: {
    keep_a: { path: '/audio/_smoke_reconcile.wav', duration: 3 },
    ghost_a: { path: '/audio/chapter_1_scene_1.mp3', duration: 44 },
    empty_a: { path: '', duration: 1 },
  },
  generatedImages: {
    keep_i: '/api/serve-image?file=_smoke_reconcile.png',
    ghost_i: '/api/serve-image?file=chapter_1_scene_990_prompt_0.png?t=1',
  },
  generatedVideos: {
    ghost_v: '/video/missing_walk.mp4',
  },
  generatedAssetDna: {
    keep_a: { kind: 'audio' },
    ghost_a: { kind: 'audio' },
    keep_i: { kind: 'image' },
    ghost_i: { kind: 'image' },
  },
});

assert.equal(r.changed, true);
assert.ok(r.generatedAudioPaths.keep_a, 'keep real audio');
assert.equal(r.generatedAudioPaths.ghost_a, undefined, 'drop ghost audio');
assert.ok(r.generatedImages.keep_i, 'keep real image');
assert.equal(r.generatedImages.ghost_i, undefined, 'drop ghost image');
assert.equal(Object.keys(r.generatedVideos).length, 0, 'drop ghost video');
assert.ok(r.removedAudioKeys.includes('ghost_a'));
assert.ok(r.removedImageKeys.includes('ghost_i'));
console.log('OK reconcile', mediaReconcileSummary(r));

// Key classify: 403 quota ≠ auth 6h
assert.equal(classifyLimitMessage('RESOURCE_EXHAUSTED', 403), 'rpm');
assert.equal(classifyLimitMessage('API key not valid', 400), 'auth');
assert.equal(classifyLimitMessage('quota exceeded', 429), 'rpm');
assert.equal(classifyLimitMessage('invalid argument', 400), 'payload');

clearAllKeyCooldowns();
const k1 = 'AIzaSySMOKE_AUTH_KEY_000000000001';
const k2 = 'AIzaSySMOKE_AUTH_KEY_000000000002';
registerKeys([k1, k2]);
markKeyLimited(k1, 'API key not valid', 403);
markKeyLimited(k2, 'PERMISSION_DENIED', 403);
const wait = getPoolWaitInfo([k1, k2]);
assert.ok(wait, 'pool blocked');
assert.equal(wait!.reason, 'auth', `expected auth not pacing, got ${wait!.reason}`);
assert.ok(wait!.waitMs <= 20 * 60_000 + 1000, `auth cool ≤20m, got ${wait!.waitMs}`);
const msg = formatQuotaWaitMessage(wait!);
assert.ok(/key bị từ chối|API key/i.test(msg), msg);
assert.ok(!/Giữ nhịp an toàn/i.test(msg), 'must not mislabel as pacing');
console.log('OK auth wait message:', msg.slice(0, 120));

clearAllKeyCooldowns();
const wait2 = getPoolWaitInfo([k1, k2]);
assert.equal(wait2, null, 'cleared cooldowns → pool free');
console.log('OK clearAllKeyCooldowns');

// imagen3 alias
assert.equal(resolveFlowImageModelName('imagen3'), 'GEM_PIX_2');
assert.equal(resolveFlowImageModelName('NARWHAL'), 'NARWHAL');
console.log('OK image model aliases');

// cleanup smoke public files
try {
  fs.unlinkSync(pubAudio);
  fs.unlinkSync(pubImg);
} catch {
  /* ignore */
}

console.log(JSON.stringify({ ok: true }, null, 2));
console.log('SMOKE_OK media-reconcile-and-keys');
