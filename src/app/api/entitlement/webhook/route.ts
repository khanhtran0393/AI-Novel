/**
 * Payment webhook → issue activation code or HWID-bound token.
 * POST + secret header / body.
 */
import { NextResponse } from 'next/server';
import {
  authorizePaymentWebhook,
  processPaymentWebhook,
  type PaymentWebhookBody,
} from '@/lib/commercial/paymentWebhook';
import { getEntitlementMode, resolveEntitlementSecret } from '@/lib/entitlement';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as PaymentWebhookBody;
    const auth = authorizePaymentWebhook(req, body);
    if (!auth.ok) {
      throw new AppError(auth.reason || 'Unauthorized webhook', {
        code: 'AUTH',
        status: 403,
      });
    }

    if (getEntitlementMode() === 'enforce') {
      const sec = resolveEntitlementSecret();
      if (!sec.ok) {
        throw new AppError(sec.reason || 'Secret misconfigured', {
          code: 'INFRA',
          status: 503,
        });
      }
    }

    const result = processPaymentWebhook(body);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/entitlement/webhook',
    auth: [
      'Header x-ainovel-webhook-secret = AINOVEL_PAYMENT_WEBHOOK_SECRET',
      'Or body.webhookSecret',
      'Or body.adminKey = AINOVEL_ENTITLEMENT_ADMIN_KEY',
    ],
    bodyExample: {
      provider: 'generic',
      orderId: 'ord_123',
      email: 'buyer@example.com',
      plan: 'pro',
      issueMode: 'code',
      expSeconds: 31536000,
    },
  });
}
