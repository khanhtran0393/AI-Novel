/**
 * POST — create pending order (optional login).
 * Body: { planId, hwid, note?, guestEmail? }
 * Auth: optional Bearer (links user_id when present)
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { getHwid } from '@/lib/entitlement';
import { PAID_PLANS, type PaidPlanId } from '@/lib/commercial/pricingPlans';
import { createPendingOrder } from '@/lib/cloud/licenseBridge';
import {
  createServiceSupabase,
  extractBearer,
  requireUserFromRequest,
} from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { notifyPaymentReported } from '@/lib/commercial/telegramNotify';

export const runtime = 'nodejs';

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      planId?: string;
      hwid?: string;
      note?: string;
      guestEmail?: string;
      notifyTelegram?: boolean;
    };

    const planId = (body.planId || 'lifetime') as PaidPlanId;
    if (!PLAN_IDS.has(planId)) {
      throw new AppError('planId phải là month|year|lifetime', {
        code: 'VALIDATION',
        status: 400,
      });
    }

    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();

    let userId: string | null = null;
    if (extractBearer(req)) {
      try {
        const u = await requireUserFromRequest(req);
        userId = u.userId;
      } catch {
        // optional auth — ignore invalid token for guest checkout
      }
    }

    const service = isSupabaseAdminConfigured()
      ? createServiceSupabase()
      : null;

    const order = await createPendingOrder({
      service,
      userId,
      planId,
      hwid,
      guestEmail: body.guestEmail,
      note: body.note,
    });

    if (body.notifyTelegram) {
      try {
        await notifyPaymentReported({ hwid, planId });
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({
      ok: true,
      ...order,
      message: order.cloud
        ? 'Order pending đã lưu Supabase. Admin confirm để cấp key.'
        : 'Order local (chưa Supabase). Dùng Zalo + license:issue.',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({
        ok: true,
        cloud: false,
        orders: [],
        message: 'Supabase admin chưa cấu hình.',
      });
    }
    // Admin list pending
    const { requireAdminFromRequest } = await import('@/lib/supabase/server');
    const admin = await requireAdminFromRequest(req);
    const { data, error } = await admin.service
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      throw new AppError(error.message, { code: 'INFRA', status: 502 });
    }
    return NextResponse.json({ ok: true, cloud: true, orders: data || [] });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
