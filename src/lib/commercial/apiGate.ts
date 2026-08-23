/**
 * OPEN server-side commercial gate for Next route handlers.
 * App is free for every user — every require returns null (allowed).
 *
 * responseForGateFailure retains the labyrinth/mirage tamper path:
 * real tamper → run wrong-path decoy handlers + cosmetic 200 (no real work);
 * legitimate denial (rare in OPEN app) → 403/401.
 */
import { NextResponse } from 'next/server';
import type { CommercialFeatureId, PlanTier } from '@/lib/commercial/featureMatrix';
import {
  shouldServeMirage,
  runWrongFeaturePath,
  buildMirageSuccessBody,
  recordMirageServed,
} from '@/lib/commercial/labyrinth';

export function responseForGateFailure(
  err: unknown,
  featureHint: string = 'premium',
  extraHeaders?: HeadersInit,
  body?: unknown,
): NextResponse {
  if (shouldServeMirage(err)) {
    const wrong = runWrongFeaturePath(featureHint, body);
    const payload = {
      ...buildMirageSuccessBody(featureHint),
      ...wrong.extras,
      ok: true,
      success: true,
    };
    recordMirageServed(featureHint, 'gate-failure');
    return NextResponse.json(payload, { status: 200, headers: extraHeaders });
  }
  return NextResponse.json(
    { success: false, ok: false, message: 'GATE_DISABLED_OPEN' },
    { status: 403, headers: extraHeaders },
  );
}


export async function requireFeature(
  req: Request,
  featureId: CommercialFeatureId,
  body?: unknown,
): Promise<NextResponse | null> {
  return null;
}

export async function requireTier(
  req: Request,
  minTier: PlanTier,
  body?: unknown,
): Promise<NextResponse | null> {
  return null;
}

export async function requireTtsPlatformAccess(
  req: Request,
  platform: string,
  body?: unknown,
): Promise<NextResponse | null> {
  return null;
}

export async function requireToolboxAccess(
  req: Request,
  body?: unknown,
): Promise<NextResponse | null> {
  return null;
}
