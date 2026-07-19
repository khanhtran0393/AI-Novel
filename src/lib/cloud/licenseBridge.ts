/**
 * Cloud license bridge — HMAC issue/verify + optional Supabase persistence.
 * Improves pure local vault: orders, revoke, audit, trial 1/HWID in DB.
 */

import crypto from 'crypto';
import {
  issueEntitlementToken,
  verifyEntitlementToken,
  type EntitlementClaims,
} from '@/lib/entitlement';
import {
  PAID_PLANS,
  buildTransferContent,
  type PaidPlanId,
} from '@/lib/commercial/pricingPlans';
import { createActivationCodes } from '@/lib/commercial/activationVault';
import { startTrial } from '@/lib/commercial/trial';
import { AppError } from '@/lib/errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LicensePlan, OrderPlan } from '@/lib/supabase/types';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function paidPlanToLicense(planId: PaidPlanId): {
  licensePlan: LicensePlan;
  expSeconds: number;
  is_vip: boolean;
  is_pro: boolean;
  amountVnd: number;
  orderPlan: OrderPlan;
} {
  const p = PAID_PLANS.find((x) => x.id === planId) || PAID_PLANS[2];
  return {
    // Product unified: all paid plans = Pro (no VIP tier)
    licensePlan: 'pro' as LicensePlan,
    expSeconds: p.expSeconds,
    is_vip: false,
    is_pro: true,
    amountVnd: p.priceVnd,
    orderPlan: p.id,
  };
}

export function issueHmacForPlan(
  planId: PaidPlanId,
  hwid: string,
): { token: string; claims: EntitlementClaims; meta: ReturnType<typeof paidPlanToLicense> } {
  const meta = paidPlanToLicense(planId);
  const id = hwid.trim().toLowerCase();
  if (!id || id.length < 8) {
    throw new AppError('HWID không hợp lệ.', { code: 'VALIDATION', status: 400 });
  }
  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    is_trial: false,
    plan: 'pro',
    hwid: id,
    expSeconds: meta.expSeconds,
  });
  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims) {
    throw new AppError('Issue token thất bại (secret?).', {
      code: 'INFRA',
      status: 503,
    });
  }
  return { token, claims, meta };
}

export function issueTrialToken(hwid: string, days = 3): {
  token: string;
  expAt: Date;
} {
  const id = hwid.trim().toLowerCase();
  const expSeconds = Math.max(1, days) * 86400;
  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    is_trial: true,
    plan: 'trial',
    hwid: id,
    expSeconds,
  });
  return {
    token,
    expAt: new Date(Date.now() + expSeconds * 1000),
  };
}

export async function auditLog(
  service: SupabaseClient | null,
  action: string,
  meta: Record<string, unknown>,
  actorId?: string | null,
) {
  if (!service) return;
  try {
    await service.from('audit_logs').insert({
      actor_id: actorId && actorId !== 'admin-key' ? actorId : null,
      action,
      meta,
    });
  } catch {
    /* non-fatal */
  }
}

