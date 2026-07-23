/**
 * Ensure portable Kokoro-VI runtime exists for ship machines.
 * Writes to AI_NOVEL_ROOT/bin/la-studio-kokoro or cwd/bin/la-studio-kokoro.
 *
 * Prefer pre-bundled pack (electron extraResources). Download only if missing.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawnSync } from 'child_process';
import { resolveKokoroViRuntime } from './laStudioLocal';

const ZIP_URL =
  process.env.AINOVEL_KOKORO_ZIP_URL ||
  'https://github.com/dduongtrandai/Kokoro-Vietnamese.cpp/releases/download/v0.1.0/kokoro-vietnamese-win-x86_64-cpu.zip';

let ensureInflight: Promise<{ ok: boolean; path?: string; error?: string }> | null =
  null;

function destDir(): string {
  const root = (process.env.AI_NOVEL_ROOT || process.cwd()).trim() || process.cwd();
  return path.join(root, 'bin', 'la-studio-kokoro');
}

function isComplete(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'bin', 'kokoro-vi-cli.exe')) &&
    fs.existsSync(path.join(dir, 'models', 'kokoro_vi.onnx'))
  );
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': 'AI-Novel-KokoroEnsure' } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      },
    );
    req.on('error', reject);
  });
}

function extractZip(zipPath: string, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`Expand-Archive failed: ${r.stderr || r.stdout || r.status}`);
  }
}

function findComplete(root: string): string | null {
  if (isComplete(root)) return root;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    if (isComplete(cur)) return cur;
    let names: string[] = [];
    try {
      names = fs.readdirSync(cur);
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(cur, n);
      try {
        if (fs.statSync(p).isDirectory()) stack.push(p);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function copyTree(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  if (process.platform === 'win32') {
    const r = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np']);
    if (r.status != null && r.status >= 8) {
      throw new Error(`robocopy ${r.status}`);
    }
    return;
  }
  fs.cpSync(src, dst, { recursive: true });
}

function tryCopyFromLastudio(dest: string): boolean {
  const base = path.join(
    os.homedir(),
    '.lastudio',
    'extensions',
    'backends',
    'kokoro-vietnamese',
  );
  if (!fs.existsSync(base)) return false;
  try {
    const vers = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const v of vers) {
      const p = path.join(base, v);
      if (!isComplete(p)) continue;
      copyTree(p, dest);
      return isComplete(dest);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Idempotent: returns quickly if resolveKokoroViRuntime already works.
 */
export async function ensurePortableKokoroRuntime(): Promise<{
  ok: boolean;
  path?: string;
  error?: string;
}> {
  if (resolveKokoroViRuntime()) {
    const rt = resolveKokoroViRuntime()!;
    return { ok: true, path: rt.root };
  }
  if (ensureInflight) return ensureInflight;

  ensureInflight = (async () => {
    const dest = destDir();
    try {
      if (isComplete(dest)) {
        return { ok: true, path: dest };
      }
      if (tryCopyFromLastudio(dest)) {
        console.log('[KokoroEnsure] copied from ~/.lastudio →', dest);
        return { ok: true, path: dest };
      }

      console.log('[KokoroEnsure] downloading', ZIP_URL);
      const tmp = path.join(os.tmpdir(), `ainovel-kokoro-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });
      const zipPath = path.join(tmp, 'k.zip');
      try {
        await downloadFile(ZIP_URL, zipPath);
        const extractTo = path.join(tmp, 'x');
        extractZip(zipPath, extractTo);
        const found = findComplete(extractTo);
        if (!found) {
          return { ok: false, error: 'zip missing kokoro-vi-cli / onnx' };
        }
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        copyTree(found, dest);
        if (!isComplete(dest)) {
          return { ok: false, error: 'incomplete after extract' };
        }
        console.log('[KokoroEnsure] installed', dest);
        return { ok: true, path: dest };
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error('[KokoroEnsure]', error);
      return { ok: false, error };
    } finally {
      ensureInflight = null;
    }
  })();

  return ensureInflight;
}
