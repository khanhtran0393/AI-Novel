/**
 * Seller admin: create / list activation codes.
 * Requires adminKey in body (or enforce ADMIN_KEY).
 */
import { NextResponse } from 'next/server';
import {
  createActivationCodes,
  listActivationCodes,
} from '@/lib/commercial/activationVault';
import { getEntitlementMode, resolveEntitlementSecret } from '@/lib/entitlement';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

function assertAdmin(body: { adminKey?: string }) {
  const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
  const mode = getEntitlementMode();
  if (mode === 'enforce') {
    if (!admin) {
      throw new AppError('Thiếu AINOVEL_ENTITLEMENT_ADMIN_KEY', {
        code: 'INFRA',
        status: 503,
      });
    }
    if (body.adminKey !== admin) {
      throw new AppError('Admin key sai', { code: 'AUTH', status: 403 });
    }
  } else if (admin && body.adminKey !== admin) {
    throw new AppError('Admin key required', { code: 'AUTH', status: 403 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      adminKey?: string;
      count?: number;
      plan?: 'pro' | 'vip';
      expSeconds?: number;
      note?: string;
      orderId?: string;
    };
    assertAdmin(body);
    if (getEntitlementMode() === 'enforce') {
      const sec = resolveEntitlementSecret();
      if (!sec.ok) {
        throw new AppError(sec.reason || 'Secret misconfigured', {
          code: 'INFRA',
          status: 503,
        });
      }
    }
    const codes = createActivationCodes({
      count: body.count,
      plan: body.plan,
      expSeconds: body.expSeconds,
      note: body.note,
      orderId: body.orderId,
    });
    return NextResponse.json({
      ok: true,
      count: codes.length,
      codes: codes.map((c) => ({
        code: c.code,
        plan: c.plan,
        expSeconds: c.expSeconds,
        createdAt: c.createdAt,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const adminKey = url.searchParams.get('adminKey') || '';
    assertAdmin({ adminKey });
    const list = listActivationCodes(100);
    return NextResponse.json({
      ok: true,
      count: list.length,
      codes: list.map((c) => ({
        code: c.code,
        plan: c.plan,
        redeemed: Boolean(c.redeemedAt),
        redeemedHwid: c.redeemedHwid || null,
        orderId: c.orderId || null,
        createdAt: c.createdAt,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
