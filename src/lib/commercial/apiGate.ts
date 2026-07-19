/**
 * Server-side commercial gate for Next route handlers.
 * Returns a NextResponse when access is denied; null when allowed.
 */
import { NextResponse } from 'next/server';
import {
  assertFeatureAccess,
  assertTierAtLeast,
} from '@/lib/entitlement';
import type { CommercialFeatureId, PlanTier } from '@/lib/commercial/featureMatrix';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

function denyResponse(err: unknown): NextResponse {
  return NextResponse.json(
    { success: false, ok: false, ...toErrorJson(err) },
    { status: httpStatusFromError(err) },
  );
}

/** Assert feature matrix access. null = ok; NextResponse = deny. */
export async function requireFeature(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    await assertFeatureAccess(req, featureId, body);
    return null;
  } catch (err) {
    return denyResponse(err);
  }
}

/** Assert minimum plan tier. */
export async function requireTier(
  req: Request,
  minTier: PlanTier,
  body?: unknown,
): Promise<NextResponse | null> {
  try {
    await assertTierAtLeast(req, minTier, body);
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
