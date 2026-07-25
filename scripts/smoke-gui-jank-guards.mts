/**
 * Static guards: GUI lag sources that survive "detach appWork".
 * Run: npx tsx scripts/smoke-gui-jank-guards.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('=== smoke-gui-jank-guards ===\n');

// 1) Deferred stringify — not sync on every setItem when unmuted
{
  const p = read('src/store/persistStorage.ts');
  assert.ok(p.includes('scheduleStagedPersistStringify'), 'staged stringify');
  assert.ok(p.includes('STRINGIFY_DEBOUNCE_MS'), 'debounce stringify');
  assert.ok(
    !p.match(
      /setItem:\s*\([^)]*\)[^{]*\{\s*if\s*\(persistMuteDepth[\s\S]*?dualStorage\.setItem\(name,\s*JSON\.stringify\(newValue\)\)/,
    ),
    'createDeferredPersistStorage must not sync-stringify on every setItem',
  );
  assert.ok(p.includes('flushStagedPersistStringify'), 'flush on durable now');
  assert.ok(p.includes('_scoreCacheRaw'), 'scoreStoreRaw identity cache');
  assert.ok(
    !p.includes('api.setStoreSync(value)') && !p.includes('api?.setStoreSync?.(value)'),
    'durableWrite / forceOverwrite must not use setStoreSync',
  );
  console.log('OK persist: deferred stringify + score cache + no setStoreSync hot path');
}

// 1b) Credential vault — no JSON.stringify every setState
{
  const v = read('src/store/credentialVault.ts');
  assert.ok(v.includes('credentialsUnchanged'), 'ref equality skip');
  assert.ok(
    !v.match(/store\.subscribe\([\s\S]*JSON\.stringify\(snapshot\)/),
    'vault must not stringify snapshot on every store tick',
  );
  console.log('OK credentialVault: cheap equality, no per-setState stringify');
}

// 2) No full generatedImages subscribe on chrome/roster
{
  const roster = read('src/app/workspace/features/script/CharacterRoster.tsx');
  assert.ok(
    !roster.includes('s.generatedImages)') && !roster.includes('(s) => s.generatedImages'),
    'CharacterRoster must not subscribe full generatedImages',
  );
  assert.ok(roster.includes('sheetPresenceSig'), 'roster uses presence sig');

  const form = read(
    'src/app/workspace/features/script/CharacterProfileForm.tsx',
  );
  assert.ok(
    !form.includes('(s) => s.generatedImages)') &&
      !form.includes('useNovelStore((s) => s.generatedImages)'),
    'CharacterProfileForm no full map subscribe',
  );
  assert.ok(form.includes('WardrobeStillLink'), 'per-key wardrobe still');

  const dna = read('src/app/workspace/features/media/MediaDnaBanner.tsx');
  assert.ok(dna.includes('mediaCountSig'), 'DNA uses count sig');
  assert.ok(
    !dna.includes('const generatedImages = useNovelStore'),
    'DNA no full images map',
  );
  assert.ok(dna.includes('700'), 'DNA debounced evaluate');

  const loc = read(
    'src/app/workspace/features/script/SceneLocationLibrary.tsx',
  );
  assert.ok(loc.includes('LocStillLink'), 'location per-key still');
  assert.ok(
    !loc.includes('const generatedImages = useNovelStore'),
    'location no full map',
  );
  console.log('OK react: no full generatedImages on chrome/roster');
}

// 3) jobQueue emit throttle
{
  const jq = read('src/lib/jobQueue.ts');
  assert.ok(jq.includes('EMIT_MIN_MS'), 'job emit throttle');
  assert.ok(jq.includes('function emit(force'), 'emit force flag');
  assert.ok(jq.includes('emit(true)'), 'force on terminal states');
  console.log('OK jobQueue: throttled emit');
}

// 4) appWork still detaches click
{
  const r = read('src/lib/appWork/runner.ts');
  assert.ok(r.includes('setTimeout'), 'detach setTimeout');
  assert.ok(r.includes('beginPersistMute'), 'mute persist during work');
  assert.ok(r.includes('UI_EMIT_MIN_MS'), 'throttle appWork UI');
  console.log('OK appWork: detach + mute + throttle');
}

console.log('\n=== ALL PASS: smoke-gui-jank-guards ===');
console.log(
  'NOTE: Electron renderer is still single-threaded — detach ≠ Worker thread.',
);
console.log(
  'Heavy Flow/LLM still competes for CPU; these guards stop React/persist thrash.',
);
