/**
 * Verify entitlement token (client activation check).
 * Body optional: { token?: string } — else reads header x-ainovel-entitlement.
 */
import { NextResponse } from 'next/server';
import {
  extractEntitlementToken,
  getEntitlementMode,
  getEntitlementPublicStatus,
  getHwid,
  verifyEntitlementToken,
} from '@/lib/entitlement';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';
import { verifyLicenseCloud } from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { proxyLicenseApiPost } from '@/lib/commercial/licenseApiProxy';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const token =
      (typeof body.token === 'string' && body.token.trim()) ||
      extractEntitlementToken(req, body) ||
      '';
    if (!token) {
      return NextResponse.json(
        { ok: false, valid: false, error: 'Thiếu token' },
        { status: 400 },
      );
    }
    const machineHwid = getHwid().toLowerCase();
    if (isPackagedCustomerRuntime()) {
      const remote = await proxyLicenseApiPost('/api/cloud/license/verify', {
        token,
        hwid: machineHwid,
      });
      return NextResponse.json(remote.payload, { status: remote.status });
    }
    if (isSupabaseAdminConfigured()) {
      const cloud = await verifyLicenseCloud({
        service: createServiceSupabase(),
        token,
        hwid: machineHwid,
      });
      if (!cloud.valid || !cloud.claims) {
        return NextResponse.json(
          {
            ok: false,
            valid: false,
            hwid: machineHwid.toUpperCase(),
            cloud: cloud.cloud,
            rebindToken: cloud.rebindToken || null,
            error:
              cloud.cloud.status === 'token_mismatch' ||
              cloud.cloud.status === 'ticket_stale'
                ? 'Token không khớp Supabase ledger. Hãy kích hoạt lại key (hoặc đợi app rebind).'
                : 'License không còn hợp lệ trên Supabase.',
          },
          { status: 401 },
        );
      }
      return NextResponse.json({
        ok: true,
        valid: true,
        hwid: machineHwid.toUpperCase(),
        cloud: cloud.cloud,
        rebindToken: cloud.rebindToken || null,
        claims: {
          is_pro: cloud.claims.is_pro,
          is_vip: false,
          is_trial: Boolean(cloud.claims.is_trial),
          plan: cloud.claims.plan,
          exp: cloud.claims.exp,
          expIso: new Date(cloud.claims.exp * 1000).toISOString(),
          hwidBound: Boolean(cloud.claims.hwid),
        },
      });
    }
    const claimsAny = verifyEntitlementToken(token, { requireHwidMatch: false });
    const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
    const status = getEntitlementPublicStatus();
    if (!claims) {
      let error =
        'Token không hợp lệ, hết hạn, hoặc không khớp HWID máy này.';
      if (!status.publicKeyConfigured) {
        error =
          'App chưa nạp public key license — cấu hình PUBLIC_KEY / public-keys rồi restart.';
      } else if (claimsAny?.hwid && claimsAny.hwid !== status.hwid?.toLowerCase()) {
        error = `Key gắn HWID ${String(claimsAny.hwid).toUpperCase()} — máy này ${String(status.hwid || '').toUpperCase()}.`;
      } else if (!claimsAny) {
        error =
          'Token không verify (sai format AINOVEL2.… / hết hạn / ký bằng key khác).';
      }
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          mode: status.mode,
          hwid: status.hwid,
          error,
        },
        { status: 401 },
      );
    }
    return NextResponse.json({
      ok: true,
      valid: true,
      mode: status.mode,
      hwid: status.hwid,
      claims: {
        is_pro: claims.is_pro,
        is_vip: claims.is_vip,
        exp: claims.exp,
        expIso: new Date(claims.exp * 1000).toISOString(),
        hwidBound: Boolean(claims.hwid),
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  const token = extractEntitlementToken(req);
  const claims = token
    ? verifyEntitlementToken(token, { requireHwidMatch: true })
    : null;
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    localHwid: getHwid(),
    tokenPresent: Boolean(token),
    tokenValid: Boolean(claims),
    claims: claims
      ? {
          is_pro: claims.is_pro,
          is_vip: claims.is_vip,
          exp: claims.exp,
          expIso: new Date(claims.exp * 1000).toISOString(),
        }
      : null,
    mode: getEntitlementMode(),
  });
}
