/**
 * Commercial smoke using real TS entitlement module.
 * Run: npx tsx scripts/smoke-commercial-ts.mts
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getEntitlementMode,
  getEntitlementPublicStatus,
  getHwid,
  isInsecureEntitlementSecret,
  issueEntitlementToken,
  resolveEntitlementSecret,
  verifyEntitlementToken,
} from '../src/lib/entitlement.ts';
import {
  canAccessFeature,
  resolvePlanTier,
} from '../src/lib/commercial/featureMatrix.ts';
import {
  createActivationCodes,
  redeemActivationCode,
} from '../src/lib/commercial/activationVault.ts';
import { startTrial, getTrialStatus } from '../src/lib/commercial/trial.ts';
import {
  authorizePaymentWebhook,
  processPaymentWebhook,
} from '../src/lib/commercial/paymentWebhook.ts';
import {
  hashToken,
  issueHmacForPlan,
  paidPlanToLicense,
  verifyLicenseCloud,
} from '../src/lib/cloud/licenseBridge.ts';
import { isSupabaseConfigured, supabaseConfigPublic } from '../src/lib/supabase/env.ts';

// Save env
const prevMode = process.env.AINOVEL_ENTITLEMENT_MODE;
const prevSec = process.env.AINOVEL_ENTITLEMENT_SECRET;
const prevAdmin = process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY;
const prevData = process.env.AINOVEL_DATA_ROOT;

// Isolate vault so smoke never pollutes commercial data/licenses
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeRoot = path.join(__dirname, '..', 'scratch', 'commercial-smoke-vault');
fs.mkdirSync(smokeRoot, { recursive: true });
process.env.AINOVEL_DATA_ROOT = smokeRoot;

async function main() {
  // open + weak secret allowed for dev default path
  process.env.AINOVEL_ENTITLEMENT_MODE = 'open';
  delete process.env.AINOVEL_ENTITLEMENT_SECRET;
  const openRes = resolveEntitlementSecret();
  assert.strictEqual(openRes.ok, true);

  // enforce without secret → not ok
  process.env.AINOVEL_ENTITLEMENT_MODE = 'enforce';
  delete process.env.AINOVEL_ENTITLEMENT_SECRET;
  const bad = resolveEntitlementSecret();
  assert.strictEqual(bad.ok, false);

  // enforce with forbidden default → not ok
  process.env.AINOVEL_ENTITLEMENT_SECRET =
    'ainovel-enterprise-commercial-secret-key-2026';
  assert.strictEqual(resolveEntitlementSecret().ok, false);

  // enforce with strong secret
  const strong = crypto.randomBytes(32).toString('hex');
  process.env.AINOVEL_ENTITLEMENT_SECRET = strong;
  process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY = crypto.randomBytes(16).toString('hex');
  assert.strictEqual(resolveEntitlementSecret().ok, true);
  assert.strictEqual(isInsecureEntitlementSecret(strong), false);

  const hwid = getHwid();
  assert.ok(hwid.length === 16);

  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    hwid,
    expSeconds: 3600,
  });
  const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
  assert.ok(claims?.is_pro);
  assert.strictEqual(claims?.hwid, hwid.toLowerCase());

  // wrong machine simulation: force different hwid in token
  const badTok = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    hwid: '0000000000000000',
    expSeconds: 3600,
  });
  assert.strictEqual(
    verifyEntitlementToken(badTok, { requireHwidMatch: true }),
    null,
  );

  const status = getEntitlementPublicStatus();
  assert.strictEqual(status.mode, 'enforce');
  assert.strictEqual(status.readyForCommercial, true);

  // Feature matrix
  assert.strictEqual(canAccessFeature('free', 'write_chapter'), true);
  assert.strictEqual(canAccessFeature('free', 'gen_video'), false);
  assert.strictEqual(canAccessFeature('pro', 'gen_video'), true);
  assert.strictEqual(resolvePlanTier({ is_pro: true }), 'pro');
  assert.strictEqual(resolvePlanTier({ trialActive: true }), 'trial');
  // Trial wins over is_pro (store often keeps both)
  assert.strictEqual(
    resolvePlanTier({ is_pro: true, is_trial: true }),
    'trial',
  );
  assert.strictEqual(
    resolvePlanTier({ is_pro: true, trialActive: true }),
    'trial',
  );
  assert.strictEqual(canAccessFeature('trial', 'gen_video'), true);
  assert.strictEqual(canAccessFeature('trial', 'integrations_pipeline'), false);
  assert.strictEqual(canAccessFeature('trial', 'toolbox_labs'), false);
  assert.strictEqual(canAccessFeature('pro', 'toolbox_labs'), true);

  // Activation code redeem
  const codes = createActivationCodes({
    count: 1,
    plan: 'pro',
    expSeconds: 3600,
    note: 'smoke',
  });
  assert.ok(codes[0]?.code.startsWith('AINOVEL-'));
  const redeemed = redeemActivationCode(codes[0].code, hwid);
  assert.ok(redeemed.ok && redeemed.token);
  const redeemedClaims = verifyEntitlementToken(redeemed.token, {
    requireHwidMatch: true,
  });
  assert.ok(redeemedClaims?.is_pro);

  // Trial start (may already exist from prior smoke — ok)
  const trial = startTrial(hwid);
  assert.ok(trial.ok);
  const trialSt = getTrialStatus(hwid);
  assert.ok(trialSt.used || trialSt.active);

  // Payment webhook auth + process
  process.env.AINOVEL_PAYMENT_WEBHOOK_SECRET = 'webhook-secret-at-least-24chars!!';
  const fakeReq = {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'x-ainovel-webhook-secret'
          ? 'webhook-secret-at-least-24chars!!'
          : null,
    },
  } as unknown as Request;
  const auth = authorizePaymentWebhook(fakeReq, {});
  assert.strictEqual(auth.ok, true);
  const paid = processPaymentWebhook({
    provider: 'generic',
    plan: 'pro',
    issueMode: 'code',
    orderId: `smoke_${Date.now()}`,
  });
  assert.ok(paid.ok && paid.codes && paid.codes.length === 1);

  // Cloud bridge pure (no live Supabase required)
  const meta = paidPlanToLicense('lifetime');
  assert.strictEqual(meta.amountVnd, 8_999_000);
  const issued = issueHmacForPlan('month', hwid);
  assert.ok(issued.token.includes('.'));
  assert.ok(hashToken(issued.token).length === 64);
  const cloudVerify = await verifyLicenseCloud({
    service: null,
    token: issued.token,
    hwid,
  });
  assert.strictEqual(cloudVerify.valid, true);
  const sbPub = supabaseConfigPublic();
  assert.strictEqual(typeof sbPub.configured, 'boolean');
  assert.strictEqual(isSupabaseConfigured(), sbPub.configured);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: getEntitlementMode(),
        hwid,
        readyForCommercial: status.readyForCommercial,
        tokenSampleLen: token.length,
        activationCode: codes[0].code,
        trialActive: trialSt.active,
        webhookCode: paid.codes?.[0],
        supabaseConfigured: sbPub.configured,
        cloudBridgeOk: true,
      },
      null,
      2,
    ),
  );
  console.log('PASS smoke-commercial-ts');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (prevMode === undefined) delete process.env.AINOVEL_ENTITLEMENT_MODE;
    else process.env.AINOVEL_ENTITLEMENT_MODE = prevMode;
    if (prevSec === undefined) delete process.env.AINOVEL_ENTITLEMENT_SECRET;
    else process.env.AINOVEL_ENTITLEMENT_SECRET = prevSec;
    if (prevAdmin === undefined) delete process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY;
    else process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY = prevAdmin;
    if (prevData === undefined) delete process.env.AINOVEL_DATA_ROOT;
    else process.env.AINOVEL_DATA_ROOT = prevData;
  });