/** Create pending order (DB if configured). */
export async function createPendingOrder(input: {
  service: SupabaseClient | null;
  userId?: string | null;
  planId: PaidPlanId;
  hwid: string;
  guestEmail?: string;
  note?: string;
}): Promise<{
  orderId: string | null;
  transferContent: string;
  amountVnd: number;
  planId: PaidPlanId;
  cloud: boolean;
}> {
  const meta = paidPlanToLicense(input.planId);
  const hwid = input.hwid.trim().toUpperCase();
  const transferContent = buildTransferContent(input.planId, hwid);

  if (!input.service || !isSupabaseAdminConfigured()) {
    return {
      orderId: null,
      transferContent,
      amountVnd: meta.amountVnd,
      planId: input.planId,
      cloud: false,
    };
  }

  const { data, error } = await input.service
    .from('orders')
    .insert({
      user_id: input.userId || null,
      plan: meta.orderPlan,
      amount_vnd: meta.amountVnd,
      status: 'pending',
      transfer_content: transferContent,
      hwid,
      guest_email: input.guestEmail || null,
      note: input.note || null,
    })
    .select('id')
    .single();

  if (error) {
    throw new AppError(`Tạo order thất bại: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  await auditLog(input.service, 'order.create', {
    orderId: data.id,
    plan: input.planId,
    hwid,
  }, input.userId);

  return {
    orderId: data.id as string,
    transferContent,
    amountVnd: meta.amountVnd,
    planId: input.planId,
    cloud: true,
  };
}

/** Confirm paid + issue license row + return token or activation code. */
export async function confirmOrderAndIssue(input: {
  service: SupabaseClient;
  orderId: string;
  actorId?: string | null;
  issueMode?: 'token' | 'code';
}): Promise<{
  token?: string;
  activationCode?: string;
  licenseId: string;
  plan: LicensePlan;
  hwid: string;
  expAt: string;
}> {
  const { data: order, error } = await input.service
    .from('orders')
    .select('*')
    .eq('id', input.orderId)
    .maybeSingle();

  if (error || !order) {
    throw new AppError('Order không tồn tại.', { code: 'NOT_FOUND', status: 404 });
  }
  if (order.status === 'paid') {
    throw new AppError('Order đã paid — không issue lại tự động.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  if (order.status !== 'pending') {
    throw new AppError(`Order status=${order.status}, không confirm được.`, {
      code: 'VALIDATION',
      status: 400,
    });
  }

  const planId = order.plan as PaidPlanId;
  const hwid = String(order.hwid || '').toLowerCase();
  if (!hwid) {
    throw new AppError('Order thiếu HWID.', { code: 'VALIDATION', status: 400 });
  }

  const issueMode = input.issueMode || 'token';
  let token: string | undefined;
  let activationCode: string | undefined;
  let tokenHash: string | null = null;
  const meta = paidPlanToLicense(planId);
  const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();

  if (issueMode === 'code') {
    const codes = createActivationCodes({
      count: 1,
      plan: 'pro',
      expSeconds: meta.expSeconds,
      orderId: order.id,
      note: `cloud-order:${order.id}`,
    });
    activationCode = codes[0]?.code;
  } else {
    const issued = issueHmacForPlan(planId, hwid);
    token = issued.token;
    tokenHash = hashToken(token);
  }

  const { error: upErr } = await input.service
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', order.id);
  if (upErr) {
    throw new AppError(`Update order paid fail: ${upErr.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  const { data: lic, error: licErr } = await input.service
    .from('licenses')
    .insert({
      user_id: order.user_id,
      order_id: order.id,
      plan: meta.licensePlan,
      hwid,
      status: 'active',
      exp_at: expAt,
      token_hash: tokenHash,
      activation_code: activationCode || null,
    })
    .select('id')
    .single();

  if (licErr || !lic) {
    throw new AppError(`Insert license fail: ${licErr?.message || 'unknown'}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  // device upsert
  if (order.user_id) {
    await input.service.from('devices').upsert(
      {
        user_id: order.user_id,
        hwid: hwid.toUpperCase(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,hwid' },
    );
  }

  await auditLog(
    input.service,
    'order.confirm_issue',
    {
      orderId: order.id,
      licenseId: lic.id,
      plan: meta.licensePlan,
      hwid,
      issueMode,
    },
    input.actorId,
  );

  return {
    token,
    activationCode,
    licenseId: lic.id as string,
    plan: meta.licensePlan,
    hwid,
    expAt,
  };
}

/** Online verify: HMAC ok + optional cloud not revoked. */
export async function verifyLicenseCloud(input: {
  service: SupabaseClient | null;
  token: string;
  hwid?: string;
}): Promise<{
  valid: boolean;
  claims: EntitlementClaims | null;
  cloud: {
    checked: boolean;
    revoked: boolean;
    licenseId?: string;
    status?: string;
  };
}> {
  const claims = verifyEntitlementToken(input.token, {
    requireHwidMatch: Boolean(input.hwid),
  });
  // verifyEntitlementToken uses local getHwid when requireHwidMatch — for API we parse claims
  const localClaims = verifyEntitlementToken(input.token, {
    requireHwidMatch: false,
  });
  if (!localClaims || (!localClaims.is_pro && !localClaims.is_vip)) {
    return {
      valid: false,
      claims: null,
      cloud: { checked: false, revoked: false },
    };
  }

  if (input.hwid && localClaims.hwid) {
    if (localClaims.hwid.toLowerCase() !== input.hwid.trim().toLowerCase()) {
      return {
        valid: false,
        claims: null,
        cloud: { checked: false, revoked: false },
      };
    }
  }

  if (!input.service || !isSupabaseAdminConfigured()) {
    return {
      valid: true,
      claims: localClaims,
      cloud: { checked: false, revoked: false },
    };
  }

  const th = hashToken(input.token);
  const { data: row } = await input.service
    .from('licenses')
    .select('id,status,exp_at,hwid')
    .eq('token_hash', th)
    .maybeSingle();

  if (!row) {
    // Token valid HMAC but not in cloud (issued offline) — still ok
    return {
      valid: true,
      claims: localClaims,
      cloud: { checked: true, revoked: false },
    };
  }

  if (row.status === 'revoked' || row.status === 'expired') {
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: true,
        licenseId: row.id,
        status: row.status,
      },
    };
  }

  if (new Date(row.exp_at).getTime() < Date.now()) {
    await input.service
      .from('licenses')
      .update({ status: 'expired' })
      .eq('id', row.id);
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: false,
        licenseId: row.id,
        status: 'expired',
      },
    };
  }

  return {
    valid: true,
    claims: localClaims,
    cloud: {
      checked: true,
      revoked: false,
      licenseId: row.id,
      status: row.status,
    },
  };
}

export async function startCloudTrial(input: {
  service: SupabaseClient;
  hwid: string;
  userId?: string | null;
  days?: number;
}): Promise<{
  created: boolean;
  token: string;
  expAt: string;
  licenseId: string;
}> {
  const hwid = input.hwid.trim().toLowerCase();
  const days =
    input.days ?? (Number(process.env.AINOVEL_TRIAL_DAYS || 3) || 3);

  const { data: existing } = await input.service
    .from('licenses')
    .select('id,status,exp_at,plan')
    .eq('hwid', hwid)
    .eq('plan', 'trial')
    .maybeSingle();

  if (existing) {
    if (
      existing.status === 'active' &&
      new Date(existing.exp_at).getTime() > Date.now()
    ) {
      // re-issue token for same trial window
      const leftSec = Math.max(
        60,
        Math.floor((new Date(existing.exp_at).getTime() - Date.now()) / 1000),
      );
      const token = issueEntitlementToken({
        is_pro: true,
        is_vip: false,
        is_trial: true,
        plan: 'trial',
        hwid,
        expSeconds: leftSec,
      });
      await input.service
        .from('licenses')
        .update({ token_hash: hashToken(token) })
        .eq('id', existing.id);
      try {
        startTrial(hwid);
      } catch {
        /* non-fatal */
      }
      return {
        created: false,
        token,
        expAt: existing.exp_at,
        licenseId: existing.id,
      };
    }
    throw new AppError('Máy này đã dùng trial (hết hạn hoặc đã cấp).', {
      code: 'VALIDATION',
      status: 400,
    });
  }

  const { token, expAt } = issueTrialToken(hwid, days);
  const { data: lic, error } = await input.service
    .from('licenses')
    .insert({
      user_id: input.userId || null,
      plan: 'trial',
      hwid,
      status: 'active',
      exp_at: expAt.toISOString(),
      token_hash: hashToken(token),
    })
    .select('id')
    .single();

  if (error || !lic) {
    throw new AppError(`Trial cloud fail: ${error?.message || 'unknown'}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  await auditLog(
    input.service,
    'trial.start',
    { hwid, licenseId: lic.id, days },
    input.userId,
  );

  // Mirror local vault so assertProAccess / offline trial stay aligned
  try {
    startTrial(hwid);
  } catch {
    /* non-fatal */
  }

  return {
    created: true,
    token,
    expAt: expAt.toISOString(),
    licenseId: lic.id as string,
  };
}

export async function revokeLicense(input: {
  service: SupabaseClient;
  licenseId: string;
  actorId?: string | null;
}): Promise<void> {
  const { error } = await input.service
    .from('licenses')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    })
    .eq('id', input.licenseId);
  if (error) {
    throw new AppError(error.message, { code: 'INFRA', status: 502 });
  }
  await auditLog(
    input.service,
    'license.revoke',
    { licenseId: input.licenseId },
    input.actorId,
  );
}
