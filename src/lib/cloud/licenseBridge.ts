/**
 * Cloud license bridge — Ed25519 issue/verify + sole-truth Supabase ledger.
 * Orders, revoke, audit, trial and paid Pro all converge on licenses rows.
 */

import crypto from 'crypto';
import {
  claimsIsTrial,
  issueEntitlementToken,
  verifyEntitlementToken,
  type EntitlementClaims,
} from '@/lib/entitlement';
import {
  PAID_PLANS,
  buildTransferContent,
  type PaidPlanId,
} from '@/lib/commercial/pricingPlans';
import {
  generateActivationCode,
  formatExpSecondsLabel,
  type ActivationCodeRecord,
} from '@/lib/commercial/activationVault';
import { AppError } from '@/lib/errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LicensePlan, OrderPlan } from '@/lib/supabase/types';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Placeholder HWID for pre-issued activation codes (any machine may claim once).
 * Format: `unbound:<16hex>` — unique per code, never a real device fingerprint.
 */
export const UNBOUND_HWID_PREFIX = 'unbound:';

export function isUnboundLicenseHwid(hwid: string | null | undefined): boolean {
  const h = String(hwid || '')
    .trim()
    .toLowerCase();
  if (!h) return true;
  return (
    h === 'unbound' ||
    h === 'pending' ||
    h.startsWith(UNBOUND_HWID_PREFIX) ||
    h.startsWith('pending:')
  );
}

export function unboundHwidForCode(code: string): string {
  const dig = crypto
    .createHash('sha256')
    .update(String(code || '').trim().toUpperCase(), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${UNBOUND_HWID_PREFIX}${dig}`;
}

/**
 * `licenses.user_id` = mã thiết bị (HWID) của app user.
 * Desktop không bắt login Auth — cột này neo máy, cùng chuẩn hóa với `hwid`.
 * Cần migration 003 (user_id text). Trước 003 cột uuid → insert dùng null.
 */
export function licenseDeviceUserId(hwid: string): string {
  return String(hwid || '')
    .trim()
    .toLowerCase();
}

function isUuidUserIdColumnError(message: string | undefined | null): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('invalid input syntax for type uuid') ||
    (m.includes('user_id') && m.includes('uuid')) ||
    m.includes('22p02')
  );
}

export type LicenseInsertRow = {
  hwid: string;
  plan: 'trial' | 'pro' | string;
  status?: string;
  exp_at: string;
  token_hash?: string | null;
  activation_code?: string | null;
  order_id?: string | null;
};

/**
 * Insert licenses row — sole-truth ledger write.
 * Prefers user_id = HWID; if column still uuid (pre-003), retries user_id=null
 * so Trial/Pro still land on Supabase (never silent local-only).
 */
export async function insertLicenseRow(
  service: SupabaseClient,
  row: LicenseInsertRow,
): Promise<{ id: string; userIdWritten: string | null }> {
  const hwid = licenseDeviceUserId(row.hwid);
  if (!hwid || hwid.length < 6) {
    throw new AppError('HWID không hợp lệ khi ghi licenses.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const base = {
    plan: row.plan,
    hwid,
    status: row.status || 'active',
    exp_at: row.exp_at,
    token_hash: row.token_hash ?? null,
    activation_code: row.activation_code ?? null,
    order_id: row.order_id ?? null,
  };

  const withDevice = { ...base, user_id: hwid };
  let { data, error } = await service
    .from('licenses')
    .insert(withDevice)
    .select('id')
    .single();

  if (error && isUuidUserIdColumnError(error.message)) {
    const retry = await service
      .from('licenses')
      .insert({ ...base, user_id: null })
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
    if (!error && data) {
      return { id: String(data.id), userIdWritten: null };
    }
  }

  if (error || !data) {
    throw new AppError(
      `Ghi Supabase licenses thất bại (sole truth): ${error?.message || 'unknown'}`,
      { code: 'INFRA', status: 502 },
    );
  }
  return { id: String(data.id), userIdWritten: hwid };
}

/** Update user_id/hwid; skip user_id if column still uuid. */
export async function updateLicenseDeviceFields(
  service: SupabaseClient,
  licenseId: string,
  hwid: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const device = licenseDeviceUserId(hwid);
  const full = { hwid: device, user_id: device, ...(extra || {}) };
  const { error } = await service.from('licenses').update(full).eq('id', licenseId);
  if (error && isUuidUserIdColumnError(error.message)) {
    const { error: e2 } = await service
      .from('licenses')
      .update({ hwid: device, ...(extra || {}) })
      .eq('id', licenseId);
    if (e2) {
      throw new AppError(`Update license fail: ${e2.message}`, {
        code: 'INFRA',
        status: 502,
      });
    }
    return;
  }
  if (error) {
    throw new AppError(`Update license fail: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }
}

