/**
 * Clean workspace for thin packaging.
 * Removes: Flow profiles, generated media, project JSON dumps, CUDA wheels,
 * MediaCrawler, __pycache__, .next, dist artifacts, scratch logs.
 * Keeps: source, package.json, resources/crown seals, bin/, vina ONNX, node_modules.
 *
 * Usage: node scripts/clean-workspace.mjs
 *        node scripts/clean-workspace.mjs --keep-next   (skip .next wipe)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepNext = process.argv.includes('--keep-next');
const log = (m) => console.log(m);

function rm(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  log(`DEL ${rel}`);
  return true;
}

function emptyDir(rel) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
  log(`CLR ${rel}`);
}

function rmFile(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  log(`DEL ${rel}`);
  return true;
}

log('=== clean-workspace (thin pack prep) ===');

// Project / runtime JSON (not package.json / tsconfig.json)
for (const f of [
  'scratch/novel_store_backup.json',
  'data/flow-bridge/active-project.json',
  'data/flow-bridge/projects.json',
  'python_core/gpu_install_status.json',
  'python_core/gpu_profile.json',
  'python_core/_login_check.json',
  'python_core/xu_ly_config.json',
  'public/omnivoice-library.json',
  'tsconfig.tsbuildinfo',
]) {
  rmFile(f);
}

// CUDA / torch offline wheels
for (const f of fs.readdirSync(path.join(root, 'python_core'), { withFileTypes: true })) {
  if (f.isFile() && /\.whl$/i.test(f.name) && /torch/i.test(f.name)) {
    rmFile(path.join('python_core', f.name));
  }
}

// Scratch (wipe all files)
emptyDir('scratch');

// Flow profiles (keep README)
const acc = path.join(root, 'accounts_data');
if (fs.existsSync(acc)) {
  for (const e of fs.readdirSync(acc, { withFileTypes: true })) {
    if (e.name === 'README.md') continue;
    rm(path.join('accounts_data', e.name));
  }
}

// Generated media
for (const d of [
  'public/audio',
  'public/omnivoice-refs',
  'public/downloads',
  'public/navtools',
  'public/phantom-x-bypass',
  'public/renders',
  'public/video',
  'public/watermarked',
  'public/images',
  'public/isolated',
  'data/vina-voices',
  'data/omnivoice-profiles',
  'data/flow-bridge',
]) {
  emptyDir(d);
}

for (const f of [
  'data/licenses/activation-codes.json',
  'data/licenses/free-usage.json',
  'data/licenses/trials.json',
]) {
  rmFile(f);
}

// Python bulk not shipped
rm('python_core/MediaCrawler');
rm('python_core/ffmpeg'); // pack uses bin/ffmpeg.exe
rm('python_core/.vidgen');
rm('python_core/assets');

// __pycache__ / *.pyc
function walkRm(dir, pred) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name === '.git') continue;
    if (e.isDirectory()) {
      if (e.name === '__pycache__' || pred(e, p)) {
        fs.rmSync(p, { recursive: true, force: true });
        log(`DEL ${path.relative(root, p)}`);
      } else walkRm(p, pred);
    } else if (e.isFile() && e.name.endsWith('.pyc')) {
      fs.unlinkSync(p);
    }
  }
}
walkRm(root, (e) => e.name === '__pycache__');

// Build / pack artifacts
rm('dist-qa-unsigned');
rm('dist');
rm('test-results');
rm('exports');
rm('.ainovel-app');
rm('quarantine');
if (!keepNext) rm('.next');

// Ensure skeleton dirs
for (const d of [
  'scratch',
  'data/licenses',
  'data/flow-bridge',
  'data/vina-voices',
  'accounts_data',
  'public/audio',
  'public/images',
]) {
  fs.mkdirSync(path.join(root, d), { recursive: true });
}

log('=== done. Keep: src (incl. vina ONNX), bin/, resources/, package.json, node_modules ===');
log('Next: npm run pack:unsigned:qa   (builds fresh .next + portable)');
