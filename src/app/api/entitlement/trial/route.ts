/**
 * Trial start / status (one per HWID).
 */
import { NextResponse } from 'next/server';
import { getHwid, getEntitlementPublicStatus } from '@/lib/entitlement';
import { getTrialStatus, startTrial } from '@/lib/commercial/trial';
import { startCloudTrial } from '@/lib/cloud/licenseBridge';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { proxyLicenseApiPost } from '@/lib/commercial/licenseApiProxy';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const status = getTrialStatus();
  const pub = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    endsIso: status.record
      ? new Date(status.record.endsAt * 1000).toISOString()
      : null,
    mode: pub.mode,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hwid?: string };
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();
    if (isPackagedCustomerRuntime()) {
      const remote = await proxyLicenseApiPost('/api/cloud/license/trial', { hwid });
      return NextResponse.json(remote.payload, { status: remote.status });
    }
    if (isSupabaseAdminConfigured()) {
      const result = await startCloudTrial({
        service: createServiceSupabase(),
        hwid,
        userId: null,
      });
      return NextResponse.json({
        ok: true,
        cloud: true,
        created: result.created,
        token: result.token,
        expAt: result.expAt,
        licenseId: result.licenseId,
        message: result.created
          ? 'Trial cloud da bat - luu token vao app.'
          : 'Trial dang active - token gia han phien.',
        storeHint: 'localStorage.ainovel.entitlementToken',
      });
    }
    const result = startTrial(hwid);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || 'Không bật trial được',
          status: result.status,
        },
        { status: 400 },
      );
    }
    if (!result.status.active && !result.created) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || 'Máy này đã dùng trial (hết hạn).',
          status: result.status,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      created: result.created,
      cloud: false,
      token: result.token || null,
      message: result.created
        ? `Trial ${result.status.days} ngày đã bật — quyền như Pro (video · CapCut · ship · TTS premium). Toolbox/multi-channel cần Pro trả phí.`
        : result.error ||
          'Trial đang active trên máy này — đã cấp lại token phiên.',
      status: result.status,
      endsIso: result.status.record
        ? new Date(result.status.record.endsAt * 1000).toISOString()
        : null,
      hwid: result.status.hwid,
      storeHint: result.token
        ? 'localStorage.ainovel.entitlementToken'
        : undefined,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
