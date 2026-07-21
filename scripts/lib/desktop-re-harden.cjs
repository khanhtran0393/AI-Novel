/**
 * Desktop reverse-engineering friction — Phases A/B for Electron shell.
 *
 * Phase A: strip comments / blank lines on main.js, preload.js, electron/**
 * Phase B: prefer esbuild minify+mangle when available; restore after pack
 *
 * Never mutates git sources permanently: backup → transform → pack → restore.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { hardenShellSource } = require('./shell-minify.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKUP_DIR = path.join(ROOT, 'build', '.shell-src-backup');
const PREVIEW_DIR = path.join(ROOT, 'build', 'shell-hardened-preview');

const SHELL_FILES = [
  // main.js is boot-critical (Next prepare + splash). Do NOT minify in-place during
  // beforePack — observed corrupted/truncated main.js in ASAR when minify raced pack.
  // Keep friction on secondary shell modules only.
  'preload.js',
  'electron/credentialVault.js',
  'electron/durableStore.js',
  'electron/securityPolicy.js',
  'electron/updater.js',
  // splashBrand.js intentionally not minified (brand boot + AINOVEL_SPLASH_MS)
];

function resolveEsbuild() {
  try {
    return require('esbuild');
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listShellAbs() {
  return SHELL_FILES.map((rel) => ({
    rel: rel.replace(/\\/g, '/'),
    abs: path.join(ROOT, rel),
  })).filter((e) => fs.existsSync(e.abs));
}

/**
 * @param {string} raw
 * @param {string} relative
 * @returns {Promise<string>}
 */
async function transformSource(raw, relative) {
  const esbuild = resolveEsbuild();
  if (esbuild) {
    const result = await esbuild.transform(raw, {
      loader: 'js',
      minify: true,
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      target: ['node20'],
      legalComments: 'none',
      format: 'cjs',
    });
    return `/* ainovel-re-harden esbuild ${relative} */\n${result.code}`;
  }
  return hardenShellSource(raw, { fileLabel: relative });
}

/**
 * Backup originals then overwrite workspace shell with hardened copies.
 * @returns {Promise<{ hardened: string[], engine: string }>}
 */
async function applyShellHardenInPlace() {
  ensureDir(BACKUP_DIR);
  const entries = listShellAbs();
  const hardened = [];
  const engine = resolveEsbuild() ? 'esbuild' : 'conservative';

  for (const { rel, abs } of entries) {
    const backupPath = path.join(BACKUP_DIR, rel);
    ensureDir(path.dirname(backupPath));

    // If leftover hardened file exists without backup, refuse (avoid double-minify)
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(abs, backupPath);
    }

    const raw = fs.readFileSync(backupPath, 'utf8');
    const out = await transformSource(raw, rel);
    fs.writeFileSync(abs, out, 'utf8');
    hardened.push(rel);
  }

  fs.writeFileSync(
    path.join(BACKUP_DIR, '_active.json'),
    JSON.stringify({ at: Date.now(), engine, files: hardened }, null, 2),
    'utf8',
  );

  return { hardened, engine };
}

/**
 * Restore shell sources from backup if present.
 * @returns {{ restored: string[] }}
 */
function restoreShellFromBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return { restored: [] };
  const restored = [];
  for (const { rel, abs } of listShellAbs()) {
    const backupPath = path.join(BACKUP_DIR, rel);
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, abs);
      restored.push(rel);
    }
  }
  const marker = path.join(BACKUP_DIR, '_active.json');
  if (fs.existsSync(marker)) {
    try {
      fs.unlinkSync(marker);
    } catch {
      /* ignore */
    }
  }
  return { restored };
}

/**
 * Dry-run: write hardened previews without touching workspace sources.
 * @returns {Promise<{ previewDir: string, files: string[], engine: string, bytes: Record<string, { before: number, after: number }> }>}
 */
async function writeShellHardenPreview() {
  ensureDir(PREVIEW_DIR);
  const entries = listShellAbs();
  const files = [];
  const bytes = {};
  const engine = resolveEsbuild() ? 'esbuild' : 'conservative';

  for (const { rel, abs } of entries) {
    const raw = fs.readFileSync(abs, 'utf8');
    const out = await transformSource(raw, rel);
    const dest = path.join(PREVIEW_DIR, rel);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, out, 'utf8');
    files.push(rel);
    bytes[rel] = { before: Buffer.byteLength(raw, 'utf8'), after: Buffer.byteLength(out, 'utf8') };
  }

  fs.writeFileSync(
    path.join(PREVIEW_DIR, 'manifest.json'),
    JSON.stringify(
      {
        phase: 'A+B',
        engine,
        at: new Date().toISOString(),
        files,
        bytes,
        note: 'Preview only — pack uses beforePack in-place harden + afterPack restore',
      },
      null,
      2,
    ),
    'utf8',
  );
  return { previewDir: PREVIEW_DIR, files, engine, bytes };
}

/**
 * Syntax-check a shell JS file via `node --check` (handles regex/template correctly).
 * @param {string} absPath
 */
function assertShellFileSyntax(absPath) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', absPath], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(
      `Hardened shell syntax fail ${absPath}:\n${r.stderr || r.stdout || r.status}`,
    );
  }
}

/**
 * @param {string} code
 * @param {string} [label]
 */
function assertShellParses(code, label = 'inline') {
  const body = String(code).replace(/^#!.*\n/, '');
  if (body.length < 20) throw new Error(`Hardened shell looks empty (${label})`);
  if (!body.includes('ainovel-re-harden')) {
    throw new Error(`Hardened shell missing banner (${label})`);
  }
  const os = require('os');
  const tmp = path.join(
    os.tmpdir(),
    `ainovel-shell-check-${Date.now()}-${Math.random().toString(16).slice(2)}.js`,
  );
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    assertShellFileSyntax(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  ROOT,
  BACKUP_DIR,
  PREVIEW_DIR,
  SHELL_FILES,
  applyShellHardenInPlace,
  restoreShellFromBackup,
  writeShellHardenPreview,
  assertShellParses,
  assertShellFileSyntax,
  resolveEsbuild,
};
