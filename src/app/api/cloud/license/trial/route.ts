/**
 * POST — start trial (cloud DB if configured, else local trial vault).
 * Body: { hwid? }
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { getHwid } from '@/lib/entitlement';
import { startTrial } from '@/lib/commercial/trial';
import { startCloudTrial } from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  createServiceSupabase,
  extractBearer,
  requireUserFromRequest,
} from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hwid?: string };
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();

    let userId: string | null = null;
    if (extractBearer(req)) {
      try {
        userId = (await requireUserFromRequest(req)).userId;
      } catch {
        /* optional */
      }
    }

    if (isSupabaseAdminConfigured()) {
      const service = createServiceSupabase();
      const result = await startCloudTrial({ service, hwid, userId });
      return NextResponse.json({
        ok: true,
        cloud: true,
        created: result.created,
        token: result.token,
        expAt: result.expAt,
        licenseId: result.licenseId,
        message: result.created
          ? 'Trial cloud đã bật — lưu token vào app.'
          : 'Trial đang active — token gia hạn phiên.',
        storeHint: 'localStorage.ainovel.entitlementToken',
      });
    }

    // Fallback local vault
    const local = startTrial(hwid);
    if (!local.ok) {
      throw new AppError(local.error || 'Trial fail', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    return NextResponse.json({
      ok: true,
      cloud: false,
      created: local.created,
      status: local.status,
      message: local.created
        ? `Trial local ${local.status.days} ngày.`
        : local.error || 'Trial đã tồn tại.',
      // local trial uses assertProAccess trial vault — no token required
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
