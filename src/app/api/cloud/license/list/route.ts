/**
 * GET admin — list licenses (filter plan / status / hwid).
 * Auth: x-ainovel-admin-key or Supabase admin JWT.
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { listLicenses } from '@/lib/cloud/licenseBridge';
import { requireAdminFromRequest } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    if (!isSupabaseAdminConfigured()) {
      throw new AppError('Cần Supabase admin (SERVICE_ROLE).', {
        code: 'INFRA',
        status: 503,
      });
    }
    const admin = await requireAdminFromRequest(req);
    const url = new URL(req.url);
    const plan = url.searchParams.get('plan') || 'all';
    const status = url.searchParams.get('status') || 'all';
    const q = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit') || '50') || 50;

    const { rows, total } = await listLicenses({
      service: admin.service,
      plan,
      status,
      q,
      limit,
    });

    return NextResponse.json({
      ok: true,
      total,
      count: rows.length,
      filters: { plan, status, q, limit },
      licenses: rows,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
