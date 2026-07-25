/**
 * Seller Telegram notify — "Đã thanh toán" + inline approve/reject + admin ops.
 * Env: AINOVEL_TELEGRAM_BOT_TOKEN + AINOVEL_TELEGRAM_CHAT_ID
 *   CHAT_ID có thể nhiều id, cách nhau bằng dấu phẩy (user + group).
 *
 * callback_data (≤64 bytes):
 *   issue:|reject:|pick:|pick_cancel|revoke_*|menu:*
 */

import type { PaidPlanId } from './pricingPlans';
import {
  PAID_PLANS,
  SELLER_BANK,
  buildTransferContent,
  formatVnd,
} from './pricingPlans';
import { BOT_MENU_COMMANDS } from './telegramAdminCommands';

export type PaymentNotifyPayload = {
  hwid: string;
  planId: PaidPlanId;
  note?: string;
};

export type TelegramCallbackAction =
  | { action: 'issue'; planId: PaidPlanId; expKey: string; hwid: string }
  | { action: 'reject'; hwid: string }
  | { action: 'pick'; planId: PaidPlanId; expKey: string; hwid: string }
  | { action: 'pick_cancel' }
  | { action: 'revoke_confirm'; licenseId: string }
  | { action: 'revoke_cancel' }
  | { action: 'gencode_plan'; expKey: string }
  | { action: 'gencode_do'; count: number; expKey: string }
  | { action: 'gencode_cancel' }
  | {
      action: 'menu';
      item:
        | 'activate'
        | 'gencode'
        | 'lookup'
        | 'list'
        | 'revoke'
        | 'plans'
        | 'status'
        | 'help';
    };

export type TgReplyMarkup =
  | { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  | {
      keyboard: Array<Array<{ text: string }>>;
      resize_keyboard?: boolean;
      is_persistent?: boolean;
      one_time_keyboard?: boolean;
    }
  | { remove_keyboard: true };

/** Simple in-memory cooldown (per process) — 1 report / HWID / 2 minutes */
const lastReportAt = new Map<string, number>();
const COOLDOWN_MS = 120_000;

const PLAN_IDS: Set<string> = new Set(PAID_PLANS.map((p) => p.id));

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

/** All allowed admin chat/user ids (comma / space / semicolon separated). */
export function telegramAdminIdSet(): Set<string> {
  const raw = telegramAdminChatId();
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const id = part.trim();
    if (id) set.add(id);
  }
  return set;
}

/** Normalize chat id compare (number | string from Telegram JSON). */
export function isAdminChatId(chatId: string | number | undefined | null): boolean {
  if (chatId == null || chatId === '') return false;
  const ids = telegramAdminIdSet();
  if (!ids.size) return false;
  return ids.has(String(chatId).trim());
}

/**
 * Admin gate for messages + callbacks.
 * Accepts either message.chat.id OR callback_query.from.id
 * (fix case: payment notify vào group, admin bấm nút bằng user id khác config).
 */
export function isAdminActor(input: {
  chatId?: string | number | null;
  fromId?: string | number | null;
}): boolean {
  const ids = telegramAdminIdSet();
  if (!ids.size) return false;
  if (input.chatId != null && input.chatId !== '' && ids.has(String(input.chatId).trim())) {
    return true;
  }
  if (input.fromId != null && input.fromId !== '' && ids.has(String(input.fromId).trim())) {
    return true;
  }
  return false;
}

export function buildIssueCallbackData(
  planIdOrExpKey: PaidPlanId | string,
  hwid: string,
): string {
  const id = (hwid || '').trim().toUpperCase();
  const key = String(planIdOrExpKey || 'lifetime')
    .trim()
    .toLowerCase();
  const plan = PLAN_IDS.has(key) ? key : key || 'lifetime';
  const data = `issue:${plan}:${id}`;
  if (data.length > 64) {
    // Telegram hard limit — keep plan + truncated hwid tail
    return `issue:${plan}:${id.slice(0, 48)}`.slice(0, 64);
  }
  return data;
}

