/**
 * Admin multi-seat: transfer (release HWID), expand maxSeats, inspect.
 * Body always requires adminKey when MODE=enforce.
 */
import { NextResponse } from 'next/server';
import {
  expandMaxSeats,
  findCodesByHwid,
  getSeatSummary,
  transferSeat,
} from '@/lib/commercial/multiSeat';
import { appendSellerLog } from '@/lib/commercial/sellerLog';
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
      action?: 'transfer' | 'expand' | 'summary' | 'find';
      code?: string;
      hwid?: string;
      maxSeats?: number;
    };
    assertAdmin(body);
    const action = body.action || 'summary';

    if (action === 'transfer') {
      if (!body.code || !body.hwid) {
        throw new AppError('transfer cần code + hwid', {
          code: 'VALIDATION',
          status: 400,
        });
      }
      const result = transferSeat(body.code, body.hwid);
      if (!result.ok) {
        throw new AppError(result.error || 'Transfer fail', {
          code: 'VALIDATION',
          status: 400,
        });
      }
      appendSellerLog({
        at: new Date().toISOString(),
        kind: 'transfer',
        code: result.code,
        hwid: result.releasedHwid,
        note: `released seat; remaining=${result.remainingSeats.length}/${result.maxSeats}`,
      });
      return NextResponse.json({
        ok: true as const,
        code: result.code,
        releasedHwid: result.releasedHwid,
        remainingSeats: result.remainingSeats,
        maxSeats: result.maxSeats,
      });
    }

    if (action === 'expand') {
      if (!body.code || body.maxSeats == null) {
        throw new AppError('expand cần code + maxSeats', {
          code: 'VALIDATION',
          status: 400,
        });
      }
      const result = expandMaxSeats(body.code, Number(body.maxSeats));
      if (!result.ok) {
        throw new AppError(result.error || 'Expand fail', {
          code: 'VALIDATION',
          status: 400,
        });
      }
      appendSellerLog({
        at: new Date().toISOString(),
        kind: 'note',
        code: body.code,
        note: `maxSeats → ${body.maxSeats}`,
      });
      return NextResponse.json({ ok: true as const, record: result.record });
    }

    if (action === 'find') {
      if (!body.hwid) {
        throw new AppError('find cần hwid', {
          code: 'VALIDATION',
          status: 400,
        });
      }
      const codes = findCodesByHwid(body.hwid);
      return NextResponse.json({
        ok: true as const,
        hwid: body.hwid,
        count: codes.length,
        codes: codes.map((c) => ({
          code: c.code,
          plan: c.plan,
          maxSeats: c.maxSeats ?? 1,
          seats: c.seats || [],
        })),
      });
    }

    // summary
    if (!body.code) {
      throw new AppError('summary cần code', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    const summary = getSeatSummary(body.code);
    if (!summary.ok) {
      throw new AppError(summary.error || 'Not found', {
        code: 'VALIDATION',
        status: 404,
      });
    }
    return NextResponse.json({
      ok: true as const,
      code: summary.code,
      maxSeats: summary.maxSeats,
      seats: summary.seats,
      used: summary.used,
      free: summary.free,
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
    const code = url.searchParams.get('code') || '';
    assertAdmin({ adminKey });
    if (!code) {
      throw new AppError('?code= required', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    const summary = getSeatSummary(code);
    if (!summary.ok) {
      throw new AppError(summary.error || 'Not found', {
        code: 'VALIDATION',
        status: 404,
      });
    }
    return NextResponse.json({
      ok: true as const,
      code: summary.code,
      maxSeats: summary.maxSeats,
      seats: summary.seats,
      used: summary.used,
      free: summary.free,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
