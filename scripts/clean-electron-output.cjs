/** Clean electron-builder output so stale runtime files cannot leak into a new package. */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outArg = process.argv[2] || 'dist-qa-unsigned';
const outDir = path.resolve(root, outArg);
const rel = path.relative(root, outDir);

if (rel.startsWith('..') || path.isAbsolute(rel)) {
  throw new Error(`Refusing to clean outside repo: ${outDir}`);
}

const base = path.basename(outDir).toLowerCase();
if (base !== 'dist' && !base.startsWith('dist-qa')) {
  throw new Error(`Refusing to clean non-dist output: ${outDir}`);
}

const removableNames = new Set([
  'win-unpacked',
  'builder-debug.yml',
  'builder-effective-config.yaml',
  'latest.yml',
  'beta.yml',
]);

const removableExt = [
  '.exe',
  '.blockmap',
  '.zip',
  '.7z',
  '.nsis.7z',
  '.yml',
];

fs.mkdirSync(outDir, { recursive: true });
const removed = [];
for (const name of fs.readdirSync(outDir)) {
  const full = path.join(outDir, name);
  const lower = name.toLowerCase();
  const shouldRemove =
    removableNames.has(lower) ||
    removableExt.some((ext) => lower.endsWith(ext));
  if (!shouldRemove) continue;
  fs.rmSync(full, { recursive: true, force: true });
  removed.push(path.relative(root, full));
}

console.log(JSON.stringify({ ok: true, outDir, removed }, null, 2));
