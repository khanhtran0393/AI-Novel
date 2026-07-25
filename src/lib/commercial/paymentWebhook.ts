/**
 * Payment webhook → Supabase-backed activation code (or direct token).
 * Providers: generic HMAC, stripe-compatible shape, lemon-compatible shape.
 *
 * Env:
 * - AINOVEL_PAYMENT_WEBHOOK_SECRET (required to accept webhooks)
 * - AINOVEL_ENTITLEMENT_ADMIN_KEY can also authorize manual seller posts
 */

import crypto from 'crypto';
import { appendSellerLog } from './sellerLog';
import { issueEntitlementToken } from '@/lib/entitlement';
import {
  issueUnboundProActivationCodes,
  persistIssuedProToken,
} from '@/lib/cloud/licenseBridge';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { createServiceSupabase } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';

export type PaymentProvider = 'generic' | 'stripe' | 'lemon' | 'manual';

export type PaymentWebhookBody = {
  provider?: PaymentProvider;
  event?: string;
  /** Order / session id for idempotency note */
  orderId?: string;
  email?: string;
  plan?: 'pro';
  expSeconds?: number;
  /** If buyer already sent HWID at checkout */
  hwid?: string;
  /** Prefer code (buyer redeems) vs direct token */
  issueMode?: 'code' | 'token';
  /** Shared secret in body (alternative to header) */
  webhookSecret?: string;
  adminKey?: string;
};

function webhookSecret(): string {
  return (process.env.AINOVEL_PAYMENT_WEBHOOK_SECRET || '').trim();
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function authorizePaymentWebhook(
  req: Request,
  body: PaymentWebhookBody,
): { ok: boolean; reason?: string } {
  const sec = webhookSecret();
  const admin = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();

  // Header signatures
  const hSig =
    req.headers.get('x-ainovel-webhook-secret') ||
    req.headers.get('x-webhook-secret') ||
    '';
  if (sec && hSig && timingSafeEqualStr(hSig, sec)) return { ok: true };
  if (sec && body.webhookSecret && timingSafeEqualStr(body.webhookSecret, sec)) {
    return { ok: true };
  }
  if (admin && body.adminKey && timingSafeEqualStr(body.adminKey, admin)) {
    return { ok: true };
  }

  if (!sec && !admin) {
    return {
      ok: false,
      reason:
        'Chưa cấu hình AINOVEL_PAYMENT_WEBHOOK_SECRET hoặc AINOVEL_ENTITLEMENT_ADMIN_KEY.',
    };
  }
  return { ok: false, reason: 'Webhook secret / admin key không hợp lệ.' };
}

export async function processPaymentWebhook(body: PaymentWebhookBody): Promise<{
  ok: boolean;
  provider: PaymentProvider;
  mode: 'code' | 'token';
  codes?: string[];
  token?: string;
  licenseId?: string;
  plan: 'pro';
  orderId?: string;
  message: string;
}> {
  if (!isSupabaseAdminConfigured()) {
    throw new AppError(
      'Supabase SERVICE_ROLE bắt buộc cho payment webhook. Không cấp mã/token local.',
      { code: 'INFRA', status: 503 },
    );
  }
  const service = createServiceSupabase();
  const provider: PaymentProvider = body.provider || 'generic';
  // All paid plans issue as Pro (no VIP product tier)
  const plan = 'pro' as const;
  const expSeconds = body.expSeconds ?? 60 * 60 * 24 * 365;
  const orderId = body.orderId || `ord_${Date.now()}`;
  const issueMode: 'code' | 'token' =
    body.issueMode || (body.hwid ? 'token' : 'code');

  if (issueMode === 'token') {
    const hwid = (body.hwid || '').trim().toLowerCase();
    if (hwid.length < 8) {
      throw new AppError('Payment token mode cần HWID hợp lệ.', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    const token = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      hwid,
      expSeconds,
    });
    const persisted = await persistIssuedProToken({
      service,
      token,
      hwid,
      actorId: `payment:${provider}`,
      source: `payment-webhook:${orderId}`,
    });
    appendSellerLog({
      at: new Date().toISOString(),
      kind: 'webhook',
      plan,
      hwid,
      orderId,
      note: `token via ${provider}`,
      meta: { email: body.email, mode: 'token' },
    });
    return {
      ok: true,
      provider,
      mode: 'token',
      token,
      licenseId: persisted.licenseId,
      plan,
      orderId,
      message: `Đã cấp token PRO gắn HWID ${hwid}.`,
    };
  }

  const issued = await issueUnboundProActivationCodes({
    service,
    count: 1,
    expSeconds,
    note: body.email ? `email:${body.email}` : undefined,
    orderId,
  });
  const records = issued.codes;
  appendSellerLog({
    at: new Date().toISOString(),
    kind: 'webhook',
    plan,
    code: records[0]?.code,
    orderId,
    note: `code via ${provider}`,
    meta: { email: body.email, mode: 'code' },
  });
  return {
    ok: true,
    provider,
    mode: 'code',
    codes: records.map((r) => r.code),
    plan,
    orderId,
    message: `Đã tạo mã kích hoạt ${plan.toUpperCase()}. Gửi codes cho khách.`,
  };
}
