/**
 * Server-side commercial gate for Next route handlers.
 * Paid features use hard dual-path stack (integrity + anti-tamper + re-verify).
 * Returns a NextResponse when access is denied; null when allowed.
 */
import { NextResponse } from 'next/server';
import {
  assertFeatureAccessHard,
  assertPremiumAccessHard,
} from '@/lib/commercial/proGateHard';
import { assertTierAtLeast } from '@/lib/entitlement';
import type { CommercialFeatureId, PlanTier } from '@/lib/commercial/featureMatrix';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import { assertRuntimeIntegrity } from '@/lib/commercial/runtimeIntegrity';
import { assertAntiTamper } from '@/lib/commercial/antiTamper';
import { assertVerificationKeyringReady } from '@/lib/entitlement';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

function denyResponse(err: unknown): NextResponse {
  return NextResponse.json(
    { success: false, ok: false, ...toErrorJson(err) },
    { status: httpStatusFromError(err) },
  );
}

/**
 * Assert feature matrix access via hard stack.
 * null = ok; NextResponse = deny.
 */
export async function requireFeature(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccessHard(req, featureId, body);
    return null;
  } catch (err) {
    return denyResponse(err);
  }
}

/**
 * Assert minimum plan tier.
 * Free: no hard stack. trial/pro: integrity + anti-tamper + dual-path premium when trial+.
 */
export async function requireTier(
  req: Request,
  minTier: PlanTier,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    if (minTier === 'free') {
      return null;
    }
    if (minTier === 'trial') {
      // Trial+ == premium hard path (video-grade)
      await assertPremiumAccessHard(req, body);
      return null;
    }
    // minTier pro: hard premium + explicit tier check after
    assertRuntimeIntegrity('requireTier:pro');
    assertVerificationKeyringReady();
    assertAntiTamper('requireTier:pro');
    await assertPremiumAccessHard(req, body);
    await assertTierAtLeast(req, 'pro', body);
    return null;
  } catch (err) {
    return denyResponse(err);
  }
}

/**
 * TTS: edge_tts + piper are free; all other platforms need tts_premium (trial+).
 */
export async function requireTtsPlatformAccess(
  req: Request,
  platform: string,
  body?: unknown,
): Promise<NextResponse | null> {
  const id = String(platform || '')
    .trim()
    .toLowerCase();
  if (!id || FREE_TTS_PLATFORMS.has(id)) return null;
  return requireFeature(req, 'tts_premium', body);
}

/**
 * Toolbox / Labs / CapAssistant / video tools — Pro mesh.
 * Convenience for routes that were previously ungated.
 */
export async function requireToolboxAccess(
  req: Request,
  body?: unknown,
): Promise<NextResponse | null> {
  return requireFeature(req, 'toolbox_labs', body);
}
