/**
 * Shared auth for /api/cloud/ip/* routes hosted on Vercel.
 *
 * License one-path (docs/LICENSE_ONE_PATH.md):
 * - Token = ticket (Ed25519), never content/AES key material
 * - Crown IP runs here after verify — cloud_ip_execution
 * - No daily request quota (product rejected)
 *
 * Tokens are device-bound (HWID in claims). Verification must NOT compare
 * against the Vercel host machine HWID — only signature, exp, and optional
 * body.hwid vs claim.hwid.
 */
import {
  extractEntitlementToken,
  verifyEntitlementToken,
  type EntitlementClaims,
} from '@/lib/entitlement';
import {
  canAccessFeature,
  resolvePlanTier,
  type CommercialFeatureId,
  type PlanTier,
} from '@/lib/commercial/featureMatrix';
import { assertApprovedContentUnlock } from '@/lib/commercial/licenseOnePath';
import { AppError } from '@/lib/errors';

/** Policy pin: all /api/cloud/ip/* share this unlock method. */
assertApprovedContentUnlock('cloud_ip_execution', 'cloudIpAuth');

const TIER_RANK: Record<PlanTier, number> = { free: 0, trial: 1, pro: 2 };

export function claimsToTier(claims: EntitlementClaims): PlanTier {
  return resolvePlanTier({
    is_pro: claims.is_pro,
    is_vip: claims.is_vip,
    is_trial: claims.is_trial,
  });
}

export function assertCloudIpToken(
  req: Request,
  body: unknown,
  minTier: PlanTier,
): EntitlementClaims {
  const token = extractEntitlementToken(req, body);
  if (!token) {
    throw new AppError('Thiếu license token (x-ainovel-entitlement).', {
      code: 'AUTH',
      status: 403,
    });
  }
  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims || (!claims.is_pro && !claims.is_vip && !claims.is_trial)) {
    throw new AppError(
      'License token không verify (chữ ký/hết hạn) hoặc không phải Trial/Pro.',
      { code: 'AUTH', status: 403 },
    );
  }
  const bodyHwid =
    body &&
    typeof body === 'object' &&
    'hwid' in body &&
    typeof (body as { hwid?: string }).hwid === 'string'
      ? String((body as { hwid: string }).hwid).trim().toLowerCase()
      : '';
  if (bodyHwid && claims.hwid && bodyHwid !== claims.hwid.toLowerCase()) {
    throw new AppError('HWID body không khớp license token.', {
      code: 'AUTH',
      status: 403,
    });
  }
  const tier = claimsToTier(claims);
  if (TIER_RANK[tier] < TIER_RANK[minTier]) {
    throw new AppError(
      `Cloud IP cần gói ≥ ${minTier} (hiện: ${tier}).`,
      { code: 'AUTH', status: 403 },
    );
  }
  return claims;
}

export function assertCloudIpFeature(
  claims: EntitlementClaims,
  featureId: CommercialFeatureId,
): void {
  const tier = claimsToTier(claims);
  if (!canAccessFeature(tier, featureId)) {
    throw new AppError(
      `Cloud IP «${featureId}» cần gói cao hơn (hiện: ${tier}).`,
      { code: 'AUTH', status: 403 },
    );
  }
}

/** Attach client HWID for cloud IP posts when available. */
export async function clientHwidPayload(): Promise<{ hwid?: string }> {
  try {
    const { getHwid } = await import('@/lib/entitlement');
    const hwid = getHwid();
    return hwid ? { hwid } : {};
  } catch {
    return {};
  }
}
