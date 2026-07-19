/**
 * Seller Telegram notify — "Đã thanh toán" from license modal.
 * Env: AINOVEL_TELEGRAM_BOT_TOKEN + AINOVEL_TELEGRAM_CHAT_ID
 */

import type { PaidPlanId } from './pricingPlans';
import { PAID_PLANS, SELLER_BANK, buildTransferContent, formatVnd } from './pricingPlans';

export type PaymentNotifyPayload = {
  hwid: string;
  planId: PaidPlanId;
  note?: string;
};

/** Simple in-memory cooldown (per process) — 1 report / HWID / 2 minutes */
const lastReportAt = new Map<string, number>();
const COOLDOWN_MS = 120_000;

export function telegramConfigured(): boolean {
  return Boolean(
    (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim() &&
      (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim(),
  );
}

export function buildPaymentNotifyMessage(p: PaymentNotifyPayload): string {
  const plan = PAID_PLANS.find((x) => x.id === p.planId) || PAID_PLANS[2];
  const hwid = (p.hwid || 'UNKNOWN').toUpperCase();
  const content = buildTransferContent(p.planId, hwid);
  const lines = [
    '🔔 AI Novel — Báo đã thanh toán',
    '',
    `📦 Gói: ${plan.label} (${plan.id})`,
    `💰 Số tiền: ${formatVnd(plan.priceVnd)}`,
    `🖥 HWID: ${hwid}`,
    `📝 Nội dung CK: ${content}`,
    `🏦 ${SELLER_BANK.bankName} · ${SELLER_BANK.accountNo} · ${SELLER_BANK.accountName}`,
    `📱 Zalo khách liên hệ: ${SELLER_BANK.zaloDisplay}`,
    `🕐 ${new Date().toISOString()}`,
  ];
  if (p.note?.trim()) lines.push(`💬 Ghi chú: ${p.note.trim()}`);
  lines.push('', '→ Kiểm tra bill + cấp key (AINOVEL / token) cho HWID trên.');
  return lines.join('\n');
}

export async function sendTelegramMessage(text: string, reply_markup?: any): Promise<{
  ok: boolean;
  error?: string;
  messageId?: number;
}> {
  const token = (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) {
    return {
      ok: false,
      error:
        'Chưa cấu hình Telegram (AINOVEL_TELEGRAM_BOT_TOKEN / AINOVEL_TELEGRAM_CHAT_ID).',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(reply_markup ? { reply_markup } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.description || `Telegram HTTP ${res.status}`,
      };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function notifyPaymentReported(p: PaymentNotifyPayload): Promise<{
  ok: boolean;
  cooldown?: boolean;
  error?: string;
  messageId?: number;
  text?: string;
}> {
  const hwid = (p.hwid || '').trim().toUpperCase();
  if (!hwid || hwid.length < 6) {
    return { ok: false, error: 'Thiếu mã thiết bị (HWID).' };
  }

  const now = Date.now();
  const last = lastReportAt.get(hwid) || 0;
  if (now - last < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return {
      ok: false,
      cooldown: true,
      error: `Bạn vừa báo rồi. Thử lại sau ~${waitSec}s (tránh spam).`,
    };
  }

  const text = buildPaymentNotifyMessage({ ...p, hwid });
  const sent = await sendTelegramMessage(text, {
    inline_keyboard: [
      [
        { text: '✅ Cấp Key', callback_data: `issue_${hwid}_${p.planId}` },
        { text: '❌ Từ chối', callback_data: `reject_${hwid}` },
      ],
    ],
  });
  if (!sent.ok) return { ok: false, error: sent.error, text };
  lastReportAt.set(hwid, now);
  return { ok: true, messageId: sent.messageId, text };
}
