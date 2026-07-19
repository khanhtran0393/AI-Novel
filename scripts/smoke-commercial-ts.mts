/** Commercial smoke against the real Ed25519 entitlement implementation. */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getEntitlementPublicStatus,
  getHwid,
  issueEntitlementToken,
  resolveEntitlementSigningKey,
  resolveEntitlementVerificationKeys,
  verifyEntitlementToken,
} from '../src/lib/entitlement.ts';
import {
  canAccessFeature,
  resolvePlanTier,
} from '../src/lib/commercial/featureMatrix.ts';
import {
  createActivationCodes,
  redeemActivationCode,
  releaseSeat,
} from '../src/lib/commercial/activationVault.ts';
import { getSeatSummary } from '../src/lib/commercial/multiSeat.ts';
import { getTrialStatus, startTrial } from '../src/lib/commercial/trial.ts';
import { issueHmacForPlan, verifyLicenseCloud } from '../src/lib/cloud/licenseBridge.ts';

const keys = crypto.generateKeyPairSync('ed25519');
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-commercial-'));
const saved = { ...process.env };

async function main() {
  process.env.AINOVEL_DATA_ROOT = smokeRoot;
  process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
  process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = privatePem;
  process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = publicPem;
  process.env.AINOVEL_TRIAL_ENABLED = '1';
  delete process.env.AI_NOVEL_PACKAGED;

  assert.ok(resolveEntitlementSigningKey().ok);
  assert.ok(resolveEntitlementVerificationKeys().ok);
  assert.ok(getEntitlementPublicStatus().readyForCommercial);

  const hwid = getHwid();
  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid,
    expSeconds: 3600,
  });
  assert.ok(token.startsWith('AINOVEL2.'));
  const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
  assert.equal(claims?.plan, 'pro');
  assert.equal(claims?.is_vip, false);
  const tokenParts = token.split('.');
  const signature = tokenParts.at(-1) || '';
  tokenParts[tokenParts.length - 1] = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  assert.equal(verifyEntitlementToken(tokenParts.join('.')), null);

  const wrongMachine = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid: '0000000000000000',
    expSeconds: 3600,
  });
  assert.equal(verifyEntitlementToken(wrongMachine, { requireHwidMatch: true }), null);

  assert.equal(resolvePlanTier({ is_vip: true }), 'pro');
  assert.equal(resolvePlanTier({ is_pro: true, is_trial: true }), 'trial');
  assert.equal(canAccessFeature('free', 'gen_video'), false);
  assert.equal(canAccessFeature('trial', 'gen_video'), true);
  assert.equal(canAccessFeature('trial', 'integrations_pipeline'), false);
  assert.equal(canAccessFeature('pro', 'integrations_pipeline'), true);

  const code = createActivationCodes({ count: 1, plan: 'pro', maxSeats: 2 })[0];
  assert.ok(code.code.startsWith('AINOVEL-'));
  assert.ok(redeemActivationCode(code.code, 'aaaaaaaaaaaaaaaa').ok);
  assert.ok(redeemActivationCode(code.code, 'bbbbbbbbbbbbbbbb').ok);
  assert.equal(redeemActivationCode(code.code, 'cccccccccccccccc').ok, false);
  assert.ok(releaseSeat(code.code, 'aaaaaaaaaaaaaaaa').ok);
  assert.ok(redeemActivationCode(code.code, 'cccccccccccccccc').ok);
  assert.equal(getSeatSummary(code.code).used, 2);

  assert.ok(startTrial(hwid).ok);
  assert.ok(getTrialStatus(hwid).used);

  const issued = issueHmacForPlan('month', hwid);
  const cloud = await verifyLicenseCloud({ service: null, token: issued.token, hwid });
  assert.equal(cloud.valid, true);

  process.env.AI_NOVEL_PACKAGED = '1';
  process.env.AINOVEL_ALLOW_LOCAL_TRIAL = '0';
  assert.equal(getTrialStatus('dddddddddddddddd').enabled, false);

  console.log(JSON.stringify({ ok: true, algorithm: 'Ed25519', hwid, tier: claims?.plan }));
  console.log('PASS smoke-commercial-ts');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env = saved;
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  });
