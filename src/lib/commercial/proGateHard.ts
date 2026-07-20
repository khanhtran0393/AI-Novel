/**
 * Dual-path Pro / feature gate — independent of a single nop'd assert*.
 * All paid commercial routes should enter via apiGate → these helpers.
 *
 * Stack: packaged multi-signal → integrity → anti-tamper → Ed25519 re-verify
 * → assertPro / assertFeature → heartbeat → re-check.
 *
 * Labyrinth: multi-layer surface messages when tamper suspected (docs/LABYRINTH.md).
 * Legitimate token/tier failures stay single clear AppError.
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
import {
  denyThroughCascade,
  isTamperOrigin,
  originFromErrorMessage,
  sessionHasTamper,
  sessionKeyFromRequest,
  type FailOrigin,
} from '@/lib/commercial/labyrinth';

function isEnforceContext(): boolean {
  return (
    isPackagedCustomerRuntime() ||
    process.env.AINOVEL_ENTITLEMENT_MODE === 'enforce'
  );
}

function isTamperError(err: unknown): boolean {
  if (!(err instanceof AppError)) {
    const msg = err instanceof Error ? err.message : String(err);
    const o = originFromErrorMessage(msg);
    return o !== null && isTamperOrigin(o);
  }
  const d = err.details;
  if (d && typeof d === 'object' && (d as { labyrinth?: boolean }).labyrinth) {
    return true;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes('anti-tamper') ||
    msg.includes('integrity') ||
    msg.includes('canary') ||
    msg.includes('[integrity/')
  );
}

function rethrowGate(
  err: unknown,
  origin: FailOrigin,
  sessionKey: string,
): never {
  const tamper =
    isTamperError(err) ||
    isTamperOrigin(origin) ||
    sessionHasTamper(sessionKey, 1);

  denyThroughCascade({
    origin,
    sessionKey,
    tamperSuspected: tamper,
    originalError: err,
    detail:
      err instanceof Error
        ? err.message.slice(0, 160)
        : String(err).slice(0, 160),
  });
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
  const sessionKey = sessionKeyFromRequest(req, body);

  try {
    assertRuntimeIntegrity('proGateHard');
  } catch (err) {
    rethrowGate(err, 'integrity', sessionKey);
  }

  try {
    assertVerificationKeyringReady();
  } catch (err) {
    rethrowGate(err, 'keyring', sessionKey);
  }

  try {
    assertAntiTamper('proGateHard');
  } catch (err) {
    rethrowGate(err, 'anti_tamper', sessionKey);
  }

  let token: string | null = null;
  try {
    token = reVerifyTokenIndependent(req, body);
  } catch (err) {
    rethrowGate(err, 'token_verify', sessionKey);
  }

  let claims: EntitlementClaims;
  try {
    claims = await assertProAccess(req, body);
  } catch (err) {
    rethrowGate(err, 'pro_access', sessionKey);
  }

  try {
    await enforcePackagedHeartbeat(req, body, claims);
  } catch (err) {
    rethrowGate(err, 'heartbeat', sessionKey);
  }

  if (token) {
    try {
      const { enforceSeatPresence } = await import('@/lib/commercial/seatPresence');
      enforceSeatPresence(claims, token);
    } catch (err) {
      rethrowGate(err, 'seat', sessionKey);
    }
    try {
      const { enforceHwidRebind } = await import('@/lib/commercial/hwidRebind');
      enforceHwidRebind(token);
    } catch (err) {
      rethrowGate(err, 'hwid_rebind', sessionKey);
    }
  }

  try {
    reCheckClaimsAfter(token);
  } catch (err) {
    rethrowGate(err, 'recheck', sessionKey);
  }

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
  const sessionKey = sessionKeyFromRequest(req, body);

  try {
    assertRuntimeIntegrity(`featureHard:${featureId}`);
  } catch (err) {
    rethrowGate(err, 'integrity', sessionKey);
  }

  try {
    assertVerificationKeyringReady();
  } catch (err) {
    rethrowGate(err, 'keyring', sessionKey);
  }

  try {
    assertAntiTamper(`featureHard:${featureId}`);
  } catch (err) {
    rethrowGate(err, 'anti_tamper', sessionKey);
  }

  let token: string | null = null;
  try {
    token = reVerifyTokenIndependent(req, body);
  } catch (err) {
    rethrowGate(err, 'token_verify', sessionKey);
  }

  let claims: EntitlementClaims;
  try {
    // assertFeatureAccess already does matrix + heartbeat + strict online
    claims = await assertFeatureAccess(req, featureId, body);
  } catch (err) {
    rethrowGate(err, 'feature_access', sessionKey);
  }

  try {
    await enforcePackagedHeartbeat(req, body, claims);
  } catch (err) {
    rethrowGate(err, 'heartbeat', sessionKey);
  }

  if (token) {
    try {
      const { enforceSeatPresence } = await import('@/lib/commercial/seatPresence');
      enforceSeatPresence(claims, token);
    } catch (err) {
      rethrowGate(err, 'seat', sessionKey);
    }
    try {
      const { enforceHwidRebind } = await import('@/lib/commercial/hwidRebind');
      enforceHwidRebind(token);
    } catch (err) {
      rethrowGate(err, 'hwid_rebind', sessionKey);
    }
  }

  try {
    reCheckClaimsAfter(token);
  } catch (err) {
    rethrowGate(err, 'recheck', sessionKey);
  }

  return claims;
}
