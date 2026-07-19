/**
 * Public commercial status: mode, trial, feature matrix, pricing, update channel.
 * No secrets.
 */
import { NextResponse } from 'next/server';
import {
  claimsIsTrial,
  extractEntitlementToken,
  getEntitlementPublicStatus,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import {
  FEATURE_MATRIX,
  PRICING_PLANS,
  resolvePlanTier,
} from '@/lib/commercial/featureMatrix';
import { getTrialStatus } from '@/lib/commercial/trial';
import { shouldGrantOwnerUnlimited } from '@/lib/commercial/ownerMode';
import { getUpdatePublicStatus } from '@/lib/commercial/updateChannel';
import { supabaseConfigPublic } from '@/lib/supabase/env';
import { verifyLicenseCloud } from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const pub = getEntitlementPublicStatus();
  const trial = getTrialStatus();
  const token = extractEntitlementToken(req);
  let claims = token
    ? verifyEntitlementToken(token, { requireHwidMatch: true })
    : null;
  let cloudRevoked = false;

  // Online revoke check when Supabase admin configured
  if (token && isSupabaseAdminConfigured()) {
    try {
      const cloud = await verifyLicenseCloud({
        service: createServiceSupabase(),
        token,
      });
      if (cloud.cloud.revoked || cloud.cloud.status === 'expired') {
        claims = null;
        cloudRevoked = true;
      } else if (cloud.valid && cloud.claims && !claims) {
        // HWID mismatch on this machine vs token — keep null
      }
    } catch {
      /* offline cloud */
    }
  }

  const ownerUnlimited = shouldGrantOwnerUnlimited();
  const openMode = pub.mode === 'open';
  const tokenIsTrial = claimsIsTrial(claims);
  const paidPro =
    !!claims &&
    !tokenIsTrial &&
    !claims.is_vip &&
    !!claims.is_pro;
  // Vault trial when no paid VIP/Pro token (trial token still counts as trial)
  const vaultTrial = trial.active && !claims?.is_vip && !paidPro;

  const tier = resolvePlanTier({
    openMode: false, // UI tier from real license, not open-mode elevate
    ownerUnlimited,
    // Legacy VIP → paid pro
    is_vip: false,
    is_trial: tokenIsTrial || vaultTrial,
    is_pro: paidPro || (!!claims?.is_vip && !tokenIsTrial),
    trialActive: tokenIsTrial || vaultTrial,
  });

  const effectiveTrial = tier === 'trial';

  const sb = supabaseConfigPublic();

  return NextResponse.json({
    ok: true,
    entitlement: pub,
    trial: {
      enabled: trial.enabled,
      active: effectiveTrial || trial.active,
      used: trial.used,
      days: trial.days,
      endsAt: trial.record?.endsAt ?? (claims?.is_trial ? claims.exp : null),
      endsIso: trial.record
        ? new Date(trial.record.endsAt * 1000).toISOString()
        : claimsIsTrial(claims) && claims
          ? new Date(claims.exp * 1000).toISOString()
          : null,
      fromToken: tokenIsTrial,
      fromVault: trial.active,
    },
    ownerUnlimited,
    openMode,
    tier,
    claims: claims
      ? {
          is_pro: !!claims.is_pro || !!claims.is_vip,
          is_vip: false,
          is_trial: claimsIsTrial(claims),
          plan: claimsIsTrial(claims) ? 'trial' : claims.is_pro || claims.is_vip ? 'pro' : claims.plan || 'pro',
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        }
      : null,
    tokenPresent: Boolean(token),
    tokenValid: Boolean(claims),
    cloudRevoked,
    supabase: sb,
    features: FEATURE_MATRIX,
    pricing: PRICING_PLANS,
    update: getUpdatePublicStatus(),
    model: {
      name: 'License + BYOK + Free/Pro/Trial + optional Supabase cloud',
      byok: true,
      payment: 'Order cloud / Zalo → issue token HMAC',
      cloud: sb.adminConfigured,
    },
  });
}
