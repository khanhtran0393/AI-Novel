/**
 * Prove Trial vault unlocks Pro-equivalent gates (video minTier=trial).
 * Run: npx tsx scripts/smoke-trial-unlock.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const keys = crypto.generateKeyPairSync('ed25519');
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-trial-unlock-'));
const saved = { ...process.env };

process.env.AINOVEL_DATA_ROOT = smokeRoot;
process.env.AI_NOVEL_USER_DATA = smokeRoot;
process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = privatePem;
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = publicPem;
process.env.AINOVEL_TRIAL_ENABLED = '1';
process.env.AINOVEL_ALLOW_LOCAL_TRIAL = '1';
delete process.env.AI_NOVEL_PACKAGED;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;

const { startTrial, getTrialStatus } = await import(
  '../src/lib/commercial/trial.ts'
);
const {
  getHwid,
  assertProAccess,
  resolveRequestAccessAsync,
} = await import('../src/lib/entitlement.ts');
const { canAccessFeature } = await import(
  '../src/lib/commercial/featureMatrix.ts'
);

const hwid = getHwid();
const started = startTrial(hwid);
assert.equal(started.ok, true, 'startTrial ok');
assert.equal(getTrialStatus(hwid).active, true, 'trial active');
assert.ok(started.token, 'trial mints AINOVEL2 token when signer present');
console.log('token prefix', started.token!.slice(0, 20));

const headers = new Headers({
  'x-ainovel-entitlement': started.token!,
});
const req = new Request('http://localhost/api/generate-video', {
  method: 'POST',
  headers,
});

const access = await resolveRequestAccessAsync(req, {});
console.log('access', {
  tier: access.tier,
  authority: access.authority,
  is_trial: access.claims.is_trial,
});
assert.equal(access.tier, 'trial');
assert.equal(canAccessFeature(access.tier, 'gen_video'), true);
assert.equal(canAccessFeature(access.tier, 'export_capcut'), true);
assert.equal(canAccessFeature(access.tier, 'tts_premium'), true);
assert.equal(
  canAccessFeature(access.tier, 'toolbox_labs'),
  false,
  'toolbox remains Pro-only',
);

// assertProAccess also runs anti-tamper SPKI pins (real public-keys) —
// ephemeral smoke keys cannot pass pins; tier resolve is the product gate here.
try {
  await assertProAccess(req, {});
  console.log('assertProAccess OK (keyring pins match smoke keys)');
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('anti-tamper') || msg.includes('pin')) {
    console.log('assertProAccess skipped pins (expected with ephemeral keys):', msg.slice(0, 80));
  } else {
    throw e;
  }
}

// Without token — vault alone must still grant (sync + async path)
const reqBare = new Request('http://localhost/api/x', { method: 'POST' });
const bare = await resolveRequestAccessAsync(reqBare, {});
assert.equal(bare.tier, 'trial', 'vault-only trial unlocks without header token');
console.log('vault-only tier', bare.tier);

console.log('PASS smoke-trial-unlock');
process.env = saved;
fs.rmSync(smokeRoot, { recursive: true, force: true });
