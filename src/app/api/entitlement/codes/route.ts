/**
 * Seller admin: create / list Supabase-backed activation codes.
 * Requires adminKey in body (or enforce ADMIN_KEY).
 */
import { NextResponse } from 'next/server';
import { issueUnboundProActivationCodes } from '@/lib/cloud/licenseBridge';
import { getEntitlementMode } from '@/lib/entitlement';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
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
    if (!isSupabaseAdminConfigured()) {
      throw new AppError(
        'Supabase SERVICE_ROLE bắt buộc để tạo mã kích hoạt.',
        { code: 'INFRA', status: 503 },
      );
    }
    if ((body.maxSeats ?? 1) !== 1) {
      throw new AppError(
        'One-path code chỉ hỗ trợ 1 HWID/mã. Dùng luồng seat-transfer cho nhiều máy.',
        { code: 'VALIDATION', status: 400 },
      );
    }
    const result = await issueUnboundProActivationCodes({
      service: createServiceSupabase(),
      count: body.count,
      expSeconds: body.expSeconds,
      note: body.note,
      orderId: body.orderId,
    });
    return NextResponse.json({
      ok: true,
      authority: 'supabase',
      count: result.codes.length,
      codes: result.codes.map((c) => ({
        code: c.code,
        plan: 'pro',
        expSeconds: c.expSeconds,
        maxSeats: 1,
        licenseId: c.licenseId,
        ledgerOk: c.ledgerOk,
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
    if (!isSupabaseAdminConfigured()) {
      throw new AppError(
        'Supabase SERVICE_ROLE bắt buộc để liệt kê mã kích hoạt.',
        { code: 'INFRA', status: 503 },
      );
    }
    const limit = Math.max(
      1,
      Math.min(100, Number(url.searchParams.get('limit') || 100) || 100),
    );
    const { data: list, error } = await createServiceSupabase()
      .from('licenses')
      .select('id,activation_code,plan,status,hwid,created_at,exp_at,token_hash')
      .not('activation_code', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw new AppError(`Supabase licenses: ${error.message}`, {
        code: 'INFRA',
        status: 502,
      });
    }
    return NextResponse.json({
      ok: true,
      authority: 'supabase',
      count: list?.length || 0,
      codes: (list || []).map((c) => ({
        code: c.activation_code,
        plan: c.plan,
        status: c.status,
        redeemed: !String(c.hwid || '').startsWith('unbound:'),
        redeemedHwid: String(c.hwid || '').startsWith('unbound:')
          ? null
          : c.hwid,
        maxSeats: 1,
        seatsUsed: String(c.hwid || '').startsWith('unbound:') ? 0 : 1,
        createdAt: c.created_at,
        expAt: c.exp_at,
        tokenBound: Boolean(c.token_hash),
        licenseId: c.id,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
