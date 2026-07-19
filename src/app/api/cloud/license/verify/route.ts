/**
 * POST — online license verify / heartbeat (HMAC + optional Supabase revoke).
 * Body: { token, hwid? }
 */
import { NextResponse } from 'next/server';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { verifyLicenseCloud } from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      hwid?: string;
    };
    const token = (body.token || '').trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, valid: false, error: 'Thiếu token' },
        { status: 400 },
      );
    }

    const service = isSupabaseAdminConfigured()
      ? createServiceSupabase()
      : null;

    const result = await verifyLicenseCloud({
      service,
      token,
      hwid: body.hwid,
    });

    return NextResponse.json({
      ok: result.valid,
      valid: result.valid,
      claims: result.claims
        ? {
            is_pro: result.claims.is_pro,
            is_vip: result.claims.is_vip,
            exp: result.claims.exp,
            expIso: new Date(result.claims.exp * 1000).toISOString(),
            hwid: result.claims.hwid || null,
          }
        : null,
      cloud: result.cloud,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
