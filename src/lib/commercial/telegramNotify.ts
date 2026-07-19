/**
 * Seller Telegram notify — "Đã thanh toán" + inline approve/reject.
 * Env: AINOVEL_TELEGRAM_BOT_TOKEN + AINOVEL_TELEGRAM_CHAT_ID
 *
 * callback_data (≤64 bytes, HWID = 16 hex, no `_` ambiguity):
 *   issue:<planId>:<hwid>
 *   reject:<hwid>
 */

import type { PaidPlanId } from './pricingPlans';
import {
  PAID_PLANS,
  SELLER_BANK,
  buildTransferContent,
  formatVnd,
} from './pricingPlans';

export type PaymentNotifyPayload = {
  hwid: string;
  planId: PaidPlanId;
  note?: string;
};

export type TelegramCallbackAction =
  | { action: 'issue'; planId: PaidPlanId; hwid: string }
  | { action: 'reject'; hwid: string };

/** Simple in-memory cooldown (per process) — 1 report / HWID / 2 minutes */
const lastReportAt = new Map<string, number>();
const COOLDOWN_MS = 120_000;

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

export function telegramConfigured(): boolean {
  return Boolean(
    (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim() &&
      (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim(),
  );
}

export function telegramBotToken(): string {
  return (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
}

export function telegramAdminChatId(): string {
  return (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
}

/** Normalize chat id compare (number | string from Telegram JSON). */
export function isAdminChatId(chatId: string | number | undefined | null): boolean {
  const expected = telegramAdminChatId();
  if (!expected || chatId == null || chatId === '') return false;
  return String(chatId).trim() === expected;
}

export function buildIssueCallbackData(planId: PaidPlanId, hwid: string): string {
  const id = (hwid || '').trim().toUpperCase();
  const plan = PLAN_IDS.has(planId) ? planId : 'lifetime';
  const data = `issue:${plan}:${id}`;
  if (data.length > 64) {
    // Telegram hard limit — keep plan + truncated hwid tail
    return `issue:${plan}:${id.slice(0, 48)}`.slice(0, 64);
  }
  return data;
}

export function buildRejectCallbackData(hwid: string): string {
  const id = (hwid || '').trim().toUpperCase();
  return `reject:${id}`.slice(0, 64);
}

export function parseTelegramCallbackData(
  raw: string | undefined | null,
): TelegramCallbackAction | null {
  const s = (raw || '').trim();
  if (!s) return null;

  if (s.startsWith('issue:')) {
    // issue:<planId>:<hwid>  — hwid may contain no colons (hex)
    const rest = s.slice('issue:'.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const planRaw = rest.slice(0, colon) as PaidPlanId;
    const hwid = rest.slice(colon + 1).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    const planId: PaidPlanId = PLAN_IDS.has(planRaw) ? planRaw : 'lifetime';
    return { action: 'issue', planId, hwid };
  }

  if (s.startsWith('reject:')) {
    const hwid = s.slice('reject:'.length).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    return { action: 'reject', hwid };
  }

  // Legacy: issue_HWID_planId / reject_HWID (split `_` was fragile)
  if (s.startsWith('issue_')) {
    const body = s.slice('issue_'.length);
    const last = body.lastIndexOf('_');
    if (last <= 0) return null;
    const hwid = body.slice(0, last).trim().toUpperCase();
    const planRaw = body.slice(last + 1) as PaidPlanId;
    if (!hwid || hwid.length < 6) return null;
    const planId: PaidPlanId = PLAN_IDS.has(planRaw) ? planRaw : 'lifetime';
    return { action: 'issue', planId, hwid };
  }
  if (s.startsWith('reject_')) {
    const hwid = s.slice('reject_'.length).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    return { action: 'reject', hwid };
  }

  return null;
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
    `📱 Zalo khách: ${SELLER_BANK.zaloDisplay}`,
    `🕐 ${new Date().toISOString()}`,
  ];
  if (p.note?.trim()) lines.push(`💬 Ghi chú: ${p.note.trim()}`);
  lines.push('', '⬇️ Kiểm tra bill rồi bấm nút bên dưới.');
  return lines.join('\n');
}

export function buildApproveMessage(input: {
  originalText?: string;
  planId: PaidPlanId;
  hwid: string;
  token: string;
  dbOk: boolean;
  dbError?: string;
}): string {
  const plan = PAID_PLANS.find((x) => x.id === input.planId) || PAID_PLANS[2];
  const hwid = input.hwid.toUpperCase();
  const head = (input.originalText || '').trim();
  const token = String(input.token || '').trim();
  const isAinovel2 = token.startsWith('AINOVEL2.');
  const statusLines = [
    '✅ ĐÃ CẤP KEY',
    '',
    `📦 Gói: ${plan.label} (${plan.id})`,
    `🖥 HWID: ${hwid}`,
    `🔐 Bridge: Ed25519 AINOVEL2${isAinovel2 ? '' : ' ⚠️ TOKEN KHÔNG PHẢI AINOVEL2 — KIỂM TRA PRIVATE KEY'}`,
    `🗄 Supabase: ${input.dbOk ? 'đã ghi licenses' : `LỖI — ${input.dbError || 'unknown'}`}`,
    '',
    '🔑 License Key (copy 1 dòng gửi khách — phải bắt đầu AINOVEL2.):',
    token,
    '',
    'Khách: Logo → Bản quyền → dán đúng 1 dòng AINOVEL2.… → Kích hoạt ngay.',
  ];
  if (head) {
    return `${head}\n\n─────────────────\n${statusLines.join('\n')}`;
  }
  return statusLines.join('\n');
}

export function buildRejectMessage(input: {
  originalText?: string;
  hwid?: string;
}): string {
  const head = (input.originalText || '').trim();
  const tail = input.hwid
    ? `❌ ĐÃ TỪ CHỐI\n🖥 HWID: ${input.hwid.toUpperCase()}`
    : '❌ ĐÃ TỪ CHỐI';
  if (head) return `${head}\n\n─────────────────\n${tail}`;
  return tail;
}

type TgApiResult = {
  ok: boolean;
  error?: string;
  messageId?: number;
  raw?: unknown;
};

async function telegramApi(
  method: string,
  body: Record<string, unknown>,
): Promise<TgApiResult> {
  const token = telegramBotToken();
  if (!token) {
    return { ok: false, error: 'Chưa cấu hình AINOVEL_TELEGRAM_BOT_TOKEN.' };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
        error: data.description || `Telegram ${method} HTTP ${res.status}`,
        raw: data,
      };
    }
    return {
      ok: true,
      messageId: data.result?.message_id,
      raw: data,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendTelegramMessage(
  text: string,
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
): Promise<TgApiResult> {
  const chatId = telegramAdminChatId();
  if (!chatId) {
    return {
      ok: false,
      error:
        'Chưa cấu hình Telegram (AINOVEL_TELEGRAM_BOT_TOKEN / AINOVEL_TELEGRAM_CHAT_ID).',
    };
  }
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

/**
 * Edit message text and **remove** inline buttons (empty keyboard).
 */
export async function editTelegramMessage(input: {
  chatId: string | number;
  messageId: number;
  text: string;
}): Promise<TgApiResult> {
  return telegramApi('editMessageText', {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    disable_web_page_preview: true,
    // Explicit empty keyboard removes ✅ / ❌
    reply_markup: { inline_keyboard: [] },
  });
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<TgApiResult> {
  return telegramApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200), show_alert: showAlert } : {}),
  });
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

  const planId: PaidPlanId = PLAN_IDS.has(p.planId) ? p.planId : 'lifetime';

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

  const text = buildPaymentNotifyMessage({ ...p, hwid, planId });
  const sent = await sendTelegramMessage(text, {
    inline_keyboard: [
      [
        {
          text: '✅ Cấp Key',
          callback_data: buildIssueCallbackData(planId, hwid),
        },
        {
          text: '❌ Từ chối',
          callback_data: buildRejectCallbackData(hwid),
        },
      ],
    ],
  });
  if (!sent.ok) return { ok: false, error: sent.error, text };
  lastReportAt.set(hwid, now);
  return { ok: true, messageId: sent.messageId, text };
}

export async function setTelegramWebhook(publicBaseUrl: string): Promise<{
  ok: boolean;
  webhookUrl?: string;
  error?: string;
  data?: unknown;
}> {
  const token = telegramBotToken();
  if (!token) return { ok: false, error: 'Missing AINOVEL_TELEGRAM_BOT_TOKEN' };
  const base = publicBaseUrl.replace(/\/$/, '');
  const webhookUrl = `${base}/api/entitlement/telegram-webhook`;
  const secret = (process.env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '').trim();
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message'],
    drop_pending_updates: false,
  };
  if (secret) body.secret_token = secret;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    const ok = Boolean((data as { ok?: boolean }).ok);
    return {
      ok,
      webhookUrl,
      data,
      error: ok
        ? undefined
        : (data as { description?: string }).description || 'setWebhook failed',
    };
  } catch (e) {
    return {
      ok: false,
      webhookUrl,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
