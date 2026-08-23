/** Commercial smoke against the real Ed25519 entitlement implementation. */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getEntitlementMode,
  getEntitlementPublicStatus,
  getHwid,
  getHwidCandidates,
  getHwidV1,
  issueEntitlementToken,
  resolveEntitlementSigningKey,
  resolveEntitlementVerificationKeys,
  verifyEntitlementToken,
} from '../src/lib/entitlement.ts';
import {
  canAccessFeature,
  FREE_TTS_PLATFORMS,
  resolvePlanTier,
  SERVER_GATED_FEATURES,
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
  delete process.env.AINOVEL_PUBLISH;

  assert.ok(resolveEntitlementSigningKey().ok);
  assert.ok(resolveEntitlementVerificationKeys().ok);
  assert.ok(getEntitlementPublicStatus().readyForCommercial);

  // OPEN app: mode stays 'open' even when packaged/publish hints are set —
  // mọi user dùng mọi tính năng miễn phí, không bao giờ enforce.
  process.env.AINOVEL_ENTITLEMENT_MODE = 'open';
  process.env.AI_NOVEL_PACKAGED = '1';
  assert.equal(getEntitlementMode(), 'open');
  delete process.env.AI_NOVEL_PACKAGED;
  process.env.AINOVEL_PUBLISH = '1';
  assert.equal(getEntitlementMode(), 'open');
  delete process.env.AINOVEL_PUBLISH;
  process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
  // Even if someone tries enforce → still open (app is fully free)
  assert.equal(getEntitlementMode(), 'open');

  const hwid = getHwid();
  const candidates = getHwidCandidates();
  assert.ok(candidates.includes(hwid.toLowerCase()));
  assert.ok(candidates.includes(getHwidV1().toLowerCase()));

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

  // Dual-accept: v1-bound token still verifies on this machine
  const tokenV1 = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    hwid: getHwidV1(),
    expSeconds: 3600,
  });
  assert.ok(verifyEntitlementToken(tokenV1, { requireHwidMatch: true })?.is_pro);

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

  // OPEN app: mọi tier resolve về 'pro'; mọi tính năng mở cho mọi user.
  assert.equal(resolvePlanTier({ is_vip: true }), 'pro');
  assert.equal(resolvePlanTier({ is_pro: true, is_trial: true }), 'pro');
  assert.equal(resolvePlanTier({ is_pro: false }), 'pro');
  assert.equal(canAccessFeature('free', 'gen_video'), true);
  assert.equal(canAccessFeature('trial', 'gen_video'), true);
  assert.equal(canAccessFeature('trial', 'integrations_pipeline'), true);
  assert.equal(canAccessFeature('pro', 'integrations_pipeline'), true);
  assert.equal(canAccessFeature('free', 'tts_premium'), true);
  assert.equal(canAccessFeature('trial', 'tts_premium'), true);
  assert.equal(canAccessFeature('free', 'toolbox_labs'), true);
  assert.ok(FREE_TTS_PLATFORMS.has('edge_tts'));
  assert.ok(FREE_TTS_PLATFORMS.has('piper'));
  // OPEN app: LA Studio cũng mở miễn phí
  assert.ok(FREE_TTS_PLATFORMS.has('la_studio'));
  // Không còn feature nào bị gate server
  assert.equal(SERVER_GATED_FEATURES.length, 0);

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

  console.log(JSON.stringify({ ok: true, algorithm: 'Ed25519', hwid, tier: claims?.plan, mode: getEntitlementMode() }));
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
