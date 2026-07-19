/**
 * Verify entitlement token (client activation check).
 * Body optional: { token?: string } — else reads header x-ainovel-entitlement.
 */
import { NextResponse } from 'next/server';
import {
  extractEntitlementToken,
  getEntitlementMode,
  getEntitlementPublicStatus,
  getHwid,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const token =
      (typeof body.token === 'string' && body.token.trim()) ||
      extractEntitlementToken(req, body) ||
      '';
    const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
    const status = getEntitlementPublicStatus();
    if (!claims) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          mode: status.mode,
          hwid: status.hwid,
          error:
            'Token không hợp lệ, hết hạn, hoặc không khớp HWID máy này.',
        },
        { status: 401 },
      );
    }
    return NextResponse.json({
      ok: true,
      valid: true,
      mode: status.mode,
      hwid: status.hwid,
      claims: {
        is_pro: claims.is_pro,
        is_vip: claims.is_vip,
        exp: claims.exp,
        expIso: new Date(claims.exp * 1000).toISOString(),
        hwidBound: Boolean(claims.hwid),
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  const token = extractEntitlementToken(req);
  const claims = token
    ? verifyEntitlementToken(token, { requireHwidMatch: true })
    : null;
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    localHwid: getHwid(),
    tokenPresent: Boolean(token),
    tokenValid: Boolean(claims),
    claims: claims
      ? {
          is_pro: claims.is_pro,
          is_vip: claims.is_vip,
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        }
      : null,
    mode: getEntitlementMode(),
  });
}
