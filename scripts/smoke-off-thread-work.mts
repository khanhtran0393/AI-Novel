/**
 * Smoke: off-GUI work host wiring (utilityProcess + Worker + media fetch paths).
 * Run: npx tsx scripts/smoke-off-thread-work.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('=== smoke-off-thread-work ===\n');

// 1) Electron host files exist
{
  assert.ok(fs.existsSync(path.join(root, 'electron/workHost.cjs')));
  assert.ok(fs.existsSync(path.join(root, 'electron/workBridge.js')));
  const host = read('electron/workHost.cjs');
  assert.ok(host.includes('doFetch') && host.includes('batch'));
  const bridge = read('electron/workBridge.js');
  assert.ok(bridge.includes('utilityProcess') || bridge.includes('registerWorkIpc'));
  assert.ok(bridge.includes('ainovel-work-fetch'));
  console.log('OK electron workHost + workBridge');
}

// 2) main + preload wire
{
  const main = read('main.js');
  assert.ok(main.includes("require('./electron/workBridge')"));
  assert.ok(main.includes('registerWorkIpc'));
  assert.ok(main.includes('shutdownWorkHost'));
  const pre = read('preload.js');
  assert.ok(pre.includes('ainovelWork'));
  assert.ok(pre.includes('ainovel-work-fetch'));
  console.log('OK main/preload IPC ainovelWork');
}

// 3) Client off-thread modules
{
  const host = read('src/lib/appWork/offThreadHost.ts');
  assert.ok(host.includes('offThreadFetch'));
  assert.ok(host.includes('utilityProcess') || host.includes('ainovelWork'));
  assert.ok(host.includes('Worker'));
  const compat = read('src/lib/appWork/offThreadFetchCompat.ts');
  assert.ok(compat.includes('offThreadFetchResponse'));
  const runner = read('src/lib/appWork/runner.ts');
  assert.ok(runner.includes('enqueueOffGuiStart'));
  assert.ok(runner.includes('offThreadFetch') || runner.includes('Worker/utilityProcess'));
  console.log('OK offThreadHost + runner enqueueOffGuiStart');
}

// 4) Media modules use off-thread fetch
{
  const img = read('src/app/workspace/modules/imageModule.ts');
  assert.ok(img.includes('offThreadFetchResponse'));
  assert.ok(!img.match(/await fetch\(API\.generateImage/));
  const vid = read('src/app/workspace/modules/videoModule.ts');
  assert.ok(vid.includes('offThreadFetchResponse'));
  const char = read('src/app/workspace/modules/characterModule.ts');
  assert.ok(char.includes('offThreadFetchResponse'));
  const api = read('src/app/workspace/modules/apiClient.ts');
  assert.ok(api.includes('offThreadFetchResponse'));
  const prog = read('src/app/workspace/modules/mediaGenProgress.ts');
  assert.ok(prog.includes('offThreadFetchResponse'));
  console.log('OK image/video/character/apiClient/progress off-thread fetch');
}

// 5) Unit: resolveAbsoluteApiUrl pure
{
  // Dynamic import of TS
  const { resolveAbsoluteApiUrl } = await import(
    '../src/lib/appWork/offThreadHost.ts'
  );
  assert.equal(
    resolveAbsoluteApiUrl('https://x.test/a'),
    'https://x.test/a',
  );
  // without window, relative stays relative-ish
  const rel = resolveAbsoluteApiUrl('/api/generate-image');
  assert.ok(rel.includes('generate-image') || rel.startsWith('/api'));
  console.log('OK resolveAbsoluteApiUrl', rel);
}

console.log('\n=== ALL PASS: smoke-off-thread-work ===');
console.log(
  'NOTE: Live utilityProcess requires Electron runtime; Worker used in web/dev browser.',
);
