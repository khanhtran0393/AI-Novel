/**
 * Issue Ed25519 entitlement token (seller / backend only).
 *
 * enforce mode: AINOVEL_ENTITLEMENT_ADMIN_KEY required on every request.
 * Body: { expSeconds?, hwid, adminKey }
 * Supabase ledger persistence is mandatory.
 */
import { NextResponse } from 'next/server';
import {
  getEntitlementMode,
  getEntitlementPublicStatus,
  issueEntitlementToken,
} from '@/lib/entitlement';
import { persistIssuedProToken } from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
import {
  assertLicenseSignerConfigured,
  assertSellerRuntime,
} from '@/lib/commercial/sellerRuntime';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    assertSellerRuntime();
    assertLicenseSignerConfigured();
    if (!isSupabaseAdminConfigured()) {
      throw new AppError(
        'Supabase SERVICE_ROLE bắt buộc để cấp license. Không phát hành token-only.',
        { code: 'INFRA', status: 503 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      expSeconds?: number;
      hwid?: string;
      adminKey?: string;
    };

    const mode = getEntitlementMode();
    // Admin gate: always required in enforce; optional in open only if ADMIN_KEY set
    const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
    if (mode === 'enforce') {
      if (!admin) {
        throw new AppError(
          'Server misconfigured: đặt AINOVEL_ENTITLEMENT_ADMIN_KEY để cấp license.',
          { code: 'INFRA', status: 503 },
        );
      }
      if (body.adminKey !== admin) {
        throw new AppError('Forbidden: admin key sai hoặc thiếu.', {
          code: 'AUTH',
          status: 403,
        });
      }
    } else if (admin && body.adminKey !== admin) {
      // If admin key is configured even in open, still require it for issue
      throw new AppError('Forbidden: admin key required to issue tokens', {
        code: 'AUTH',
        status: 403,
      });
    }

    const hwid =
      typeof body.hwid === 'string' ? body.hwid.trim().toLowerCase() : '';
    if (hwid.length < 8) {
      throw new AppError('Cần HWID hợp lệ (tối thiểu 8 ký tự).', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    const token = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      expSeconds: body.expSeconds,
      hwid,
    });
    const persisted = await persistIssuedProToken({
      service: createServiceSupabase(),
      token,
      hwid,
      actorId: 'entitlement-issue',
      source: 'api.entitlement.issue',
    });

    const claimsPreview = {
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      hwid: hwid || null,
      expSeconds: body.expSeconds ?? 60 * 60 * 24 * 30,
    };

    return NextResponse.json({
      ok: true,
      mode,
      token,
      licenseId: persisted.licenseId,
      authority: 'supabase',
      header: 'x-ainovel-entitlement',
      claims: claimsPreview,
      hint: 'Token gắn HWID và đã ghi Supabase ledger.',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    mode: status.mode,
    open: status.open,
    readyForCommercial: status.readyForCommercial,
    blockers: status.blockers,
    hint:
      status.mode === 'open'
        ? 'Dev/desktop: Pro routes allowed without token. Publish: set AINOVEL_ENTITLEMENT_MODE=enforce.'
        : 'Enforce: seller POST /api/entitlement/issue with adminKey; client sends x-ainovel-entitlement.',
  });
}
