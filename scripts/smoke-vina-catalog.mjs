/**
 * smoke:vina — catalog integrity (profiles ↔ samples on disk).
 * Exit 0 only when JSON valid and every profile resolves a WAV sample.
 *
 * Usage: node scripts/smoke-vina-catalog.mjs
 *        node scripts/smoke-vina-catalog.mjs --min=76
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '..');
const root = path.join(cwd, 'data', 'vina-voices');
const minArg = process.argv.find((a) => a.startsWith('--min='));
const MIN = minArg ? Number(minArg.slice(6)) : 76;

function fail(msg) {
  console.error('SMOKE_VINA_FAIL:', msg);
  process.exit(1);
}

const requiredJson = [
  'profiles_goc.json',
  'profiles_user.json',
  'chunk_profiles.json',
  'help.json',
  'roles.json',
  'session_state.json',
];

if (!fs.existsSync(root)) fail(`missing root ${root}`);

const parsed = {};
for (const f of requiredJson) {
  const full = path.join(root, f);
  if (!fs.existsSync(full)) fail(`missing ${f}`);
  try {
    parsed[f] = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    fail(`bad json ${f}: ${e.message}`);
  }
  console.log('OK json', f);
}

const goc = parsed['profiles_goc.json'];
const names = Object.keys(goc || {});
if (names.length < MIN) fail(`profiles_goc count ${names.length} < min ${MIN}`);

const samplesDir = path.join(root, 'samples');
if (!fs.existsSync(samplesDir)) fail('missing samples/');

const wavs = fs.readdirSync(samplesDir).filter((f) => /\.wav$/i.test(f));
if (wavs.length < MIN) fail(`wav on disk ${wavs.length} < min ${MIN}`);

const missing = [];
let withSample = 0;
for (const name of names) {
  const entry = goc[name] || {};
  const filename = entry.filename || entry.file || entry.sample || '';
  const candidates = [
    filename && path.join(samplesDir, filename),
    filename && path.join(root, filename),
    entry.path && path.isAbsolute(entry.path) ? entry.path : entry.path && path.join(root, entry.path),
  ].filter(Boolean);
  const hit = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 1000);
  if (hit) withSample++;
  else missing.push(`${name} / ${filename || '(no filename)'}`);
}

const report = {
  vinaRoot: root,
  profiles: names.length,
  wavOnDisk: wavs.length,
  withSample,
  missingFirst: missing.slice(0, 8),
  sampleFirst: wavs.slice(0, 3).map((f) => {
    const p = path.join(samplesDir, f);
    return { f, bytes: fs.statSync(p).size };
  }),
};

console.log(JSON.stringify(report, null, 2));

if (withSample < MIN) fail(`withSample ${withSample} < min ${MIN}`);
if (missing.length) fail(`${missing.length} profiles missing samples`);

console.log('SMOKE_VINA_OK', `profiles=${names.length}`, `wav=${wavs.length}`);
process.exit(0);
