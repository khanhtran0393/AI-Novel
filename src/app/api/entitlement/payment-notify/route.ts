/**
 * POST — user bấm "Đã thanh toán" → báo Admin qua Telegram.
 * Body: { hwid?, planId, note? }
 */
import { NextResponse } from 'next/server';
import { getHwid } from '@/lib/entitlement';
import {
  notifyPaymentReported,
  telegramConfigured,
} from '@/lib/commercial/telegramNotify';
import {
  ensureTelegramPoller,
  getTelegramPollerStatus,
} from '@/lib/commercial/telegramPoller';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import { PAID_PLANS, SELLER_BANK } from '@/lib/commercial/pricingPlans';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      hwid?: string;
      planId?: string;
      note?: string;
    };

    const planId = (body.planId || 'lifetime') as PaidPlanId;
    if (!PLAN_IDS.has(planId)) {
      throw new AppError('Gói không hợp lệ (month|year|lifetime).', {
        code: 'VALIDATION',
        status: 400,
      });
    }

    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();

    if (!telegramConfigured()) {
      throw new AppError(
        `Telegram admin chưa cấu hình trên server. Liên hệ Zalo ${SELLER_BANK.zaloDisplay} và gửi bill + HWID ${hwid.toUpperCase()}.`,
        { code: 'INFRA', status: 503 },
      );
    }

    // Desktop: long-poll getUpdates so ✅ Cấp Key works without public webhook
    ensureTelegramPoller();

    const result = await notifyPaymentReported({
      hwid,
      planId,
      note: typeof body.note === 'string' ? body.note : undefined,
    });

    if (!result.ok) {
      throw new AppError(result.error || 'Gửi Telegram thất bại', {
        code: result.cooldown ? 'QUOTA' : 'INFRA',
        status: result.cooldown ? 429 : 502,
      });
    }

    return NextResponse.json({
      ok: true,
      message:
        'Đã báo Admin (Telegram có nút Cấp Key / Từ chối). Gửi bill + HWID qua Zalo để nhận key nhanh hơn.',
      messageId: result.messageId,
      hwid: hwid.toUpperCase(),
      planId,
      zalo: SELLER_BANK.zaloDisplay,
      zaloUrl: `https://zalo.me/${SELLER_BANK.zalo}`,
      poller: getTelegramPollerStatus(),
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  // Keep poller warm when admin opens settings / health
  if (telegramConfigured()) ensureTelegramPoller();
  return NextResponse.json({
    ok: true,
    endpoint: '/api/entitlement/payment-notify',
    telegramConfigured: telegramConfigured(),
    zalo: SELLER_BANK.zaloDisplay,
    poller: getTelegramPollerStatus(),
  });
}
