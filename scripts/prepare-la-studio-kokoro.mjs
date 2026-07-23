/**
 * Prepare portable Kokoro-VI runtime for AI Novel ship (LA Studio backend pack).
 *
 * Output: bin/la-studio-kokoro/
 *   bin/kokoro-vi-cli.exe + onnxruntime + models/kokoro_vi.onnx + voicepacks
 *
 * Sources (first hit):
 * 1) Already complete portable dir
 * 2) Copy from %USERPROFILE%\.lastudio\extensions\backends\kokoro-vietnamese\*
 * 3) Download GitHub release zip (Kokoro-Vietnamese.cpp)
 *
 * Usage:
 *   node scripts/prepare-la-studio-kokoro.mjs
 *   node scripts/prepare-la-studio-kokoro.mjs --force
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'bin', 'la-studio-kokoro');
const FORCE = process.argv.includes('--force');

const ZIP_URL =
  process.env.AINOVEL_KOKORO_ZIP_URL ||
  'https://github.com/dduongtrandai/Kokoro-Vietnamese.cpp/releases/download/v0.1.0/kokoro-vietnamese-win-x86_64-cpu.zip';

function isComplete(dir) {
  return (
    fs.existsSync(path.join(dir, 'bin', 'kokoro-vi-cli.exe')) &&
    fs.existsSync(path.join(dir, 'models', 'kokoro_vi.onnx'))
  );
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  if (process.platform === 'win32') {
    const r = spawnSync(
      'robocopy',
      [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'],
      { stdio: 'inherit' },
    );
    // robocopy 0-7 = success-ish
    if (r.status != null && r.status >= 8) {
      throw new Error(`robocopy failed status=${r.status}`);
    }
    return;
  }
  fs.cpSync(src, dst, { recursive: true });
}

function findLastudioPack() {
  const base = path.join(
    os.homedir(),
    '.lastudio',
    'extensions',
    'backends',
    'kokoro-vietnamese',
  );
  if (!fs.existsSync(base)) return null;
  const vers = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const v of vers) {
    const p = path.join(base, v);
    if (isComplete(p)) return p;
  }
  return null;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'AI-Novel-Prepare' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', reject);
  });
}

function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error(`Expand-Archive failed status=${r.status}`);
    return;
  }
  const r = spawnSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('unzip failed');
}

/** After extract, zip may nest folders — find complete tree and flatten to DEST */
function normalizeExtracted(extractRoot) {
  if (isComplete(extractRoot)) return extractRoot;
  const stack = [extractRoot];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || !fs.existsSync(cur)) continue;
    if (isComplete(cur)) return cur;
    for (const name of fs.readdirSync(cur)) {
      const p = path.join(cur, name);
      try {
        if (fs.statSync(p).isDirectory()) stack.push(p);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

async function main() {
  console.log('[prepare-la-studio-kokoro] dest=', DEST);

  if (!FORCE && isComplete(DEST)) {
    console.log('[prepare-la-studio-kokoro] already complete — skip');
    process.exit(0);
  }

  if (FORCE && fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
  }

  const local = findLastudioPack();
  if (local) {
    console.log('[prepare-la-studio-kokoro] copy from', local);
    copyTree(local, DEST);
    if (!isComplete(DEST)) {
      console.error('[prepare-la-studio-kokoro] copy incomplete');
      process.exit(2);
    }
    console.log('[prepare-la-studio-kokoro] OK (copied)');
    process.exit(0);
  }

  console.log('[prepare-la-studio-kokoro] download', ZIP_URL);
  const tmp = path.join(os.tmpdir(), `kokoro-vi-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const zipPath = path.join(tmp, 'kokoro.zip');
  try {
    await downloadFile(ZIP_URL, zipPath);
    const extractTo = path.join(tmp, 'extract');
    extractZip(zipPath, extractTo);
    const found = normalizeExtracted(extractTo);
    if (!found) {
      console.error('[prepare-la-studio-kokoro] zip missing cli/onnx after extract');
      process.exit(3);
    }
    copyTree(found, DEST);
    if (!isComplete(DEST)) {
      console.error('[prepare-la-studio-kokoro] still incomplete after download');
      process.exit(4);
    }
    console.log('[prepare-la-studio-kokoro] OK (downloaded)');
    process.exit(0);
  } catch (e) {
    console.error('[prepare-la-studio-kokoro] FAIL', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main();
