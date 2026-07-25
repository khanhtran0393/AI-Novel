/**
 * POST admin — issue license (token or AINOVEL code).
 * Supabase SERVICE_ROLE is mandatory; no token/code is returned without a
 * confirmed licenses row.
 *
 * Auth:
 * - Header x-ainovel-admin-key / body.adminKey = AINOVEL_ENTITLEMENT_ADMIN_KEY
 * - OR Supabase admin JWT Bearer
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { generateActivationCode } from '@/lib/commercial/activationVault';
import {
  auditLog,
  insertLicenseRow,
  issueProLicenseForPlan,
  paidPlanToLicense,
  persistIssuedProToken,
} from '@/lib/cloud/licenseBridge';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import { PAID_PLANS } from '@/lib/commercial/pricingPlans';
import {
  createServiceSupabase,
  extractBearer,
  requireAdminFromRequest,
} from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  assertLicenseSignerConfigured,
  assertSellerRuntime,
} from '@/lib/commercial/sellerRuntime';

export const runtime = 'nodejs';

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

function isEnvAdminKey(key: string | undefined | null): boolean {
  const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
  return Boolean(admin && key && key.trim() === admin);
}

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
    const service = createServiceSupabase();
    const body = (await req.json().catch(() => ({}))) as {
      planId?: string;
      hwid?: string;
      issueMode?: 'token' | 'code';
      userId?: string;
      adminKey?: string;
    };

    const headerKey =
      req.headers.get('x-ainovel-admin-key') ||
      req.headers.get('x-admin-key') ||
      '';
    const keyOk = isEnvAdminKey(body.adminKey) || isEnvAdminKey(headerKey);

    let actorId = 'admin-key';
    if (!keyOk) {
      if (!extractBearer(req) && !isSupabaseAdminConfigured()) {
        throw new AppError(
          'Cần adminKey (AINOVEL_ENTITLEMENT_ADMIN_KEY) hoặc Supabase admin JWT.',
          { code: 'AUTH', status: 403 },
        );
      }
      const admin = await requireAdminFromRequest(req);
      actorId = admin.userId;
    }

    const planId = (body.planId || 'lifetime') as PaidPlanId;
    if (!PLAN_IDS.has(planId)) {
      throw new AppError('planId invalid (month|year|lifetime)', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    const hwid = (body.hwid || '').trim().toLowerCase();
    if (hwid.length < 8) {
      throw new AppError('Thiếu hwid hợp lệ', {
        code: 'VALIDATION',
        status: 400,
      });
    }

    const issueMode = body.issueMode || 'token';
    const meta = paidPlanToLicense(planId);
    const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();

    let token: string | undefined;
    let activationCode: string | undefined;

    if (issueMode === 'code') {
      // Cloud issue persists directly to Supabase. Do not touch the local
      // activation vault because serverless filesystems are read-only/ephemeral.
      activationCode = generateActivationCode();
    } else {
      const issued = issueProLicenseForPlan(planId, hwid);
      token = issued.token;
    }

    let licenseId: string;
    if (issueMode === 'code') {
      const lic = await insertLicenseRow(service, {
        plan: meta.licensePlan,
        hwid,
        status: 'active',
        exp_at: expAt,
        token_hash: null,
        activation_code: activationCode || null,
      });
      licenseId = lic.id;
      await auditLog(
        service,
        'license.issue_direct',
        { licenseId, planId, hwid, issueMode },
        actorId,
      );
    } else {
      const persisted = await persistIssuedProToken({
        service,
        token: token!,
        hwid,
        actorId,
        source: 'api.cloud.license.issue',
      });
      licenseId = persisted.licenseId;
    }

    return NextResponse.json({
      ok: true,
      token,
      activationCode,
      licenseId,
      plan: meta.licensePlan,
      hwid,
      expAt,
      cloud: true,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
