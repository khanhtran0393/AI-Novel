/**
 * Diag: trial vault active + Pro token → status tier must be pro (local authority).
 */
import assert from 'assert';
import {
  claimsIsTrial,
  getHwid,
  issueEntitlementToken,
  verifyEntitlementToken,
} from '../src/lib/entitlement.ts';
import { resolvePlanTier } from '../src/lib/commercial/featureMatrix.ts';
import { getTrialStatus, startTrial } from '../src/lib/commercial/trial.ts';

const hwid = getHwid();
const started = startTrial(hwid);
console.log('startTrial', {
  ok: started.ok,
  active: getTrialStatus(hwid).active,
  tokenPrefix: started.token?.slice(0, 24),
});

const trialTok = started.token || '';
const trialClaims = trialTok
  ? verifyEntitlementToken(trialTok, { requireHwidMatch: true })
  : null;
console.log('trialClaims', trialClaims);

function resolveLocal(claims: ReturnType<typeof verifyEntitlementToken>) {
  const tokenIsTrial = claimsIsTrial(claims);
  const paidPro =
    !!claims && !tokenIsTrial && !!(claims.is_pro || claims.is_vip);
  const vaultTrial =
    getTrialStatus(hwid).active && !paidPro && !tokenIsTrial;
  const tier = resolvePlanTier({
    openMode: false,
    ownerUnlimited: false,
    is_vip: false,
    is_trial: tokenIsTrial || vaultTrial,
    is_pro: paidPro || (!!claims?.is_vip && !tokenIsTrial),
    trialActive: tokenIsTrial || vaultTrial,
  });
  return { tokenIsTrial, paidPro, vaultTrial, tier, claims };
}

console.log('A trial token only:', resolveLocal(trialClaims));

const proTok = issueEntitlementToken({
  is_pro: true,
  is_vip: false,
  plan: 'pro',
  hwid,
  expSeconds: 86400 * 30,
});
const proClaims = verifyEntitlementToken(proTok, { requireHwidMatch: true });
console.log('proClaims', proClaims);
const withPro = resolveLocal(proClaims);
console.log('B pro token + vault still active:', withPro);
assert.equal(withPro.tier, 'pro', 'Pro token must beat local vault trial');
assert.equal(withPro.paidPro, true);
assert.equal(withPro.vaultTrial, false);

// Simulate LicenseModal refresh demote path
function modalWouldForceTrial(data: {
  tier: string;
  tokenValid: boolean;
  trialActive: boolean;
  claims: { is_pro?: boolean; is_trial?: boolean; plan?: string } | null;
}): 'pro' | 'trial' | 'free' {
  if (data.tier === 'free' || data.tokenValid === false) return 'free';
  if (
    data.tokenValid &&
    data.claims &&
    !data.claims.is_trial &&
    data.claims.plan !== 'trial' &&
    (data.claims.is_pro || data.claims.plan === 'pro')
  ) {
    return 'pro';
  }
  if (data.tier === 'pro' && data.tokenValid && data.claims) return 'pro';
  if (data.tier === 'trial' || data.trialActive) {
    if (
      data.tokenValid &&
      data.claims &&
      !data.claims.is_trial &&
      data.claims.plan !== 'trial' &&
      data.claims.is_pro
    ) {
      return 'pro';
    }
    return 'trial';
  }
  return 'free';
}

const statusLike = {
  tier: withPro.tier,
  tokenValid: true,
  trialActive: withPro.tier === 'trial',
  claims: {
    is_pro: !!proClaims?.is_pro,
    is_trial: !!proClaims?.is_trial,
    plan: proClaims?.plan,
  },
};
console.log('modalWouldForceTrial', modalWouldForceTrial(statusLike), statusLike);

// Bug repro: Pro activate OK but localStorage still has trial token (user didn't replace / race)
const stuckTrial = resolveLocal(trialClaims);
console.log('C stuck trial token after "activate" fail to replace:', stuckTrial);
assert.equal(stuckTrial.tier, 'trial');

console.log('PASS diag-trial-to-pro');
