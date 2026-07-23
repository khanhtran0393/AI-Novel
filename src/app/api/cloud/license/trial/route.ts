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
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { proxyLicenseApiPost } from '@/lib/commercial/licenseApiProxy';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hwid?: string };
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();

    if (isPackagedCustomerRuntime()) {
      const remote = await proxyLicenseApiPost('/api/cloud/license/trial', { hwid });
      return NextResponse.json(remote.payload, { status: remote.status });
    }

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

    // Fallback local vault (+ mint token when signer available)
    const local = startTrial(hwid);
    if (!local.ok) {
      throw new AppError(local.error || 'Trial fail', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    if (!local.status.active && !local.created) {
      throw new AppError(local.error || 'Máy này đã dùng trial (hết hạn).', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    return NextResponse.json({
      ok: true,
      cloud: false,
      created: local.created,
      token: local.token || null,
      status: local.status,
      message: local.created
        ? `Trial local ${local.status.days} ngày — quyền như Pro (video · CapCut · ship · TTS premium).`
        : local.error || 'Trial đang active — token phiên đã cấp lại.',
      storeHint: local.token
        ? 'localStorage.ainovel.entitlementToken'
        : undefined,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
