/**
 * Core smoke — structure + golden path offline (no live LLM/network TTS).
 * Golden path = Playwright contracts suite + pure Node runtime/media checks.
 * Exit 0 only when all checks pass.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = process.cwd();
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed++;
}

function mustExist(rel) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) ok(`exists ${rel}`);
  else fail(`missing ${rel}`);
}

console.log('\n=== AI Novel smoke:core ===\n');

console.log('[1] Contracts & ownership');
for (const rel of [
  'src/contracts/index.ts',
  'src/contracts/keys.ts',
  'src/contracts/apiMap.ts',
  'src/contracts/validate.ts',
  'src/contracts/GLOSSARY.md',
  'src/lib/errors.ts',
  'src/lib/secrets.ts',
  'src/lib/requestContext.ts',
  'src/lib/runtimeHealth.ts',
  'src/lib/jobQueue.ts',
  'src/lib/projectPortable.ts',
  'src/lib/onboarding.ts',
  'src/app/api/health/runtime/route.ts',
  'src/app/workspace/modules/apiClient.ts',
  'src/app/workspace/features/onboarding/OnboardingBanner.tsx',
  'docs/OPTIONAL_LABS.md',
  'e2e/contracts.spec.ts',
]) {
  mustExist(rel);
}

console.log('\n[2] Generate handlers (LLM)');
for (const h of [
  'visualDna',
  'ideas',
  'imagePrompt',
  'outline',
  'chapter',
  'scene',
  'character',
  'foundation',
]) {
  mustExist(`src/app/api/generate/handlers/${h}.ts`);
}

console.log('\n[3] TTS engines + platforms');
for (const e of [
  'edge',
  'piper',
  'gemini',
  'tiktok',
  'capcut',
  'vieneu',
  'openaiCompat',
  'google',
]) {
  mustExist(`src/app/api/generate-tts/engines/${e}.ts`);
}
for (const p of [
  'piper',
  'edge_tts',
  'vbee',
  'google',
  'elevenlabs',
  'vieneu_tts',
  'capcut_tts',
  'tiktok_tts',
  'openai_tts',
  'hotai_tts',
  'omnivoice_local',
  'vina_voice',
  'gemini_tts',
]) {
  mustExist(`src/app/api/generate-tts/platforms/${p}.ts`);
}
mustExist('src/app/api/generate-tts/ttsRegistry.ts');
mustExist('src/lib/entitlement.ts');
mustExist('src/contracts/domainOwnership.ts');

console.log('\n[4] Image providers');
for (const p of ['openai', 'grok', 'gemini', 'whisk']) {
  mustExist(`src/app/api/generate-image/providers/${p}.ts`);
}

console.log('\n[5] Contracts API map integrity');
try {
  const apiMap = fs.readFileSync(
    path.join(root, 'src/contracts/apiMap.ts'),
    'utf8',
  );
  for (const key of [
    'generate:',
    'generateTts:',
    'generateImage:',
    'healthRuntime:',
    'GENERATE_REQUEST_OWNERS',
  ]) {
    if (apiMap.includes(key)) ok(`apiMap has ${key}`);
    else fail(`apiMap missing ${key}`);
  }
  const keys = fs.readFileSync(path.join(root, 'src/contracts/keys.ts'), 'utf8');
  if (keys.includes('sceneAssetKey') && keys.includes('imageAssetKey')) {
    ok('keys.ts exports scene/image asset keys');
  } else fail('keys.ts incomplete');
} catch (e) {
  fail(String(e));
}

console.log('\n[6] Golden path — Playwright contracts + offline media');
// Playwright resolves TS path aliases correctly (tsx breaks on paths with spaces).
const pw = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', 'e2e/contracts.spec.ts'],
  { cwd: root, encoding: 'utf8', shell: true, timeout: 120000 },
);
if (pw.status === 0) {
  ok('playwright contracts golden path (zod/dto/secrets/health/entitlement)');
} else {
  fail('playwright contracts failed');
  console.error(pw.stdout || '');
  console.error(pw.stderr || '');
}

// Mock image asset — core loop media dir writable
try {
  const imgDir = path.join(root, 'public', 'images');
  const audioDir = path.join(root, 'public', 'audio');
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const pngPath = path.join(imgDir, 'smoke_core_mock.png');
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));
  if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 10) {
    ok('mock image written public/images/smoke_core_mock.png');
  } else fail('mock image missing');

  // TTS path convention (filename only — no network)
  const audioName = 'chapter_1_scene_0_smoke.mp3';
  const audioPath = path.join(audioDir, audioName);
  // minimal empty-ish placeholder (not valid mp3 decode — path only)
  fs.writeFileSync(audioPath, Buffer.from([0]));
  if (fs.existsSync(audioPath)) ok(`mock tts path ${audioName}`);
  else fail('mock tts path write failed');

  // FFmpeg / contracts presence (mirrors runtimeHealth, pure fs)
  const ffWin = path.join(root, 'bin', 'ffmpeg.exe');
  const ffUnix = path.join(root, 'bin', 'ffmpeg');
  if (fs.existsSync(ffWin) || fs.existsSync(ffUnix)) ok('bundled ffmpeg present');
  else ok('ffmpeg not bundled (warn-level; PATH may provide)');

  const edgePkg = path.join(root, 'node_modules', 'node-edge-tts', 'package.json');
  if (fs.existsSync(edgePkg)) ok('node-edge-tts package present');
  else fail('node-edge-tts missing — core TTS engine');
} catch (e) {
  fail(`offline media/runtime checks: ${e}`);
}

console.log('\n[7] Typecheck');
const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '-p', 'tsconfig.json'],
  { cwd: root, encoding: 'utf8', shell: true, timeout: 180000 },
);
if (tsc.status === 0) ok('tsc --noEmit passed');
else {
  fail('tsc failed');
  console.error(tsc.stdout || tsc.stderr || '');
}

console.log('\n=== Result ===');
if (failed === 0) {
  console.log('PASS smoke:core — structure + golden path green\n');
  process.exit(0);
}
console.error(`FAIL smoke:core — ${failed} check(s) failed\n`);
process.exit(1);
