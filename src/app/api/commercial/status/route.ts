/**
 * Public commercial status: mode, trial, feature matrix, pricing, update channel.
 * No secrets.
 */
import { NextResponse } from 'next/server';
import {
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

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const pub = getEntitlementPublicStatus();
  const trial = getTrialStatus();
  const token = extractEntitlementToken(req);
  const claims = token
    ? verifyEntitlementToken(token, { requireHwidMatch: true })
    : null;
  const ownerUnlimited = shouldGrantOwnerUnlimited();
  const openMode = pub.mode === 'open';
  const tier = resolvePlanTier({
    openMode,
    ownerUnlimited,
    is_pro: claims?.is_pro,
    is_vip: claims?.is_vip,
    trialActive: trial.active,
  });

  return NextResponse.json({
    ok: true,
    entitlement: pub,
    trial: {
      enabled: trial.enabled,
      active: trial.active,
      used: trial.used,
      days: trial.days,
      endsAt: trial.record?.endsAt ?? null,
      endsIso: trial.record
        ? new Date(trial.record.endsAt * 1000).toISOString()
        : null,
    },
    ownerUnlimited,
    openMode,
    tier,
    claims: claims
      ? {
          is_pro: claims.is_pro,
          is_vip: claims.is_vip,
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        }
      : null,
    tokenPresent: Boolean(token),
    tokenValid: Boolean(claims),
    features: FEATURE_MATRIX,
    pricing: PRICING_PLANS,
    update: getUpdatePublicStatus(),
    model: {
      name: 'License + BYOK + Free/Pro/Trial',
      byok: true,
      payment: 'Webhook → activation code hoặc token HWID',
    },
  });
}
