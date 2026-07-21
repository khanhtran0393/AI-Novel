/**
 * Fail-closed gate before commercial desktop build.
 * Requires Authenticode material in env (or WINDOWS_CSC_* aliases).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const seller = path.join(
  process.env.LOCALAPPDATA || '',
  'AI Novel Seller',
  '.env.seller',
);
const env = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...loadEnvFile(seller),
  ...process.env,
};

function pick(...keys) {
  for (const k of keys) {
    const v = String(env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

const cscLink = pick('CSC_LINK', 'WINDOWS_CSC_LINK');
const cscPass = pick('CSC_KEY_PASSWORD', 'WINDOWS_CSC_KEY_PASSWORD');
const publisher = pick('WIN_CSC_PUBLISHER_NAME');
const thumb = pick('WIN_CSC_CERTIFICATE_SHA1').replace(/[^a-fA-F0-9]/g, '');

const failures = [];

if (!cscLink) {
  failures.push('CSC_LINK / WINDOWS_CSC_LINK missing (path to .pfx or base64 secret)');
} else if (!cscLink.includes('BEGIN') && !/^https?:/i.test(cscLink)) {
  // Local path — must exist (base64 blobs skip)
  const p = path.isAbsolute(cscLink) ? cscLink : path.resolve(root, cscLink);
  if (!fs.existsSync(p)) failures.push(`CSC_LINK file not found: ${p}`);
}
if (!cscPass) failures.push('CSC_KEY_PASSWORD / WINDOWS_CSC_KEY_PASSWORD missing');
if (!publisher) failures.push('WIN_CSC_PUBLISHER_NAME missing (exact certificate CN)');
if (thumb.length !== 40) {
  failures.push(
    `WIN_CSC_CERTIFICATE_SHA1 must be 40 hex chars (got ${thumb.length || 0})`,
  );
}

// public.env commercial defaults
const publicEnv = loadEnvFile(
  path.join(root, 'resources', 'commercial', 'public.env'),
);
// Unsigned installs/updates are ALLOWED by product standard.
// Signing is preferred for wide distribution but not required for install.
if (String(publicEnv.AINOVEL_ENTITLEMENT_MODE || '').trim() !== 'enforce') {
  failures.push('public.env AINOVEL_ENTITLEMENT_MODE must be enforce');
}
if (String(publicEnv.AINOVEL_UPDATE_PROVIDER || '').trim() !== 'github') {
  failures.push('public.env AINOVEL_UPDATE_PROVIDER must be github for commercial ship');
}

const standardPath = path.join(
  root,
  'resources',
  'commercial',
  'PACKAGING_STANDARD.json',
);
if (!fs.existsSync(standardPath)) {
  failures.push('resources/commercial/PACKAGING_STANDARD.json missing');
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        gate: 'assert-commercial-signing',
        failures,
        hint: [
          'Buy/install Windows Code Signing cert (.pfx).',
          'Set CSC_LINK, CSC_KEY_PASSWORD, WIN_CSC_PUBLISHER_NAME, WIN_CSC_CERTIFICATE_SHA1.',
          'See resources/commercial/PACKAGING_STANDARD.md and docs/COMMERCIAL_GO_LIVE.md',
          'QA only (not commercial): npm run pack:unsigned:qa',
        ],
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'assert-commercial-signing',
      publisher,
      thumbprintPrefix: thumb.slice(0, 8) + '…',
      csc: cscLink.length > 48 ? cscLink.slice(0, 24) + '…' : cscLink,
    },
    null,
    2,
  ),
);
