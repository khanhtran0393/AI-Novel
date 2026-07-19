/**
 * POST admin — revoke license by id.
 * Body: { licenseId }
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { revokeLicense } from '@/lib/cloud/licenseBridge';
import { requireAdminFromRequest } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    if (!isSupabaseAdminConfigured()) {
      throw new AppError('Cần Supabase admin.', { code: 'INFRA', status: 503 });
    }
    const admin = await requireAdminFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as { licenseId?: string };
    if (!body.licenseId?.trim()) {
      throw new AppError('Thiếu licenseId', { code: 'VALIDATION', status: 400 });
    }
    await revokeLicense({
      service: admin.service,
      licenseId: body.licenseId.trim(),
      actorId: admin.userId,
    });
    return NextResponse.json({
      ok: true,
      message: 'License revoked. Heartbeat/verify sẽ fail.',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
