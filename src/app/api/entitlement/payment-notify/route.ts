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
  buildPayTelegramDeepLink,
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
      const remoteOk = remote.payload.ok === true;
      const messageId = remote.payload.messageId;
      if (
        remote.status >= 200 &&
        remote.status < 300 &&
        remoteOk &&
        (typeof messageId !== 'number' || !Number.isFinite(messageId))
      ) {
        // Fail-closed: proxy 200 without messageId means Admin never got the ticket
        throw new AppError(
          'License server trả OK nhưng không có messageId Telegram — Admin chưa nhận tin. Thử lại hoặc báo Zalo.',
          { code: 'INFRA', status: 502 },
        );
      }
      const deepLink = buildPayTelegramDeepLink(planId, hwid);
      return NextResponse.json(
        {
          ...remote.payload,
          telegramUrl: deepLink,
          telegramDeepLink: deepLink,
          telegram: SELLER_BANK.telegramBotDisplay,
          zalo: SELLER_BANK.zaloDisplay,
          zaloUrl: `https://zalo.me/${SELLER_BANK.zalo}`,
          authority: 'license-api',
          notified: remoteOk && typeof messageId === 'number',
        },
        { status: remote.status },
      );
    }

    if (!telegramConfigured()) {
      throw new AppError(
        `Telegram admin chưa cấu hình trên server. Mở ${SELLER_BANK.telegramBotDisplay} (${SELLER_BANK.telegramBotUrl}) hoặc Zalo ${SELLER_BANK.zaloDisplay} — gửi bill + HWID ${hwid.toUpperCase()}.`,
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

    if (!result.ok || result.messageId == null) {
      throw new AppError(
        result.error ||
          'Gửi Telegram thất bại — Admin chưa nhận tin (không có message_id).',
        {
          code: result.cooldown ? 'QUOTA' : 'INFRA',
          status: result.cooldown ? 429 : 502,
        },
      );
    }

    const deepLink = buildPayTelegramDeepLink(planId, hwid);

    return NextResponse.json({
      ok: true,
      message:
        'Admin đã nhận báo thanh toán trên Telegram (nút Cấp Key / Từ chối). Chờ key — không cần chat bot trống.',
      messageId: result.messageId,
      hwid: hwid.toUpperCase(),
      planId,
      telegramUrl: deepLink,
      telegram: SELLER_BANK.telegramBotDisplay,
      telegramDeepLink: deepLink,
      zalo: SELLER_BANK.zaloDisplay,
      zaloUrl: `https://zalo.me/${SELLER_BANK.zalo}`,
      poller: getTelegramPollerStatus(),
      authority: 'local',
      notified: true,
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
      telegramUrl: SELLER_BANK.telegramBotUrl,
      telegram: SELLER_BANK.telegramBotDisplay,
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
    telegramUrl: SELLER_BANK.telegramBotUrl,
    telegram: SELLER_BANK.telegramBotDisplay,
    zalo: SELLER_BANK.zaloDisplay,
    poller: getTelegramPollerStatus(),
    mode: 'local-telegram',
  });
}
