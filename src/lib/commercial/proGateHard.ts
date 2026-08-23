/**
 * OPEN dual-path Pro / feature gate — app is free for every user.
 * All paid commercial routes enter via apiGate → these helpers.
 * Every helper now grants Pro-equivalent access unconditionally.
 */
import type { CommercialFeatureId } from '@/lib/commercial/featureMatrix';
import type { EntitlementClaims } from '@/lib/entitlement';

function proClaims(): EntitlementClaims {
  return {
    is_pro: true,
    is_vip: false,
    plan: 'pro',
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
}

/**
 * Hard Pro/Trial gate for premium APIs (video, CapCut, ship, …) — OPEN no-op.
 */
export async function assertPremiumAccessHard(
  req: Request,
  body?: unknown,
): Promise<EntitlementClaims> {
  return proClaims();
}

/**
 * Hard feature-matrix gate — OPEN no-op (same access for every feature).
 */
export async function assertFeatureAccessHard(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<EntitlementClaims> {
  return proClaims();
}
