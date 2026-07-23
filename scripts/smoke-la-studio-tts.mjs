/**
 * Empirical: LA Studio TTS path (Kokoro CLI) produces real WAV.
 * node scripts/smoke-la-studio-tts.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'public', 'audio');
const outWav = path.join(outDir, 'la_studio_tts_smoke.wav');

function resolveKokoro() {
  // Ship layout first
  const portable = path.join(root, 'bin', 'la-studio-kokoro');
  const pCli = path.join(portable, 'bin', 'kokoro-vi-cli.exe');
  const pModel = path.join(portable, 'models');
  if (fs.existsSync(pCli) && fs.existsSync(path.join(pModel, 'kokoro_vi.onnx'))) {
    return { cli: pCli, modelDir: pModel, source: 'bundled' };
  }
  const base = path.join(os.homedir(), '.lastudio', 'extensions', 'backends', 'kokoro-vietnamese');
  if (!fs.existsSync(base)) return null;
  const vers = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const v of vers) {
    const cli = path.join(base, v, 'bin', 'kokoro-vi-cli.exe');
    const modelDir = path.join(base, v, 'models');
    if (fs.existsSync(cli) && fs.existsSync(path.join(modelDir, 'kokoro_vi.onnx'))) {
      return { cli, modelDir, source: 'lastudio' };
    }
  }
  return null;
}

const rt = resolveKokoro();
if (!rt) {
  console.error('[FAIL] Kokoro runtime missing under ~/.lastudio/extensions/backends/kokoro-vietnamese');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });
const text = 'Xin chào, đây là kiểm tra nghe thử và gen TTS LA Studio Kokoro.';

// Parse voices.json like laStudioLocal.parseKokoroVoicesJson (both schemas)
function parseVoices(modelDir) {
  const p = path.join(modelDir, 'voices.json');
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(raw.voices)) {
    return raw.voices.map((v) => String(v.id || '').trim()).filter(Boolean);
  }
  const skip = new Set(['schema', 'default_voice', 'voices']);
  return Object.keys(raw).filter((k) => !skip.has(k) && raw[k] && typeof raw[k] === 'object');
}

const catalog = parseVoices(rt.modelDir);
console.log('[source]', rt.source || '?');
console.log('[cli]', rt.cli);
console.log('[model]', rt.modelDir);
console.log('[catalog]', catalog.length, catalog.join(','));
if (catalog.length < 3) {
  console.error('[FAIL] voices catalog too small / misparsed');
  process.exit(5);
}
// Guard: never treat schema keys as voice ids
if (catalog.some((id) => id === 'schema' || id === 'default_voice' || id === 'voices')) {
  console.error('[FAIL] catalog contains schema keys — parse bug');
  process.exit(6);
}

const sample = [...new Set(['ngoc_huyen', 'diem_trinh', 'hung_thinh', catalog[0]])].filter(
  (id) => catalog.includes(id),
).slice(0, 3);

async function synthOne(voice) {
  const dest = path.join(outDir, `la_studio_preview_${voice}.wav`);
  const code = await new Promise((resolve) => {
    const child = spawn(rt.cli, [rt.modelDir, voice, dest, text], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (c) => {
      err += String(c);
    });
    child.on('close', (c) => resolve({ code: c, err }));
    child.on('error', (e) => resolve({ code: 1, err: String(e) }));
  });
  if (code.code !== 0 || !fs.existsSync(dest)) {
    console.error('[FAIL] voice', voice, 'exit', code.code, code.err.slice(0, 200));
    return false;
  }
  const buf = fs.readFileSync(dest);
  const riff = buf.slice(0, 4).toString('ascii');
  console.log('[wav]', voice, 'size=', buf.length, 'header=', riff, 'path=', dest);
  if (riff !== 'RIFF' || buf.length < 1000) {
    console.error('[FAIL] bad audio', voice);
    return false;
  }
  return true;
}

// Also write canonical smoke path for older callers
let okCount = 0;
for (const voice of sample) {
  const ok = await synthOne(voice);
  if (ok) okCount += 1;
}
// copy first success to la_studio_tts_smoke.wav
const firstOk = sample.find((v) => fs.existsSync(path.join(outDir, `la_studio_preview_${v}.wav`)));
if (firstOk) {
  fs.copyFileSync(
    path.join(outDir, `la_studio_preview_${firstOk}.wav`),
    outWav,
  );
}

if (okCount < sample.length) {
  console.error('[FAIL] only', okCount, '/', sample.length, 'voices preview OK');
  process.exit(3);
}
console.log('[RESULT] SPEECH_OK MEDIA_OK multi_voice=', okCount, sample.join(','));
process.exit(0);
