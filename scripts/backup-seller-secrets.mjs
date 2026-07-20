/**
 * Zip/copy seller secrets offline (private key + .env.seller if present).
 * Never commit the backup. Default dest: Desktop or --out path.
 *
 *   node scripts/backup-seller-secrets.mjs
 *   node scripts/backup-seller-secrets.mjs --out D:\Backups\ainovel-seller
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

const localApp =
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const sellerDir = path.join(localApp, 'AI Novel Seller');

if (!fs.existsSync(sellerDir)) {
  console.error(`Seller folder not found: ${sellerDir}`);
  console.error('Run npm run commercial:secrets first.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const desktop = path.join(os.homedir(), 'Desktop');
const outRoot =
  arg('out') ||
  (fs.existsSync(desktop)
    ? path.join(desktop, 'AI-Novel-Seller-Backup')
    : path.join(os.homedir(), 'AI-Novel-Seller-Backup'));
fs.mkdirSync(outRoot, { recursive: true });
const dest = path.join(outRoot, `seller-${stamp}`);
fs.mkdirSync(dest, { recursive: true });

for (const name of fs.readdirSync(sellerDir)) {
  const src = path.join(sellerDir, name);
  const st = fs.statSync(src);
  if (st.isFile()) {
    fs.copyFileSync(src, path.join(dest, name));
  }
}

// Optional: compress with tar if available (Windows 10+)
const tar = path.join(dest + '.tar');
const r = spawnSync(
  'tar',
  ['-cf', tar, '-C', outRoot, path.basename(dest)],
  { encoding: 'utf8' },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      sellerDir,
      backupFolder: dest,
      tar: r.status === 0 ? tar : null,
      note: 'Store offline / USB. Never commit or email unencrypted.',
    },
    null,
    2,
  ),
);
