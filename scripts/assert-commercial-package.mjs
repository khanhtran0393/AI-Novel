/**
 * Verify packaged dist vs product standard.
 *
 * Default (ship): matches PACKAGING_STANDARD.md —
 *   unsigned install ALLOWED; require enforce + audit + release-notes.
 * Signed go-live: pass --require-signed (Authenticode Valid + ALLOW_UNSIGNED=0).
 *
 *   node scripts/assert-commercial-package.mjs [distDir]
 *   node scripts/assert-commercial-package.mjs dist --require-signed
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const requireSigned =
  process.argv.includes('--require-signed') ||
  process.env.AINOVEL_REQUIRE_SIGNED === '1';
const distDir = path.resolve(root, args[0] || 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const productName = pkg.build?.productName || 'Ai Novel';

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

const releaseNotesPath = path.join(
  distDir,
  'win-unpacked',
  'resources',
  'commercial',
  'release-notes.json',
);

if (!fs.existsSync(installer)) fail(`Missing installer: ${installer}`);
if (!fs.existsSync(unpackedExe)) fail(`Missing unpacked exe: ${unpackedExe}`);
if (!fs.existsSync(publicEnvPath)) fail('Packaged public.env missing');
if (!fs.existsSync(standardPath)) fail('Packaged PACKAGING_STANDARD.json missing');
if (!fs.existsSync(releaseNotesPath)) {
  fail('Packaged release-notes.json missing (UpdateSuccessModal needs it)');
} else {
  try {
    const notes = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf8'));
    const block = notes?.versions?.[version];
    if (!block) {
      fail(`release-notes.json missing versions["${version}"]`);
    } else if (!Array.isArray(block.items) || block.items.length === 0) {
      fail(`release-notes.json v${version} has no items`);
    }
  } catch (e) {
    fail(`release-notes.json invalid: ${e instanceof Error ? e.message : e}`);
  }
}

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

// Authenticode: only required when --require-signed (optional wide ship).
// PACKAGING_STANDARD §3 LOCKED: unsigned install is allowed.
let authenticodeSummary = 'skipped';
const sigStatuses = [];
for (const f of [installer, unpackedExe]) {
  if (!fs.existsSync(f)) continue;
  const status = authenticodeStatus(f);
  sigStatuses.push(`${path.basename(f)}:${status || 'unknown'}`);
  if (requireSigned && status !== 'Valid') {
    fail(`Authenticode not Valid for ${path.basename(f)}: ${status || 'unknown'}`);
  }
}
authenticodeSummary = sigStatuses.length
  ? sigStatuses.join('; ')
  : 'no-binaries';

const publicEnv = fs.readFileSync(publicEnvPath, 'utf8');
if (requireSigned && /AINOVEL_UPDATE_ALLOW_UNSIGNED\s*=\s*1/.test(publicEnv)) {
  fail('Signed mode: public.env must not allow unsigned updates (ALLOW_UNSIGNED=0)');
}
if (!requireSigned && !/AINOVEL_UPDATE_ALLOW_UNSIGNED\s*=\s*[01]/.test(publicEnv)) {
  fail('public.env missing AINOVEL_UPDATE_ALLOW_UNSIGNED');
}
if (!/AINOVEL_ENTITLEMENT_MODE\s*=\s*enforce/.test(publicEnv)) {
  fail('Packaged public.env entitlement mode is not enforce');
}
if (!/AINOVEL_UPDATE_PROVIDER\s*=\s*github/.test(publicEnv)) {
  fail('Packaged public.env update provider is not github');
}
if (!/AINOVEL_ALLOW_LOCAL_TRIAL\s*=\s*0/.test(publicEnv)) {
  fail('Packaged public.env must set AINOVEL_ALLOW_LOCAL_TRIAL=0');
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
      mode: requireSigned ? 'require-signed' : 'ship-unsigned-allowed',
      authenticode: authenticodeSummary,
      standard: 'PACKAGING_STANDARD.json present',
    },
    null,
    2,
  ),
);
