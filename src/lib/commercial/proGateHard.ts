/**
 * Dual-path Pro / feature gate — independent of a single nop'd assert*.
 * All paid commercial routes should enter via apiGate → these helpers.
 *
 * Stack: packaged multi-signal → integrity → anti-tamper → Ed25519 re-verify
 * → assertPro / assertFeature → heartbeat → re-check.
 */
import {
  assertVerificationKeyringReady,
  extractEntitlementToken,
  verifyEntitlementToken,
  assertProAccess,
  assertFeatureAccess,
  type EntitlementClaims,
} from '@/lib/entitlement';
import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';
import { assertAntiTamper } from '@/lib/commercial/antiTamper';
import { enforcePackagedHeartbeat } from '@/lib/commercial/licenseHeartbeat';
import { assertRuntimeIntegrity } from '@/lib/commercial/runtimeIntegrity';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import { AppError } from '@/lib/errors';

function isEnforceContext(): boolean {
  return (
    isPackagedCustomerRuntime() ||
    process.env.AINOVEL_ENTITLEMENT_MODE === 'enforce'
  );
}

/**
 * Independent token re-verify (second code path — harder to single-nop).
 * On enforce/packaged: bad header token is hard deny (no fall-through to open).
 */
function reVerifyTokenIndependent(req: Request, body?: unknown): string | null {
  const token = extractEntitlementToken(req, body);
  if (!token) return null;

  const direct = verifyEntitlementToken(token, { requireHwidMatch: true });
  if (
    direct &&
    !direct.is_pro &&
    !direct.is_vip &&
    !direct.is_trial
  ) {
    throw new AppError('Token không cấp quyền Pro/Trial.', {
      code: 'AUTH',
      status: 403,
    });
  }
  if (!direct && isEnforceContext()) {
    throw new AppError(
      'License token không verify (chữ ký/HWID/hết hạn).',
      { code: 'AUTH', status: 403 },
    );
  }
  return token;
}

function reCheckClaimsAfter(token: string | null): void {
  if (!token) return;
  const again = verifyEntitlementToken(token, { requireHwidMatch: true });
  if (
    again &&
    !again.is_pro &&
    !again.is_vip &&
    !again.is_trial
  ) {
    throw new AppError('License re-check thất bại.', {
      code: 'AUTH',
      status: 403,
    });
  }
}

/**
 * Hard Pro/Trial gate for premium APIs (video, CapCut, ship, …).
 */
export async function assertPremiumAccessHard(
  req: Request,
  body?: unknown,
): Promise<EntitlementClaims> {
  assertRuntimeIntegrity('proGateHard');
  assertVerificationKeyringReady();
  assertAntiTamper('proGateHard');

  const token = reVerifyTokenIndependent(req, body);
  const claims = await assertProAccess(req, body);
  await enforcePackagedHeartbeat(req, body, claims);
  if (token) {
    const { enforceSeatPresence } = await import('@/lib/commercial/seatPresence');
    const { enforceHwidRebind } = await import('@/lib/commercial/hwidRebind');
    enforceSeatPresence(claims, token);
    enforceHwidRebind(token);
  }
  reCheckClaimsAfter(token);
  return claims;
}

/**
 * Hard feature-matrix gate — same dual-path stack as premium, then feature check.
 * Used by requireFeature so navtools/integrations/TTS premium share one hard mesh.
 */
export async function assertFeatureAccessHard(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<EntitlementClaims> {
  assertRuntimeIntegrity(`featureHard:${featureId}`);
  assertVerificationKeyringReady();
  assertAntiTamper(`featureHard:${featureId}`);

  const token = reVerifyTokenIndependent(req, body);
  // assertFeatureAccess already does matrix + heartbeat + strict online
  const claims = await assertFeatureAccess(req, featureId, body);
  // Extra heartbeat pass (independent import path)
  await enforcePackagedHeartbeat(req, body, claims);
  if (token) {
    const { enforceSeatPresence } = await import('@/lib/commercial/seatPresence');
    const { enforceHwidRebind } = await import('@/lib/commercial/hwidRebind');
    enforceSeatPresence(claims, token);
    enforceHwidRebind(token);
  }
  reCheckClaimsAfter(token);
  return claims;
}
