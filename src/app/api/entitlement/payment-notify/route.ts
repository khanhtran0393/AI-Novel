/**
 * POST — user bấm "Đã thanh toán" → báo Admin qua Telegram.
 * Body: { hwid?, planId, note? }
 *
 * Packaged customer app: **never** embeds bot token — proxy to license API
 * (Vercel) where TELEGRAM_* secrets live. Same pattern as activate/trial.
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
import { isPackagedCustomerRuntime } from '@/lib/commercial/sellerRuntime';
import { proxyLicenseApiPost } from '@/lib/commercial/licenseApiProxy';

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

    // Installed desktop: forward to seller HTTPS (Telegram secrets only on server)
    if (isPackagedCustomerRuntime()) {
      const remote = await proxyLicenseApiPost(
        '/api/entitlement/payment-notify',
        {
          hwid,
          planId,
          note: typeof body.note === 'string' ? body.note : undefined,
        },
      );
      if (remote.status < 200 || remote.status >= 300) {
        throw new AppError(
          String(
            remote.payload.error ||
              remote.payload.message ||
              `Báo Admin HTTP ${remote.status}. Kiểm tra mạng / license API.`,
          ),
          {
            code:
              remote.status === 429
                ? 'QUOTA'
                : remote.status === 401 || remote.status === 403
                  ? 'AUTH'
                  : 'INFRA',
            status: remote.status,
          },
        );
      }
      return NextResponse.json(
        {
          ...remote.payload,
          zalo: SELLER_BANK.zaloDisplay,
          zaloUrl: `https://zalo.me/${SELLER_BANK.zalo}`,
          authority: 'license-api',
        },
        { status: remote.status },
      );
    }

    if (!telegramConfigured()) {
      throw new AppError(
        `Telegram admin chưa cấu hình trên server. Liên hệ Zalo ${SELLER_BANK.zaloDisplay} và gửi bill + HWID ${hwid.toUpperCase()}.`,
        { code: 'INFRA', status: 503 },
      );
    }

    // Dev/seller desktop: long-poll getUpdates so ✅ Cấp Key works without public webhook
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
      authority: 'local',
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET() {
  // Packaged customer: report whether cloud path is intended (no secrets locally)
  if (isPackagedCustomerRuntime()) {
    return NextResponse.json({
      ok: true,
      endpoint: '/api/entitlement/payment-notify',
      mode: 'proxy-license-api',
      telegramConfigured: true,
      zalo: SELLER_BANK.zaloDisplay,
      note: 'Packaged app proxies to Vercel; bot token never in installer.',
    });
  }
  // Keep poller warm when admin opens settings / health (dev/seller only)
  if (telegramConfigured()) ensureTelegramPoller();
  return NextResponse.json({
    ok: true,
    endpoint: '/api/entitlement/payment-notify',
    telegramConfigured: telegramConfigured(),
    zalo: SELLER_BANK.zaloDisplay,
    poller: getTelegramPollerStatus(),
    mode: 'local-telegram',
  });
}
