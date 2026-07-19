/**
 * POST admin — confirm paid order + issue license token/code.
 * Body: { orderId, issueMode?: 'token'|'code' }
 * Auth: admin JWT or x-ainovel-admin-key
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { confirmOrderAndIssue } from '@/lib/cloud/licenseBridge';
import { requireAdminFromRequest } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    if (!isSupabaseAdminConfigured()) {
      throw new AppError(
        'Cần SUPABASE_SERVICE_ROLE_KEY để confirm order trên cloud.',
        { code: 'INFRA', status: 503 },
      );
    }
    const admin = await requireAdminFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as {
      orderId?: string;
      issueMode?: 'token' | 'code';
    };
    if (!body.orderId?.trim()) {
      throw new AppError('Thiếu orderId', { code: 'VALIDATION', status: 400 });
    }

    const result = await confirmOrderAndIssue({
      service: admin.service,
      orderId: body.orderId.trim(),
      actorId: admin.userId,
      issueMode: body.issueMode || 'token',
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.token
        ? 'Đã paid + issue token. Gửi token cho khách kích hoạt.'
        : 'Đã paid + issue mã AINOVEL. Gửi mã cho khách redeem.',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
