/**
 * Activate: paste HMAC token OR redeem AINOVEL-**** activation code.
 * Body: { token?: string, code?: string, hwid?: string }
 */
import { NextResponse } from 'next/server';
import {
  getEntitlementMode,
  getEntitlementPublicStatus,
  getHwid,
  resolveEntitlementSecret,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { redeemActivationCode } from '@/lib/commercial/activationVault';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      code?: string;
      hwid?: string;
    };
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();
    const mode = getEntitlementMode();

    // Prefer activation code
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (code) {
      if (mode === 'enforce') {
        const sec = resolveEntitlementSecret();
        if (!sec.ok) {
          throw new AppError(sec.reason || 'Secret misconfigured', {
            code: 'INFRA',
            status: 503,
          });
        }
      }
      const redeemed = redeemActivationCode(code, hwid);
      if (!redeemed.ok || !redeemed.token) {
        throw new AppError(redeemed.error || 'Redeem thất bại', {
          code: 'AUTH',
          status: 400,
        });
      }
      const claims = verifyEntitlementToken(redeemed.token, {
        requireHwidMatch: true,
      });
      return NextResponse.json({
        ok: true,
        kind: 'code',
        token: redeemed.token,
        plan: redeemed.plan,
        alreadyRedeemedSameMachine: !!redeemed.alreadyRedeemedSameMachine,
        claims: claims
          ? {
              is_pro: claims.is_pro,
              is_vip: claims.is_vip,
              exp: claims.exp,
              expIso: new Date(claims.exp * 1000).toISOString(),
            }
          : null,
        hwid,
        storeHint: 'Lưu token vào localStorage.ainovel.entitlementToken',
      });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      throw new AppError('Cần token HMAC hoặc mã AINOVEL-…', {
        code: 'VALIDATION',
        status: 400,
      });
    }

    const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
    if (!claims || (!claims.is_pro && !claims.is_vip)) {
      // open mode: still accept structurally valid tokens; reject garbage
      if (mode === 'open') {
        // allow storing even if secret differs in open? No — still verify sig
      }
      throw new AppError(
        'Token không hợp lệ, hết hạn, hoặc không khớp HWID máy này.',
        { code: 'AUTH', status: 401 },
      );
    }

    return NextResponse.json({
      ok: true,
      kind: 'token',
      token,
      claims: {
        is_pro: claims.is_pro,
        is_vip: claims.is_vip,
        exp: claims.exp,
        expIso: new Date(claims.exp * 1000).toISOString(),
      },
      hwid,
      storeHint: 'Lưu token vào localStorage.ainovel.entitlementToken',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    activate: {
      token: 'POST { token }',
      code: 'POST { code: "AINOVEL-…" }',
    },
  });
}
