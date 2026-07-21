/**
 * Build electron-updater latest.yml (or beta.yml) from a release directory
 * that already has AI-Novel-*-x64.exe (signed or unsigned QA).
 *
 *   node scripts/generate-update-manifest.mjs --dir dist-qa-unsigned
 *   node scripts/generate-update-manifest.mjs --dir dist --channel latest
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

function hashFileSha512Base64(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function main() {
  const releaseDir = path.resolve(root, arg('dir', 'dist'));
  const channel = String(arg('channel', 'latest')).trim() || 'latest';
  const version = String(arg('version', packageJson.version)).trim();
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release dir missing: ${releaseDir}`);
  }

  const preferred = `AI-Novel-${version}-x64.exe`;
  let exeName = preferred;
  let exePath = path.join(releaseDir, preferred);
  if (!fs.existsSync(exePath)) {
    const found = fs
      .readdirSync(releaseDir)
      .filter((n) => /^AI-Novel-.*-x64\.exe$/i.test(n) && !n.endsWith('.blockmap'));
    if (!found.length) {
      throw new Error(`No AI-Novel-*-x64.exe in ${releaseDir}`);
    }
    exeName = found.sort().at(-1);
    exePath = path.join(releaseDir, exeName);
  }

  const size = fs.statSync(exePath).size;
  const sha512 = hashFileSha512Base64(exePath);
  const releaseDate = new Date().toISOString();

  const yaml = [
    `version: ${version}`,
    `files:`,
    `  - url: ${exeName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${exeName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  const outName = channel === 'latest' ? 'latest.yml' : `${channel}.yml`;
  const outPath = path.join(releaseDir, outName);
  fs.writeFileSync(outPath, yaml, 'utf8');
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        version,
        exeName,
        size,
        sha512Prefix: sha512.slice(0, 24) + '…',
      },
      null,
      2,
    ),
  );
}

main();
