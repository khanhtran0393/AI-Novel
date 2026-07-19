/**
 * Smoke: host pin + fail-closed keyring + fake host reject.
 */
import assert from 'assert';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runTs(code, env = {}) {
  const r = spawnSync(
    'npx',
    ['--yes', 'tsx', '-e', code],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      shell: true,
    },
  );
  return r;
}

// 1) Official host accepted
{
  const r = runTs(
    `
import { resolvePinnedLicenseApiUrl, getPinnedLicenseHosts } from './src/lib/commercial/licenseTrust.ts';
process.env.AINOVEL_LICENSE_API_URL = 'https://ai-novel-flax.vercel.app';
const u = resolvePinnedLicenseApiUrl();
console.log(JSON.stringify({ host: u.hostname, pins: getPinnedLicenseHosts() }));
`,
    { AI_NOVEL_PACKAGED: '1', AINOVEL_PUBLISH: '1' },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(r.stdout.includes('ai-novel-flax.vercel.app'), r.stdout);
  console.log('PASS host pin accept official');
}

// 2) Rogue host rejected on packaged
{
  const r = runTs(
    `
import { resolvePinnedLicenseApiUrl } from './src/lib/commercial/licenseTrust.ts';
process.env.AINOVEL_LICENSE_API_URL = 'https://evil-license.example.org';
try {
  resolvePinnedLicenseApiUrl();
  console.log('UNEXPECTED_OK');
  process.exit(2);
} catch (e) {
  console.log('REJECTED:' + (e instanceof Error ? e.message : e));
}
`,
    { AI_NOVEL_PACKAGED: '1', AINOVEL_PUBLISH: '1' },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(r.stdout.includes('REJECTED:'), r.stdout);
  assert.ok(!r.stdout.includes('UNEXPECTED_OK'), r.stdout);
  console.log('PASS host pin reject rogue');
}

// 3) Fail-closed keyring when packaged and no keys
{
  const r = runTs(
    `
import { resolveEntitlementVerificationKeys, assertVerificationKeyringReady } from './src/lib/entitlement.ts';
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS_DIR = 'C:\\\\no-such-keyring-dir-ainovel';
delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY;
delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY_FILE;
delete process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEYS;
delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY;
delete process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_FILE;
const v = resolveEntitlementVerificationKeys();
console.log('ok=' + v.ok);
console.log('reason=' + (v.reason || ''));
try {
  assertVerificationKeyringReady();
  console.log('ASSERT_OK');
} catch (e) {
  console.log('ASSERT_FAIL');
}
`,
    {
      AI_NOVEL_PACKAGED: '1',
      AINOVEL_PUBLISH: '1',
      AINOVEL_ENTITLEMENT_MODE: 'enforce',
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(r.stdout.includes('ok=false'), r.stdout);
  assert.ok(r.stdout.includes('FAIL-CLOSED') || r.stdout.includes('ASSERT_FAIL'), r.stdout);
  console.log('PASS fail-closed empty keyring');
}

console.log(JSON.stringify({ ok: true, smoke: 'license-trust' }));
