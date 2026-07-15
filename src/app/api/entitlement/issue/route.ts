/**
 * Issue HMAC entitlement token (desktop/admin).
 * Only available when not in enforce-only lockdown without secret.
 * Body: { is_pro?: boolean, is_vip?: boolean, expSeconds?: number }
 */
import { NextResponse } from 'next/server';
import {
  getEntitlementMode,
  issueEntitlementToken,
} from '@/lib/entitlement';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      is_pro?: boolean;
      is_vip?: boolean;
      expSeconds?: number;
      adminKey?: string;
    };

    // Optional admin gate when enforcing
    if (getEntitlementMode() === 'enforce') {
      const admin = process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '';
      if (admin && body.adminKey !== admin) {
        throw new AppError('Forbidden: admin key required to issue tokens', {
          code: 'AUTH',
          status: 403,
        });
      }
    }

    const token = issueEntitlementToken({
      is_pro: body.is_pro !== false,
      is_vip: body.is_vip !== false,
      expSeconds: body.expSeconds,
    });

    return NextResponse.json({
      ok: true,
      mode: getEntitlementMode(),
      token,
      header: 'x-ainovel-entitlement',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  return NextResponse.json({
    mode: getEntitlementMode(),
    open: getEntitlementMode() === 'open',
    hint:
      getEntitlementMode() === 'open'
        ? 'Dev/desktop: Pro routes allowed without token'
        : 'Enforce: send x-ainovel-entitlement or body.entitlementToken',
  });
}
