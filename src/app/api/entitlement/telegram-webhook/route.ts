/**
 * Telegram Bot webhook — admin ops: issue key, bare-HWID wizard, lookup/list/revoke.
 *
 * Commands: /help /status /plans /activate|/gen|/cap /lookup /list /revoke
 * Payment: inline ✅ Cấp Key / ❌ Từ chối
 *
 * Modes:
 * - Vercel bridge (prod): deploy/telegram-bridge + setWebhook
 * - Desktop/local seller: long-poll getUpdates via telegramPoller
 *
 * Setup: GET ?setup=true&url=https://… · poll: GET ?poll=1
 */
import { NextResponse } from 'next/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  setTelegramWebhook,
  telegramConfigured,
  telegramBotToken,
} from '@/lib/commercial/telegramNotify';
import {
  processTelegramUpdate,
  type TgUpdate,
} from '@/lib/commercial/telegramWebhookHandler';
import {
  ensureTelegramPoller,
  getTelegramPollerStatus,
} from '@/lib/commercial/telegramPoller';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyTelegramSecret(req: Request): boolean {
  const expected = (process.env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!expected) return true;
  const got =
    req.headers.get('x-telegram-bot-api-secret-token') ||
    req.headers.get('X-Telegram-Bot-Api-Secret-Token') ||
    '';
  return got === expected;
}

export async function POST(req: Request) {
  try {
    if (!telegramBotToken()) {
      throw new AppError('Bot token chưa cấu hình trên server.', {
        code: 'INFRA',
        status: 503,
      });
    }
    if (!verifyTelegramSecret(req)) {
      throw new AppError('Telegram webhook secret không khớp.', {
        code: 'AUTH',
        status: 401,
      });
    }

    const body = (await req.json().catch(() => ({}))) as TgUpdate;
    await processTelegramUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const setup = searchParams.get('setup');
  const hostUrl = searchParams.get('url');
  const poll = searchParams.get('poll');

  // Force start desktop long-poll (when webhook empty)
  if (poll === '1' || poll === 'true' || poll === 'start') {
    const st = ensureTelegramPoller();
    return NextResponse.json({
      ok: true,
      poller: getTelegramPollerStatus(),
      started: st,
      hint:
        'Nếu mode=polling: bấm ✅ Cấp Key trên Telegram — app đang long-poll. ' +
        'Nếu webhook-present: Vercel nhận nút (không poll).',
    });
  }

  if (setup === 'true') {
    if (!hostUrl?.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Thiếu url. Ví dụ: ?setup=true&url=https://your-app.vercel.app',
        },
        { status: 400 },
      );
    }
    if (!telegramConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Thiếu AINOVEL_TELEGRAM_BOT_TOKEN / AINOVEL_TELEGRAM_CHAT_ID trên server.',
        },
        { status: 503 },
      );
    }
    const result = await setTelegramWebhook(hostUrl.trim());
    return NextResponse.json({
      ok: result.ok,
      webhookUrl: result.webhookUrl,
      data: result.data,
      error: result.error,
      hint: result.ok
        ? 'Webhook OK. Nút ✅ Cấp Key sẽ gọi Vercel. Desktop poller sẽ tự dừng.'
        : undefined,
    });
  }

  // Status + auto-start poller when no public webhook
  const poller = ensureTelegramPoller();
  return NextResponse.json({
    ok: true,
    endpoint: '/api/entitlement/telegram-webhook',
    telegramConfigured: telegramConfigured(),
    supabaseAdmin: isSupabaseAdminConfigured(),
    poller: getTelegramPollerStatus(),
    autoStart: poller,
    message:
      'POST: Telegram webhook. GET ?poll=1 start long-poll. GET ?setup=true&url=https://… setWebhook Vercel.',
  });
}