/** Map pick/issue plan token → PaidPlanId for legacy callers (day keys → month proxy). */
function expKeyToPlanId(raw: string): PaidPlanId {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (PLAN_IDS.has(t)) return t as PaidPlanId;
  // Day presets are not PaidPlanId — use month as display fallback only when needed
  return 'month';
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

  if (s === 'pick_cancel') return { action: 'pick_cancel' };
  if (s === 'revoke_cancel') return { action: 'revoke_cancel' };

  if (s.startsWith('menu:')) {
    const item = s.slice('menu:'.length).trim().toLowerCase();
    const allowed = new Set([
      'activate',
      'gencode',
      'lookup',
      'list',
      'revoke',
      'plans',
      'status',
      'help',
    ]);
    if (!allowed.has(item)) return null;
    return {
      action: 'menu',
      item: item as
        | 'activate'
        | 'gencode'
        | 'lookup'
        | 'list'
        | 'revoke'
        | 'plans'
        | 'status'
        | 'help',
    };
  }

  if (s === 'gencode_cancel') return { action: 'gencode_cancel' };

  if (s.startsWith('gencode_plan:')) {
    const expKey = s.slice('gencode_plan:'.length).trim().toLowerCase();
    if (!expKey) return null;
    return { action: 'gencode_plan', expKey };
  }

  if (s.startsWith('gencode_do:')) {
    // gencode_do:<count>:<expKey>
    const rest = s.slice('gencode_do:'.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const count = Number(rest.slice(0, colon));
    const expKey = rest.slice(colon + 1).trim().toLowerCase();
    if (!Number.isFinite(count) || count < 1 || !expKey) return null;
    return {
      action: 'gencode_do',
      count: Math.min(50, Math.max(1, Math.floor(count))),
      expKey,
    };
  }

  if (s.startsWith('revoke_confirm:')) {
    const licenseId = s.slice('revoke_confirm:'.length).trim();
    if (!licenseId || licenseId.length < 6) return null;
    return { action: 'revoke_confirm', licenseId };
  }

  if (s.startsWith('pick:')) {
    const rest = s.slice('pick:'.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const expKey = rest.slice(0, colon).trim().toLowerCase();
    const hwid = rest.slice(colon + 1).trim().toUpperCase();
    if (!hwid || hwid.length < 6 || !expKey) return null;
    const planId: PaidPlanId = PLAN_IDS.has(expKey)
      ? (expKey as PaidPlanId)
      : expKeyToPlanId(expKey);
    return { action: 'pick', planId, expKey, hwid };
  }

  if (s.startsWith('issue:')) {
    // issue:<planId|3d|7d|…>:<hwid>  — hwid may contain no colons (hex)
    const rest = s.slice('issue:'.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const expKey = rest.slice(0, colon).trim().toLowerCase();
    const hwid = rest.slice(colon + 1).trim().toUpperCase();
    if (!hwid || hwid.length < 6 || !expKey) return null;
    const planId: PaidPlanId = PLAN_IDS.has(expKey)
      ? (expKey as PaidPlanId)
      : expKeyToPlanId(expKey);
    return { action: 'issue', planId, expKey, hwid };
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
    const planRaw = body.slice(last + 1).trim().toLowerCase();
    if (!hwid || hwid.length < 6) return null;
    const planId: PaidPlanId = PLAN_IDS.has(planRaw)
      ? (planRaw as PaidPlanId)
      : 'lifetime';
    return { action: 'issue', planId, expKey: planRaw || planId, hwid };
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
  planId?: PaidPlanId;
  /** Human label e.g. «3 ngày» when not a paid catalog plan */
  planLabel?: string;
  expKey?: string;
  hwid: string;
  token: string;
  dbOk: boolean;
  dbError?: string;
}): string {
  const plan = input.planId
    ? PAID_PLANS.find((x) => x.id === input.planId)
    : undefined;
  const label =
    input.planLabel ||
    plan?.label ||
    input.expKey ||
    input.planId ||
    'Pro';
  const idHint = input.expKey || input.planId || '';
  const hwid = input.hwid.toUpperCase();
  const head = (input.originalText || '').trim();
  const token = String(input.token || '').trim();
  if (!input.dbOk) {
    const failure = [
      '❌ KHÔNG CẤP KEY',
      '',
      `📦 Gói: ${label}${idHint ? ` (${idHint})` : ''}`,
      `🖥 HWID: ${hwid}`,
      `🗄 Supabase: LỖI — ${input.dbError || 'unknown'}`,
      '',
      'Token đã bị giữ lại và không được giao cho khách. Sửa ledger rồi cấp lại.',
    ].join('\n');
    return head
      ? `${head}\n\n─────────────────\n${failure}`
      : failure;
  }
  const isAinovel2 = token.startsWith('AINOVEL2.');
  const statusLines = [
    '✅ ĐÃ CẤP KEY',
    '',
    `📦 Gói: ${label}${idHint ? ` (${idHint})` : ''}`,
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

/**
 * Prefer first configured admin id for outbound notify.
 * For multi-id, optional overrideChatId targets the active conversation.
 */
export async function sendTelegramMessage(
  text: string,
  reply_markup?: TgReplyMarkup,
  overrideChatId?: string | number,
): Promise<TgApiResult> {
  const chatId =
    overrideChatId != null && overrideChatId !== ''
      ? String(overrideChatId)
      : telegramAdminIdSet().values().next().value || telegramAdminChatId();
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
 * Gửi cùng nội dung tới MỌI admin chat id (CHAT_ID có thể phẩy nhiều id).
 * Thành công nếu ≥1 chat nhận được message_id.
 */
export async function sendTelegramMessageToAllAdmins(
  text: string,
  reply_markup?: TgReplyMarkup,
): Promise<TgApiResult & { messageIds?: number[]; errors?: string[] }> {
  const ids = [...telegramAdminIdSet()];
  if (!ids.length) {
    return {
      ok: false,
      error:
        'Chưa cấu hình Telegram (AINOVEL_TELEGRAM_BOT_TOKEN / AINOVEL_TELEGRAM_CHAT_ID).',
    };
  }
  const messageIds: number[] = [];
  const errors: string[] = [];
  for (const chatId of ids) {
    const sent = await sendTelegramMessage(text, reply_markup, chatId);
    if (sent.ok && sent.messageId != null) {
      messageIds.push(sent.messageId);
    } else {
      errors.push(`${chatId}: ${sent.error || 'send failed'}`);
    }
  }
  if (!messageIds.length) {
    return {
      ok: false,
      error: errors.join(' | ') || 'Telegram không trả message_id (admin không nhận tin).',
      errors,
    };
  }
  return {
    ok: true,
    messageId: messageIds[0],
    messageIds,
    errors: errors.length ? errors : undefined,
  };
}

/** Deep-link start payload: pay_<planId>_<hwid> (Telegram start ≤64 chars) */
export function buildPayStartPayload(planId: PaidPlanId, hwid: string): string {
  const plan = PLAN_IDS.has(planId) ? planId : 'lifetime';
  const id = (hwid || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `pay_${plan}_${id}`.slice(0, 64);
}

export function parsePayStartPayload(
  raw: string | undefined | null,
): { planId: PaidPlanId; hwid: string } | null {
  const s = (raw || '').trim();
  // /start pay_lifetime_ABC  or just pay_lifetime_ABC
  const m = s.match(/^(?:\/start\s+)?pay_([a-z]+)_([A-Za-z0-9]{6,48})$/i);
  if (!m) return null;
  const planRaw = m[1].toLowerCase() as PaidPlanId;
  const hwid = m[2].toUpperCase();
  const planId: PaidPlanId = PLAN_IDS.has(planRaw) ? planRaw : 'lifetime';
  return { planId, hwid };
}

/** t.me deep link so customer can re-open bot with HWID baked in */
export function buildPayTelegramDeepLink(
  planId: PaidPlanId,
  hwid: string,
): string {
  const payload = buildPayStartPayload(planId, hwid);
  return `https://t.me/${SELLER_BANK.telegramBotUsername}?start=${encodeURIComponent(payload)}`;
}

/** Register left-corner Menu button commands (Bot API setMyCommands). */
export async function registerTelegramBotMenu(): Promise<TgApiResult> {
  const commands = BOT_MENU_COMMANDS.map((c) => ({
    command: c.command,
    description: c.description.slice(0, 256),
  }));
  const setCmds = await telegramApi('setMyCommands', { commands });
  // Ensure default menu opens command list (Telegram clients show ☰ / Menu)
  await telegramApi('setChatMenuButton', {
    menu_button: { type: 'commands' },
  });
  return setCmds;
}

/**
 * Edit message text.
 * - Default: strip inline buttons (empty keyboard) — used after approve/reject.
 * - Pass `replyMarkup` to replace buttons (e.g. gencode plan → count wizard).
 * - Pass `replyMarkup: null` to leave existing markup untouched (rare).
 */
export async function editTelegramMessage(input: {
  chatId: string | number;
  messageId: number;
  text: string;
  replyMarkup?: TgReplyMarkup | null;
}): Promise<TgApiResult> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    disable_web_page_preview: true,
  };
  if (input.replyMarkup === null) {
    // leave markup as-is
  } else if (input.replyMarkup !== undefined) {
    body.reply_markup = input.replyMarkup;
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }
  return telegramApi('editMessageText', body);
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
  const keyboard: TgReplyMarkup = {
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
  };
  // Fan-out mọi admin id — fail-closed nếu không có message_id nào
  const sent = await sendTelegramMessageToAllAdmins(text, keyboard);
  if (!sent.ok || sent.messageId == null) {
    return {
      ok: false,
      error:
        sent.error ||
        'Telegram không xác nhận message_id — Admin chưa nhận tin báo thanh toán.',
      text,
    };
  }
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
    await registerTelegramBotMenu().catch(() => undefined);
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
