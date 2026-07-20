/**
 * Server-side commercial gate for Next route handlers.
 * Paid features use hard dual-path stack (integrity + anti-tamper + re-verify).
 *
 * Tamper → wrong-path handlers + mirage HTTP 200 (no real premium work).
 * Legitimate Free users → clear 403.
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
import {
  buildMirageSuccessBody,
  recordMirageServed,
  runWrongFeaturePath,
  shouldServeMirage,
  type MirageFeatureHint,
} from '@/lib/commercial/labyrinth';

/**
 * Tamper → run wrong-path decoy handlers + cosmetic 200.
 * Legitimate deny → 403 JSON.
 */
export function responseForGateFailure(
  err: unknown,
  featureHint: MirageFeatureHint = 'premium',
  extraHeaders?: HeadersInit,
  body?: unknown,
): NextResponse {
  if (shouldServeMirage(err)) {
    const wrong = runWrongFeaturePath(featureHint, body);
    recordMirageServed(String(featureHint), wrong.decoyDigest);
    return NextResponse.json(
      {
        ...buildMirageSuccessBody(featureHint),
        ...wrong.extras,
      },
      { status: 200, headers: extraHeaders },
    );
  }
  return NextResponse.json(
    { success: false, ok: false, ...toErrorJson(err) },
    { status: httpStatusFromError(err), headers: extraHeaders },
  );
}

export async function requireFeature(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccessHard(req, featureId, body);
    return null;
  } catch (err) {
    return responseForGateFailure(err, featureId, undefined, body);
  }
}

export async function requireTier(
  req: Request,
  minTier: PlanTier,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    if (minTier === 'free') return null;
    if (minTier === 'trial') {
      await assertPremiumAccessHard(req, body);
      return null;
    }
    assertRuntimeIntegrity('requireTier:pro');
    assertVerificationKeyringReady();
    assertAntiTamper('requireTier:pro');
    await assertPremiumAccessHard(req, body);
    await assertTierAtLeast(req, 'pro', body);
    return null;
  } catch (err) {
    return responseForGateFailure(err, 'premium', undefined, body);
  }
}

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

export async function requireToolboxAccess(
  req: Request,
  body?: unknown,
): Promise<NextResponse | null> {
  return requireFeature(req, 'toolbox_labs', body);
}
