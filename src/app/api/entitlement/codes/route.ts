/**
 * Seller admin: create / list activation codes.
 * Requires adminKey in body (or enforce ADMIN_KEY).
 */
import { NextResponse } from 'next/server';
import {
  createActivationCodes,
  listActivationCodes,
} from '@/lib/commercial/activationVault';
import { getEntitlementMode } from '@/lib/entitlement';
import {
  assertLicenseSignerConfigured,
  assertSellerRuntime,
} from '@/lib/commercial/sellerRuntime';
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
    assertSellerRuntime();
    assertLicenseSignerConfigured();
    const body = (await req.json().catch(() => ({}))) as {
      adminKey?: string;
      count?: number;
      plan?: 'pro';
      expSeconds?: number;
      note?: string;
      orderId?: string;
      maxSeats?: number;
    };
    assertAdmin(body);
    const codes = createActivationCodes({
      count: body.count,
      plan: body.plan,
      expSeconds: body.expSeconds,
      note: body.note,
      orderId: body.orderId,
      maxSeats: body.maxSeats,
    });
    return NextResponse.json({
      ok: true,
      count: codes.length,
      codes: codes.map((c) => ({
        code: c.code,
        plan: c.plan,
        expSeconds: c.expSeconds,
        maxSeats: c.maxSeats ?? 1,
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
    assertSellerRuntime();
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
        redeemed: Boolean(c.redeemedAt) || (c.seats?.length ?? 0) > 0,
        redeemedHwid: c.redeemedHwid || null,
        maxSeats: c.maxSeats ?? 1,
        seats: c.seats || [],
        seatsUsed: c.seats?.length ?? (c.redeemedHwid ? 1 : 0),
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