/**
 * Persist an already-signed paid-Pro token to the sole-truth ledger.
 *
 * A successful return guarantees that the active row carries the exact token
 * hash and token expiry. Callers must not deliver the token before this
 * function succeeds.
 */
export async function persistIssuedProToken(input: {
  service: SupabaseClient;
  token: string;
  hwid: string;
  actorId?: string;
  source: string;
}): Promise<{ licenseId: string; expAt: string }> {
  const hwid = licenseDeviceUserId(input.hwid);
  const claims = verifyEntitlementToken(input.token, {
    requireHwidMatch: false,
  });
  if (!claimsArePaidPro(claims)) {
    throw new AppError('Token cấp phát không phải Paid Pro hợp lệ.', {
      code: 'AUTH',
      status: 401,
    });
  }
  const tokenHwid = licenseDeviceUserId(claims?.hwid || '');
  if (!tokenHwid || tokenHwid !== hwid) {
    throw new AppError('Token cấp phát không khớp HWID ledger.', {
      code: 'AUTH',
      status: 401,
    });
  }
  const expAt = new Date(
    Math.max(0, Number(claims?.exp || 0)) * 1000,
  ).toISOString();
  if (
    !Number.isFinite(new Date(expAt).getTime()) ||
    new Date(expAt).getTime() <= Date.now()
  ) {
    throw new AppError('Token cấp phát đã hết hạn hoặc thiếu exp.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const tokenHash = hashToken(input.token);
  const { data: activeRows, error: selectError } = await input.service
    .from('licenses')
    .select('id,status,plan,created_at')
    .ilike('hwid', hwid)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(20);
  if (selectError) {
    throw new AppError(`Supabase licenses: ${selectError.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  const rows = activeRows || [];
  const primary = rows[0];
  let licenseId: string;
  if (primary?.id) {
    await updateLicenseDeviceFields(
      input.service,
      String(primary.id),
      hwid,
      {
        plan: 'pro',
        status: 'active',
        exp_at: expAt,
        token_hash: tokenHash,
        activation_code: null,
      },
    );
    licenseId = String(primary.id);
  } else {
    const inserted = await insertLicenseRow(input.service, {
      plan: 'pro',
      hwid,
      status: 'active',
      exp_at: expAt,
      token_hash: tokenHash,
      activation_code: null,
    });
    licenseId = inserted.id;
  }

  const duplicateIds = rows
    .filter((row) => String(row.id) !== licenseId)
    .map((row) => String(row.id));
  if (duplicateIds.length > 0) {
    const { error: expireError } = await input.service
      .from('licenses')
      .update({ status: 'expired' })
      .in('id', duplicateIds);
    if (expireError) {
      throw new AppError(
        `Không thể đóng license trùng HWID: ${expireError.message}`,
        { code: 'INFRA', status: 502 },
      );
    }
  }

  await auditLog(
    input.service,
    'license.issue_persisted',
    {
      licenseId,
      hwid,
      source: input.source,
      tokenHash,
      expAt,
      duplicateRowsExpired: duplicateIds.length,
    },
    input.actorId || 'seller',
  );
  return { licenseId, expAt };
}

/** Redeem a persistent Supabase activation code and issue a fresh HWID token. */
export async function redeemCloudActivationCode(input: {
  service: SupabaseClient;
  code: string;
  hwid: string;
}): Promise<{
  token: string;
  claims: EntitlementClaims;
  licenseId: string;
  firstBind?: boolean;
  alreadyRedeemedSameMachine?: boolean;
}> {
  const code = input.code.trim().toUpperCase();
  const hwid = input.hwid.trim().toLowerCase();
  if (!hwid || hwid.length < 8) {
    throw new AppError('Thiếu HWID máy hợp lệ.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  const { data: row, error } = await input.service
    .from('licenses')
    .select('id,plan,hwid,status,exp_at,activation_code,created_at')
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

  const rowHwid = String(row.hwid || '')
    .trim()
    .toLowerCase();
  const unbound = isUnboundLicenseHwid(rowHwid);
  const sameMachine = !unbound && rowHwid === hwid;

  // Already claimed by another machine — hard fail with bound HWID notice
  if (!unbound && !sameMachine) {
    const short =
      rowHwid.toUpperCase().slice(0, 16) + (rowHwid.length > 16 ? '…' : '');
    throw new AppError(
      `Mã đã được nhập rồi — gắn máy HWID ${short}. Mỗi mã chỉ nhận 1 HWID. Liên hệ seller nếu cần chuyển máy.`,
      { code: 'AUTH', status: 403 },
    );
  }

  const nowMs = Date.now();
  let expAtMs = new Date(row.exp_at).getTime();
  let firstBind = false;

  // First machine to claim an unbound code: bind HWID + start entitlement clock from now
  // (preserve intended duration = exp_at − created_at from issue time).
  if (unbound) {
    firstBind = true;
    const createdMs = row.created_at
      ? new Date(row.created_at).getTime()
      : nowMs;
    const intendedMs = Number.isFinite(expAtMs)
      ? Math.max(expAtMs - createdMs, 60_000)
      : 60 * 60 * 24 * 365 * 1000;
    expAtMs = nowMs + intendedMs;
  }

  const secondsLeft = Math.floor((expAtMs - nowMs) / 1000);
  if (!Number.isFinite(secondsLeft) || secondsLeft <= 0) {
    await input.service
      .from('licenses')
      .update({ status: 'expired' })
      .eq('id', row.id);
    throw new AppError('License / mã đã hết hạn.', { code: 'AUTH', status: 403 });
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

  const extra: Record<string, unknown> = {
    token_hash: hashToken(token),
    status: 'active',
  };
  if (firstBind) {
    extra.exp_at = new Date(expAtMs).toISOString();
  }

  await updateLicenseDeviceFields(input.service, String(row.id), hwid, extra);

  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims || claims.hwid?.toLowerCase() !== hwid) {
    throw new AppError('Token vừa cấp không verify được.', {
      code: 'INFRA',
      status: 500,
    });
  }
  return {
    token,
    claims,
    licenseId: String(row.id),
    firstBind,
    alreadyRedeemedSameMachine: sameMachine,
  };
}

/**
 * Pre-issue Pro activation codes (any HWID may claim once).
 * Writes Supabase licenses rows with unbound placeholder HWID.
 * No local-vault code is created: a code is deliverable only after the whole
 * requested batch has been persisted successfully.
 */
export async function issueUnboundProActivationCodes(input: {
  service?: SupabaseClient | null;
  count?: number;
  expSeconds?: number;
  note?: string;
  orderId?: string;
}): Promise<{
  codes: Array<{
    code: string;
    expSeconds: number;
    expLabel: string;
    licenseId?: string;
    ledgerOk: boolean;
    ledgerError?: string;
  }>;
  count: number;
  expSeconds: number;
  expLabel: string;
  ledgerConfigured: boolean;
}> {
  const count = Math.max(1, Math.min(50, Math.floor(input.count ?? 1)));
  const expSeconds = Math.max(
    60,
    Math.floor(input.expSeconds ?? 60 * 60 * 24 * 365 * 50),
  );
  const expLabel = formatExpSecondsLabel(expSeconds);
  const note =
    input.note ||
    `telegram-gencode count=${count} exp=${expLabel}`;

  const service =
    input.service ||
    (isSupabaseAdminConfigured()
      ? (await import('@/lib/supabase/server')).createServiceSupabase()
      : null);
  const ledgerConfigured = Boolean(service);
  if (!service) {
    throw new AppError(
      'Supabase ledger chưa cấu hình — không tạo mã local ngoài sổ cái.',
      { code: 'INFRA', status: 503 },
    );
  }
  const records = Array.from({ length: count }, () => ({
    code: generateActivationCode(),
  }));
  const expAt = new Date(Date.now() + expSeconds * 1000).toISOString();

  const out: Array<{
    code: string;
    expSeconds: number;
    expLabel: string;
    licenseId?: string;
    ledgerOk: boolean;
    ledgerError?: string;
  }> = [];

  for (const rec of records) {
    const code = rec.code;
    if (!service) {
      out.push({
        code,
        expSeconds,
        expLabel,
        ledgerOk: false,
        ledgerError: 'Supabase chưa cấu hình — chỉ vault local',
      });
      continue;
    }
    try {
      const lic = await insertLicenseRow(service, {
        plan: 'pro',
        hwid: unboundHwidForCode(code),
        status: 'active',
        exp_at: expAt,
        token_hash: null,
        activation_code: code,
        order_id: input.orderId || null,
      });
      await auditLog(
        service,
        'telegram.gencode',
        {
          code,
          licenseId: lic.id,
          expSeconds,
          expLabel,
          note,
          source: 'issueUnboundProActivationCodes',
        },
        'telegram-admin',
      );
      out.push({
        code,
        expSeconds,
        expLabel,
        licenseId: lic.id,
        ledgerOk: true,
      });
    } catch (e) {
      out.push({
        code,
        expSeconds,
        expLabel,
        ledgerOk: false,
        ledgerError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const failed = out.find((item) => !item.ledgerOk);
  if (failed) {
    const insertedIds = out
      .map((item) => item.licenseId)
      .filter((id): id is string => Boolean(id));
    if (insertedIds.length > 0) {
      await service
        .from('licenses')
        .update({ status: 'revoked' })
        .in('id', insertedIds);
    }
    throw new AppError(
      `Ghi ledger mã kích hoạt thất bại; toàn bộ lô đã bị thu hồi: ${
        failed.ledgerError || 'unknown'
      }`,
      { code: 'INFRA', status: 502 },
    );
  }

  return {
    codes: out,
    count: out.length,
    expSeconds,
    expLabel,
    ledgerConfigured,
  };
}

/** @deprecated alias — prefer issueUnboundProActivationCodes */
export async function issueUnboundActivationCodes(
  input: Parameters<typeof issueUnboundProActivationCodes>[0],
): Promise<Awaited<ReturnType<typeof issueUnboundProActivationCodes>>> {
  return issueUnboundProActivationCodes(input);
}

export type { ActivationCodeRecord };

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
 * Issue Pro Ed25519 token for arbitrary duration (e.g. 3/7/15/30 days).
 */
export function issueProLicenseForDuration(
  hwid: string,
  expSeconds: number,
): {
  token: string;
  claims: EntitlementClaims;
  expSeconds: number;
} {
  const id = hwid.trim().toLowerCase();
  if (!id || id.length < 8) {
    throw new AppError('HWID không hợp lệ.', { code: 'VALIDATION', status: 400 });
  }
  const secs = Math.max(60, Math.floor(expSeconds));
  const token = issueEntitlementToken({
    is_pro: true,
    is_vip: false,
    is_trial: false,
    plan: 'pro',
    hwid: id,
    expSeconds: secs,
  });
  if (!token.startsWith('AINOVEL2.')) {
    throw new AppError(
      'Issue token không phải AINOVEL2 (kiểm tra signing key Ed25519).',
      { code: 'INFRA', status: 503 },
    );
  }
  const claims = verifyEntitlementToken(token, { requireHwidMatch: false });
  if (!claims) {
    throw new AppError(
      'Issue token thất bại (signing key / public keyring lệch cặp).',
      { code: 'INFRA', status: 503 },
    );
  }
  return { token, claims, expSeconds: secs };
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
  const issued = issueProLicenseForDuration(hwid, meta.expSeconds);
  return { token: issued.token, claims: issued.claims, meta };
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
    activationCode = generateActivationCode();
  } else {
    const issued = issueHmacForPlan(planId, hwid);
    token = issued.token;
    tokenHash = hashToken(token);
  }

  let licenseId: string;
  let finalExpAt = expAt;
  if (token) {
    const persisted = await persistIssuedProToken({
      service: input.service,
      token,
      hwid,
      actorId: input.actorId || 'order-confirm',
      source: `order.confirm:${order.id}`,
    });
    licenseId = persisted.licenseId;
    finalExpAt = persisted.expAt;
    const { error: orderLinkError } = await input.service
      .from('licenses')
      .update({ order_id: order.id })
      .eq('id', licenseId);
    if (orderLinkError) {
      throw new AppError(`Link license order fail: ${orderLinkError.message}`, {
        code: 'INFRA',
        status: 502,
      });
    }
  } else {
    const lic = await insertLicenseRow(input.service, {
      order_id: order.id,
      plan: meta.licensePlan,
      hwid,
      status: 'active',
      exp_at: expAt,
      token_hash: tokenHash,
      activation_code: activationCode || null,
    });
    licenseId = lic.id;
  }

  const { error: upErr } = await input.service
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', order.id);
  if (upErr) {
    await input.service
      .from('licenses')
      .update({ status: 'revoked' })
      .eq('id', licenseId);
    throw new AppError(`Update order paid fail: ${upErr.message}`, {
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
      licenseId,
      plan: meta.licensePlan,
      hwid,
      issueMode,
    },
    input.actorId,
  );

  return {
    token,
    activationCode,
    licenseId,
    plan: meta.licensePlan,
    hwid,
    expAt: finalExpAt,
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

/** True when claims are paid Pro (not time-boxed trial). */
export function claimsArePaidPro(claims: EntitlementClaims | null | undefined): boolean {
  if (!claims) return false;
  if (claimsIsTrial(claims)) return false;
  const plan = String(claims.plan || '');
  return !!(claims.is_pro || claims.is_vip || plan === 'pro' || plan === 'vip');
}

/**
 * Bind a paid Pro token onto an **existing** active licenses row (trial → pro ok).
 * Supabase ledger is sole truth: **never INSERT** when no active row
 * (missing row = ban / expired / not issued — Free until seller re-issues).
 */
export async function promoteHwidLicenseToPaidPro(input: {
  service: SupabaseClient;
  token: string;
  hwid: string;
  exp: number;
}): Promise<{ ok: boolean; licenseId?: string; error?: string }> {
  const hwidNorm = input.hwid.trim().toLowerCase();
  if (!hwidNorm || hwidNorm.length < 6) {
    return { ok: false, error: 'HWID không hợp lệ' };
  }
  const tokenExpMs = Math.max(input.exp, 0) * 1000;
  const tokenHash = hashToken(input.token);

  try {
    // Prefer any active row for this HWID (case-insensitive)
    const { data: rows, error: selErr } = await input.service
      .from('licenses')
      .select('id,status,plan,exp_at')
      .ilike('hwid', hwidNorm)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);
    if (selErr) return { ok: false, error: selErr.message };

    const active = rows || [];
    const primary = active[0] as
      | { id: string; status?: string; plan?: string; exp_at?: string }
      | undefined;
    if (!primary?.id) {
      return {
        ok: false,
        error:
          'Không có license active trên Supabase cho HWID này (đã ban / hết hạn / chưa cấp). Admin phải issue lại row licenses.',
      };
    }

    // Ledger sole truth for expiry: re-bind must never extend past existing exp_at.
    const ledgerExpMs = primary.exp_at
      ? new Date(primary.exp_at).getTime()
      : NaN;
    const boundExpMs =
      Number.isFinite(ledgerExpMs) && ledgerExpMs > 0
        ? Math.min(tokenExpMs, ledgerExpMs)
        : tokenExpMs;
    const expAt = new Date(boundExpMs).toISOString();

    try {
      await updateLicenseDeviceFields(input.service, primary.id, hwidNorm, {
        token_hash: tokenHash,
        exp_at: expAt,
        plan: 'pro',
        status: 'active',
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // Expire other active trial rows so resolveLicenseByHwid cannot stick on trial
    const others = active
      .filter((r) => r.id !== primary.id && (r.plan === 'trial' || !r.plan))
      .map((r) => r.id);
    if (others.length) {
      await input.service
        .from('licenses')
        .update({ status: 'expired' })
        .in('id', others);
    }
    return { ok: true, licenseId: String(primary.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
 * Soft ticket drift: local AINOVEL2 still verifies but hash/exp ≠ ledger.
 * When HWID still has an active licenses row, accept ledger claims (sole truth)
 * and optionally mint a rebound ticket so client can store a matching hash.
 */
export async function rebindTicketToActiveHwidLicense(input: {
  service: SupabaseClient;
  hwid: string;
}): Promise<{
  ok: boolean;
  token?: string;
  claims?: EntitlementClaims;
  licenseId?: string;
  expAt?: string;
  error?: string;
}> {
  const hwid = input.hwid.trim().toLowerCase();
  if (hwid.length < 6) {
    return { ok: false, error: 'HWID invalid' };
  }
  try {
    const byHwid = await resolveLicenseByHwid(input.service, hwid);
    if (!byHwid.found || !byHwid.claims || !byHwid.licenseId || !byHwid.expAt) {
      return {
        ok: false,
        error: byHwid.status === 'revoked' ? 'revoked' : 'none',
      };
    }
    const { resolveEntitlementSigningKey } = await import('@/lib/entitlement');
    const signer = resolveEntitlementSigningKey();
    if (!signer.ok) {
      return {
        ok: true,
        claims: byHwid.claims,
        licenseId: byHwid.licenseId,
        expAt: byHwid.expAt,
        error: 'signer_unavailable',
      };
    }
    const leftSec = Math.max(
      60,
      Math.floor((new Date(byHwid.expAt).getTime() - Date.now()) / 1000),
    );
    const isTrial = claimsIsTrial(byHwid.claims);
    const token = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      is_trial: isTrial,
      plan: isTrial ? 'trial' : 'pro',
      hwid,
      expSeconds: leftSec,
    });
    await updateLicenseDeviceFields(input.service, byHwid.licenseId, hwid, {
      token_hash: hashToken(token),
      // Never extend past existing ledger exp
      exp_at: byHwid.expAt,
    });
    return {
      ok: true,
      token,
      claims: byHwid.claims,
      licenseId: byHwid.licenseId,
      expAt: byHwid.expAt,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Online verify: **Supabase licenses table is sole truth** when admin configured.
 * - Exact token_hash + exp match → valid (ledger claims)
 * - Soft ticket drift (hash/exp) but HWID still active → valid via HWID (+ optional rebindToken)
 * - Hard deny: revoked / expired / no HWID row → invalid (**delete row = Free**)
 * - Without Supabase service on this process → local ticket only (packaged must proxy
 *   to LICENSE_API which has Supabase; see /api/cloud/license/verify)
 */
export async function verifyLicenseCloud(input: {
  service: SupabaseClient | null;
  token: string;
  hwid?: string;
}): Promise<{
  valid: boolean;
  claims: EntitlementClaims | null;
  /** Fresh ticket matching ledger (when signer available after soft drift). */
  rebindToken?: string;
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
    // No ledger on this host — ticket only. Callers that need sole-truth must
    // use packaged proxy → LICENSE_API (has Supabase) or configure SERVICE_ROLE.
    return {
      valid: true,
      claims: localClaims,
      cloud: { checked: false, revoked: false, authority: 'local' },
    };
  }

  const th = hashToken(input.token);
  const { data: rowByHash, error: hashLookupError } = await input.service
    .from('licenses')
    .select('id,status,exp_at,hwid,plan')
    .eq('token_hash', th)
    .maybeSingle();
  if (hashLookupError) {
    throw new AppError(`Supabase token_hash: ${hashLookupError.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }

  const hwid =
    (input.hwid || localClaims.hwid || '').trim().toLowerCase() || undefined;

  /** Soft recovery: HWID still active on ledger despite ticket drift. */
  const softAcceptHwid = async (
    softStatus: string,
  ): Promise<{
    valid: boolean;
    claims: EntitlementClaims | null;
    rebindToken?: string;
    cloud: {
      checked: boolean;
      revoked: boolean;
      licenseId?: string;
      status?: string;
      authority: 'supabase' | 'local';
    };
  }> => {
    if (!hwid || !input.service) {
      return {
        valid: false,
        claims: null,
        cloud: {
          checked: true,
          revoked: false,
          status: softStatus,
          authority: 'supabase',
        },
      };
    }
    try {
      const rebound = await rebindTicketToActiveHwidLicense({
        service: input.service,
        hwid,
      });
      if (rebound.ok && rebound.claims) {
        return {
          valid: true,
          claims: rebound.claims,
          rebindToken: rebound.token,
          cloud: {
            checked: true,
            revoked: false,
            licenseId: rebound.licenseId,
            status: rebound.token ? 'ticket_rebound' : 'ticket_stale',
            authority: 'supabase',
          },
        };
      }
      if (rebound.error === 'revoked') {
        return {
          valid: false,
          claims: null,
          cloud: {
            checked: true,
            revoked: true,
            status: 'revoked',
            authority: 'supabase',
          },
        };
      }
      return {
        valid: false,
        claims: null,
        cloud: {
          checked: true,
          revoked: false,
          status: rebound.error === 'none' ? 'none' : softStatus,
          authority: 'supabase',
        },
      };
    } catch {
      return {
        valid: false,
        claims: null,
        cloud: {
          checked: true,
          revoked: false,
          status: softStatus,
          authority: 'supabase',
        },
      };
    }
  };

  if (!rowByHash) {
    // Hash miss: sole truth = HWID ledger (not Free solely from ticket drift)
    return softAcceptHwid('token_mismatch');
  }

  if (rowByHash.status === 'revoked' || rowByHash.status === 'expired') {
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

  const rowHwid = String(rowByHash.hwid || '').trim().toLowerCase();
  const claimHwid = String(localClaims.hwid || '').trim().toLowerCase();
  if (
    !hwid ||
    !rowHwid ||
    !claimHwid ||
    rowHwid !== hwid ||
    claimHwid !== hwid
  ) {
    // Token may be for this machine while hash row is stale/other — try HWID
    return softAcceptHwid('hwid_mismatch');
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

  const rowClaims = claimsFromLicensePlan(
    (rowByHash.plan as LicensePlan) || 'pro',
    rowByHash.exp_at,
    rowByHash.hwid,
  );
  const tokenExpMs = Number(localClaims.exp || 0) * 1000;
  const rowExpMs = new Date(rowByHash.exp_at).getTime();
  if (
    claimsIsTrial(localClaims) !== claimsIsTrial(rowClaims) ||
    !Number.isFinite(tokenExpMs) ||
    Math.abs(tokenExpMs - rowExpMs) > 5_000
  ) {
    // Hash matched this machine but ticket claims drifted — ledger exp/plan wins.
    // Do not Free the seat; optionally rebind so client stores matching exp.
    let rebindToken: string | undefined;
    try {
      const rebound = await rebindTicketToActiveHwidLicense({
        service: input.service,
        hwid,
      });
      rebindToken = rebound.token;
    } catch {
      /* ledger claims still win without rebind */
    }
    return {
      valid: true,
      claims: rowClaims,
      rebindToken,
      cloud: {
        checked: true,
        revoked: false,
        licenseId: rowByHash.id,
        status: rebindToken ? 'ticket_rebound' : 'ticket_stale',
        authority: 'supabase',
      },
    };
  }

  return {
    valid: true,
    claims: rowClaims,
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
    input.days ?? (Number(process.env.AINOVEL_TRIAL_DAYS || 7) || 7);

  // Prefer paid Pro already on ledger (ilike HWID) — no need for trial
  const already = await resolveLicenseByHwid(input.service, hwid);
  if (already.found && already.claims && !claimsIsTrial(already.claims)) {
    if (already.claims.is_pro || already.claims.is_vip) {
      // Rebind ticket to existing paid row so token_hash stays in sync
      const rebound = await rebindTicketToActiveHwidLicense({
        service: input.service,
        hwid,
      });
      if (!rebound.ok || !rebound.token) {
        throw new AppError(
          rebound.error ||
            'Máy đã có Pro trên ledger nhưng không mint được ticket (signer/ledger).',
          { code: 'INFRA', status: 503 },
        );
      }
      try {
        const { retireLocalTrialAfterPaidPro } = await import(
          '@/lib/commercial/trial'
        );
        retireLocalTrialAfterPaidPro(hwid);
      } catch {
        /* non-fatal */
      }
      return {
        created: false,
        token: rebound.token,
        expAt:
          rebound.expAt ||
          new Date((already.claims.exp || 0) * 1000).toISOString(),
        licenseId: rebound.licenseId || already.licenseId || '',
      };
    }
  }

  const { data: existingRows } = await input.service
    .from('licenses')
    .select('id,status,exp_at,plan')
    .ilike('hwid', hwid)
    .eq('plan', 'trial')
    .order('created_at', { ascending: false })
    .limit(5);
  const existing = (existingRows || [])[0];

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
      // Supabase is sole trial authority — do not write local trial vault
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
  // Sole truth: MUST land on Supabase. No local vault mirror (ghost TRIAL after Pro).
  const lic = await insertLicenseRow(input.service, {
    plan: 'trial',
    hwid,
    status: 'active',
    exp_at: expAt.toISOString(),
    token_hash: hashToken(token),
  });

  await auditLog(
    input.service,
    'trial.start',
    { hwid, licenseId: lic.id, days, userIdWritten: lic.userIdWritten },
    input.userId,
  );

  return {
    created: true,
    token,
    expAt: expAt.toISOString(),
    licenseId: lic.id,
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

export type LicenseListRow = {
  id: string;
  plan: string;
  status: string;
  hwid: string;
  exp_at: string;
  created_at?: string;
  revoked_at?: string | null;
  activation_code?: string | null;
  order_id?: string | null;
};

/** Admin list licenses (service_role). Filters: plan, status, hwid substring. */
export async function listLicenses(input: {
  service: SupabaseClient;
  plan?: string;
  status?: string;
  q?: string;
  limit?: number;
}): Promise<{ rows: LicenseListRow[]; total: number }> {
  const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
  let query = input.service
    .from('licenses')
    .select(
      'id,plan,status,hwid,exp_at,created_at,revoked_at,activation_code,order_id',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  const plan = (input.plan || '').trim().toLowerCase();
  if (plan && plan !== 'all') {
    query = query.eq('plan', plan);
  }
  const status = (input.status || '').trim().toLowerCase();
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  const q = (input.q || '').trim();
  if (q.length >= 3) {
    query = query.ilike('hwid', `%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new AppError(`List licenses: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }
  return {
    rows: (data || []) as LicenseListRow[],
    total: typeof count === 'number' ? count : (data || []).length,
  };
}
