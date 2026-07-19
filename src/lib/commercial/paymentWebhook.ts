/**
 * Payment webhook → activation code (or direct token).
 * Providers: generic HMAC, stripe-compatible shape, lemon-compatible shape.
 *
 * Env:
 * - AINOVEL_PAYMENT_WEBHOOK_SECRET (required to accept webhooks)
 * - AINOVEL_ENTITLEMENT_ADMIN_KEY can also authorize manual seller posts
 */

import crypto from 'crypto';
import { createActivationCodes } from './activationVault';
import { getHwid, issueEntitlementToken } from '@/lib/entitlement';

export type PaymentProvider = 'generic' | 'stripe' | 'lemon' | 'manual';

export type PaymentWebhookBody = {
  provider?: PaymentProvider;
  event?: string;
  /** Order / session id for idempotency note */
  orderId?: string;
  email?: string;
  plan?: 'pro' | 'vip';
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

export function processPaymentWebhook(body: PaymentWebhookBody): {
  ok: boolean;
  provider: PaymentProvider;
  mode: 'code' | 'token';
  codes?: string[];
  token?: string;
  plan: 'pro' | 'vip';
  orderId?: string;
  message: string;
} {
  const provider: PaymentProvider = body.provider || 'generic';
  // All paid plans issue as Pro (no VIP product tier)
  const plan = 'pro' as const;
  const expSeconds = body.expSeconds ?? 60 * 60 * 24 * 365;
  const orderId = body.orderId || `ord_${Date.now()}`;
  const issueMode: 'code' | 'token' =
    body.issueMode || (body.hwid ? 'token' : 'code');

  if (issueMode === 'token') {
    const hwid = (body.hwid || getHwid()).trim().toLowerCase();
    const token = issueEntitlementToken({
      is_pro: true,
      is_vip: false,
      plan: 'pro',
      hwid,
      expSeconds,
    });
    return {
      ok: true,
      provider,
      mode: 'token',
      token,
      plan,
      orderId,
      message: `Đã cấp token PRO gắn HWID ${hwid}.`,
    };
  }

  const records = createActivationCodes({
    count: 1,
    plan,
    expSeconds,
    note: body.email ? `email:${body.email}` : undefined,
    orderId,
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
