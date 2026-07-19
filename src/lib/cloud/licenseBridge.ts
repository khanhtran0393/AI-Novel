/**
 * Cloud license bridge — Ed25519 issue/verify + optional Supabase persistence.
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

/** Redeem a persistent Supabase activation code and issue a fresh HWID token. */
export async function redeemCloudActivationCode(input: {
  service: SupabaseClient;
  code: string;
  hwid: string;
}): Promise<{ token: string; claims: EntitlementClaims; licenseId: string }> {
  const code = input.code.trim().toUpperCase();
  const hwid = input.hwid.trim().toLowerCase();
  const { data: row, error } = await input.service
    .from('licenses')
    .select('id,plan,hwid,status,exp_at,activation_code')
    .eq('activation_code', code)
    .maybeSingle();
  if (error) {
    throw new AppError(`License lookup fail: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }
  if (!row) {
    throw new AppError('Mã kích hoạt không tồn tại.', {
      code: 'AUTH',
      status: 404,
    });
  }
  if (row.status !== 'active') {
    throw new AppError(`License status=${row.status}.`, {
      code: 'AUTH',
      status: 403,
    });
  }
  if (String(row.hwid || '').trim().toLowerCase() !== hwid) {
    throw new AppError('Mã kích hoạt không khớp HWID máy này.', {
      code: 'AUTH',
      status: 403,
    });
  }
  const secondsLeft = Math.floor(
    (new Date(row.exp_at).getTime() - Date.now()) / 1000,
  );
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) {
    await input.service
      .from('licenses')
      .update({ status: 'expired' })
      .eq('id', row.id);
    throw new AppError('License đã hết hạn.', { code: 'AUTH', status: 403 });
  }
  const isTrial = row.plan === 'trial';
  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    is_trial: isTrial,
    plan: isTrial ? 'trial' : 'pro',
    hwid,
    license_id: String(row.id),
    expSeconds: secondsLeft,
  });
  const { error: updateError } = await input.service
    .from('licenses')
    .update({ token_hash: hashToken(token) })
    .eq('id', row.id);
  if (updateError) {
    throw new AppError(`License update fail: ${updateError.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }
  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims || claims.hwid?.toLowerCase() !== hwid) {
    throw new AppError('Token vừa cấp không verify được.', {
      code: 'INFRA',
      status: 500,
    });
  }
  return { token, claims, licenseId: String(row.id) };
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

/**
 * Issue a paid Pro license (Ed25519 AINOVEL2 wire format).
 * Name kept as issueHmacForPlan for call-site compatibility — does NOT use HMAC.
 */
export function issueProLicenseForPlan(
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
  if (!token.startsWith('AINOVEL2.')) {
    throw new AppError('Issue token không phải AINOVEL2 (kiểm tra signing key Ed25519).', {
      code: 'INFRA',
      status: 503,
    });
  }
  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims) {
    throw new AppError('Issue token thất bại (signing key / public keyring lệch cặp).', {
      code: 'INFRA',
      status: 503,
    });
  }
  return { token, claims, meta };
}

/** @deprecated Use issueProLicenseForPlan — alias for smoke/scripts. */
export const issueHmacForPlan = issueProLicenseForPlan;

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

/**
 * Supabase = source of truth for plan when admin configured.
 * Rank: pro > trial. Legacy VIP rows are normalized to Pro.
 */
export function claimsFromLicensePlan(
  plan: LicensePlan | 'vip',
  expAtIso: string,
  hwid?: string,
): EntitlementClaims {
  const exp = Math.floor(new Date(expAtIso).getTime() / 1000);
  const is_trial = plan === 'trial';
  const is_pro = plan === 'pro' || plan === 'vip' || is_trial;
  return {
    is_pro,
    is_vip: false,
    is_trial: is_trial || undefined,
    plan: is_trial ? 'trial' : 'pro',
    exp,
    ...(hwid ? { hwid: hwid.trim().toLowerCase() } : {}),
  };
}

function planRank(plan: string): number {
  if (plan === 'vip') return 2;
  if (plan === 'pro') return 2;
  if (plan === 'trial') return 1;
  return 0;
}

export type CloudLicenseLookup = {
  found: boolean;
  claims: EntitlementClaims | null;
  licenseId?: string;
  status?: string;
  plan?: LicensePlan;
  expAt?: string;
  hwid?: string;
  source: 'supabase' | 'none';
};

/** Primary authority: active license row for this HWID (case-insensitive). */
export async function resolveLicenseByHwid(
  service: SupabaseClient,
  hwid: string,
): Promise<CloudLicenseLookup> {
  const id = (hwid || '').trim().toLowerCase();
  if (!id || id.length < 6) {
    return { found: false, claims: null, source: 'supabase' };
  }

  const { data: rows, error } = await service
    .from('licenses')
    .select('id,status,exp_at,hwid,plan,token_hash')
    .ilike('hwid', id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new AppError(`Supabase licenses: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  const now = Date.now();

  // Mark past-exp actives as expired
  for (const r of rows || []) {
    if (r.status === 'active' && new Date(r.exp_at).getTime() < now) {
      void service
        .from('licenses')
        .update({ status: 'expired' })
        .eq('id', r.id);
    }
  }

  const active = (rows || [])
    .filter(
      (r) =>
        r.status === 'active' &&
        Number.isFinite(new Date(r.exp_at).getTime()) &&
        new Date(r.exp_at).getTime() >= now,
    )
    .sort((a, b) => {
      const pr = planRank(b.plan) - planRank(a.plan);
      if (pr !== 0) return pr;
      return new Date(b.exp_at).getTime() - new Date(a.exp_at).getTime();
    });

  const best = active[0];
  if (!best) {
    const revoked = (rows || []).find((r) => r.status === 'revoked');
    return {
      found: false,
      claims: null,
      source: 'supabase',
      status: revoked ? 'revoked' : 'none',
      hwid: id,
    };
  }

  return {
    found: true,
    claims: claimsFromLicensePlan(
      best.plan as LicensePlan,
      best.exp_at,
      id,
    ),
    licenseId: best.id as string,
    status: best.status as string,
    plan: best.plan as LicensePlan,
    expAt: best.exp_at as string,
    hwid: id,
    source: 'supabase',
  };
}

/**
 * Online verify: when Supabase admin configured → DB is authority.
 * - No matching active row (by token_hash or HWID) → invalid (delete row = Free)
 * - Without Supabase → local Ed25519 verification only
 */
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
    authority: 'supabase' | 'local';
  };
}> {
  const localClaims = verifyEntitlementToken(input.token, {
    requireHwidMatch: false,
  });
  if (!localClaims || (!localClaims.is_pro && !localClaims.is_vip && !localClaims.is_trial)) {
    return {
      valid: false,
      claims: null,
      cloud: { checked: false, revoked: false, authority: 'local' },
    };
  }

  if (input.hwid && localClaims.hwid) {
    if (localClaims.hwid.toLowerCase() !== input.hwid.trim().toLowerCase()) {
      return {
        valid: false,
        claims: null,
        cloud: { checked: false, revoked: false, authority: 'local' },
      };
    }
  }

  if (!input.service || !isSupabaseAdminConfigured()) {
    return {
      valid: true,
      claims: localClaims,
      cloud: { checked: false, revoked: false, authority: 'local' },
    };
  }

  const th = hashToken(input.token);
  const { data: rowByHash } = await input.service
    .from('licenses')
    .select('id,status,exp_at,hwid,plan')
    .eq('token_hash', th)
    .maybeSingle();

  // Prefer HWID row authority (covers re-issue / hash mismatch after secret rotate)
  const hwid =
    (input.hwid || localClaims.hwid || '').trim().toLowerCase() || undefined;
  if (hwid) {
    const byHwid = await resolveLicenseByHwid(input.service, hwid);
    if (byHwid.found && byHwid.claims) {
      // Token optional: if present and hash row revoked, deny
      if (rowByHash && (rowByHash.status === 'revoked' || rowByHash.status === 'expired')) {
        return {
          valid: false,
          claims: null,
          cloud: {
            checked: true,
            revoked: rowByHash.status === 'revoked',
            licenseId: rowByHash.id,
            status: rowByHash.status,
            authority: 'supabase',
          },
        };
      }
      return {
        valid: true,
        claims: byHwid.claims,
        cloud: {
          checked: true,
          revoked: false,
          licenseId: byHwid.licenseId,
          status: byHwid.status,
          authority: 'supabase',
        },
      };
    }
    // No active license for HWID → Free even if the offline token is still signed.
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: byHwid.status === 'revoked',
        status: byHwid.status || 'none',
        authority: 'supabase',
      },
    };
  }

  if (!rowByHash) {
    // Supabase authority: missing row = not licensed
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: false,
        status: 'none',
        authority: 'supabase',
      },
    };
  }

  if (rowByHash.status === 'revoked' || rowByHash.status === 'expired') {
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: true,
        licenseId: rowByHash.id,
        status: rowByHash.status,
        authority: 'supabase',
      },
    };
  }

  if (new Date(rowByHash.exp_at).getTime() < Date.now()) {
    await input.service
      .from('licenses')
      .update({ status: 'expired' })
      .eq('id', rowByHash.id);
    return {
      valid: false,
      claims: null,
      cloud: {
        checked: true,
        revoked: false,
        licenseId: rowByHash.id,
        status: 'expired',
        authority: 'supabase',
      },
    };
  }

  return {
    valid: true,
    claims: claimsFromLicensePlan(
      (rowByHash.plan as LicensePlan) || 'pro',
      rowByHash.exp_at,
      rowByHash.hwid,
    ),
    cloud: {
      checked: true,
      revoked: false,
      licenseId: rowByHash.id,
      status: rowByHash.status,
      authority: 'supabase',
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
