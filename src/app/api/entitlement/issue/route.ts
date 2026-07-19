/**
 * Issue HMAC entitlement token (seller / admin only).
 *
 * enforce mode: AINOVEL_ENTITLEMENT_ADMIN_KEY required on every request.
 * Body: { is_pro?, is_vip?, expSeconds?, hwid?, adminKey }
 */
import { NextResponse } from 'next/server';
import {
  getEntitlementMode,
  getEntitlementPublicStatus,
  issueEntitlementToken,
  resolveEntitlementSecret,
} from '@/lib/entitlement';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      is_pro?: boolean;
      is_vip?: boolean;
      expSeconds?: number;
      hwid?: string;
      adminKey?: string;
    };

    const mode = getEntitlementMode();
    const sec = resolveEntitlementSecret();
    if (mode === 'enforce' && !sec.ok) {
      throw new AppError(sec.reason || 'Secret misconfigured', {
        code: 'INFRA',
        status: 503,
      });
    }

    // Admin gate: always required in enforce; optional in open only if ADMIN_KEY set
    const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
    if (mode === 'enforce') {
      if (!admin) {
        throw new AppError(
          'Server misconfigured: đặt AINOVEL_ENTITLEMENT_ADMIN_KEY để cấp license.',
          { code: 'INFRA', status: 503 },
        );
      }
      if (body.adminKey !== admin) {
        throw new AppError('Forbidden: admin key sai hoặc thiếu.', {
          code: 'AUTH',
          status: 403,
        });
      }
    } else if (admin && body.adminKey !== admin) {
      // If admin key is configured even in open, still require it for issue
      throw new AppError('Forbidden: admin key required to issue tokens', {
        code: 'AUTH',
        status: 403,
      });
    }

    const hwid = typeof body.hwid === 'string' ? body.hwid.trim() : '';
    // Default Pro ON; VIP only when explicitly true
    const is_pro = body.is_pro !== false;
    const is_vip = body.is_vip === true;
    const token = issueEntitlementToken({
      is_pro,
      is_vip,
      expSeconds: body.expSeconds,
      ...(hwid ? { hwid } : {}),
    });

    const claimsPreview = {
      is_pro,
      is_vip,
      hwid: hwid || null,
      expSeconds: body.expSeconds ?? 60 * 60 * 24 * 30,
    };

    return NextResponse.json({
      ok: true,
      mode,
      token,
      header: 'x-ainovel-entitlement',
      claims: claimsPreview,
      hint: hwid
        ? 'Token gắn HWID — chỉ máy khớp mới verify được.'
        : 'Token không gắn HWID — dùng được mọi máy (ít an toàn hơn).',
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
    mode: status.mode,
    open: status.open,
    readyForCommercial: status.readyForCommercial,
    blockers: status.blockers,
    hint:
      status.mode === 'open'
        ? 'Dev/desktop: Pro routes allowed without token. Publish: set AINOVEL_ENTITLEMENT_MODE=enforce.'
        : 'Enforce: seller POST /api/entitlement/issue with adminKey; client sends x-ainovel-entitlement.',
  });
}
