/**
 * POST admin — issue license (token or AINOVEL code).
 * Persists to Supabase when SERVICE_ROLE configured.
 *
 * Auth:
 * - Header x-ainovel-admin-key / body.adminKey = AINOVEL_ENTITLEMENT_ADMIN_KEY
 * - OR Supabase admin JWT Bearer
 */
import { NextResponse } from 'next/server';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { createActivationCodes } from '@/lib/commercial/activationVault';
import {
  auditLog,
  hashToken,
  issueHmacForPlan,
  paidPlanToLicense,
} from '@/lib/cloud/licenseBridge';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import { PAID_PLANS } from '@/lib/commercial/pricingPlans';
import {
  createServiceSupabase,
  extractBearer,
  requireAdminFromRequest,
} from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { resolveEntitlementSecret } from '@/lib/entitlement';

export const runtime = 'nodejs';

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

function isEnvAdminKey(key: string | undefined | null): boolean {
  const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
  return Boolean(admin && key && key.trim() === admin);
}

export async function POST(req: Request) {
  try {
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

    if (process.env.AINOVEL_ENTITLEMENT_MODE === 'enforce') {
      const sec = resolveEntitlementSecret();
      if (!sec.ok) {
        throw new AppError(sec.reason || 'Secret misconfigured', {
          code: 'INFRA',
          status: 503,
        });
      }
    }

    const issueMode = body.issueMode || 'token';
    const meta = paidPlanToLicense(planId);
    const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();

    let token: string | undefined;
    let activationCode: string | undefined;
    let tokenHash: string | null = null;

    if (issueMode === 'code') {
      const codes = createActivationCodes({
        count: 1,
        plan: meta.licensePlan === 'vip' ? 'vip' : 'pro',
        expSeconds: meta.expSeconds,
        note: 'cloud-direct-issue',
      });
      activationCode = codes[0]?.code;
    } else {
      const issued = issueHmacForPlan(planId, hwid);
      token = issued.token;
      tokenHash = hashToken(token);
    }

    let licenseId: string | null = null;
    if (isSupabaseAdminConfigured()) {
      const service = createServiceSupabase();
      const { data, error } = await service
        .from('licenses')
        .insert({
          user_id: body.userId || null,
          plan: meta.licensePlan,
          hwid,
          status: 'active',
          exp_at: expAt,
          token_hash: tokenHash,
          activation_code: activationCode || null,
        })
        .select('id')
        .single();
      if (error) {
        throw new AppError(error.message, { code: 'INFRA', status: 502 });
      }
      licenseId = data.id as string;
      await auditLog(
        service,
        'license.issue_direct',
        { licenseId, planId, hwid, issueMode },
        actorId,
      );
    }

    return NextResponse.json({
      ok: true,
      token,
      activationCode,
      licenseId,
      plan: meta.licensePlan,
      hwid,
      expAt,
      cloud: Boolean(licenseId),
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
