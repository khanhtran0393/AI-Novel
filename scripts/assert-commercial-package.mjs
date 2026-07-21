/**
 * Verify a commercial dist output is signed + packaging standard met.
 *   node scripts/assert-commercial-package.mjs [distDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(root, process.argv[2] || 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const productName = pkg.build?.productName || 'AI Novel & Script Generator';

const failures = [];
function fail(m) {
  failures.push(m);
}

const installer = path.join(distDir, `AI-Novel-${version}-x64.exe`);
const unpackedExe = path.join(distDir, 'win-unpacked', `${productName}.exe`);
const publicEnvPath = path.join(
  distDir,
  'win-unpacked',
  'resources',
  'commercial',
  'public.env',
);
const standardPath = path.join(
  distDir,
  'win-unpacked',
  'resources',
  'commercial',
  'PACKAGING_STANDARD.json',
);

if (!fs.existsSync(installer)) fail(`Missing installer: ${installer}`);
if (!fs.existsSync(unpackedExe)) fail(`Missing unpacked exe: ${unpackedExe}`);
if (!fs.existsSync(publicEnvPath)) fail('Packaged public.env missing');
if (!fs.existsSync(standardPath)) fail('Packaged PACKAGING_STANDARD.json missing');

function authenticodeStatus(filePath) {
  const ps = [
    `$sig = Get-AuthenticodeSignature -LiteralPath $env:AINOVEL_SIG_TARGET`,
    `Write-Output ([string]$sig.Status)`,
  ].join('; ');
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, AINOVEL_SIG_TARGET: filePath },
    },
  );
  return String(r.stdout || '')
    .trim()
    .split(/\r?\n/)
    .pop();
}

for (const f of [installer, unpackedExe]) {
  if (!fs.existsSync(f)) continue;
  const status = authenticodeStatus(f);
  if (status !== 'Valid') {
    fail(`Authenticode not Valid for ${path.basename(f)}: ${status || 'unknown'}`);
  }
}

const publicEnv = fs.readFileSync(publicEnvPath, 'utf8');
if (/AINOVEL_UPDATE_ALLOW_UNSIGNED\s*=\s*1/.test(publicEnv)) {
  fail('Packaged public.env still allows unsigned updates');
}
if (!/AINOVEL_ENTITLEMENT_MODE\s*=\s*enforce/.test(publicEnv)) {
  fail('Packaged public.env entitlement mode is not enforce');
}
if (!/AINOVEL_UPDATE_PROVIDER\s*=\s*github/.test(publicEnv)) {
  fail('Packaged public.env update provider is not github');
}

// Re-run audit-package if present
const audit = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'audit-packaged-artifact.cjs'), path.join(distDir, 'win-unpacked')],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);
if (audit.status !== 0) {
  fail(`audit:package failed: ${String(audit.stderr || audit.stdout || '').slice(0, 400)}`);
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version,
      installer,
      authenticode: 'Valid',
      standard: 'PACKAGING_STANDARD.json present',
    },
    null,
    2,
  ),
);
