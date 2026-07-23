/**
 * Standalone Telegram → Ed25519 license bridge.
 * Only this seller backend receives the private key; desktop clients receive
 * the matching public key and therefore cannot mint Pro licenses.
 */
import crypto from 'crypto';

export type PaidPlanId = 'month' | 'year' | 'lifetime';

export const PAID_PLANS: Record<
  PaidPlanId,
  { label: string; expSeconds: number }
> = {
  month: { label: 'GÓI 01 THÁNG', expSeconds: 60 * 60 * 24 * 30 },
  year: { label: 'GÓI 01 NĂM', expSeconds: 60 * 60 * 24 * 365 },
  lifetime: {
    label: 'GÓI TRỌN ĐỜI',
    expSeconds: 60 * 60 * 24 * 365 * 50,
  },
};

function signingKey(): { key: crypto.KeyObject; kid: string } {
  const raw = (process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64 || '').trim();
  if (!raw) {
    throw new Error('AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64 missing on bridge');
  }
  const pem = Buffer.from(raw, 'base64').toString('utf8');
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('License signing key must be Ed25519');
  }
  const publicDer = crypto
    .createPublicKey(key)
    .export({ type: 'spki', format: 'der' });
  const kid = crypto
    .createHash('sha256')
    .update(publicDer)
    .digest('hex')
    .slice(0, 16);
  return { key, kid };
}

export function telegramConfigured(): boolean {
  return Boolean(
    (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim() &&
      (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim(),
  );
}

export function botToken(): string {
  return (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
}

export function adminChatId(): string {
  return (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
}

/** Comma/space-separated admin chat/user ids. */
export function adminIdSet(): Set<string> {
  const set = new Set<string>();
  for (const part of adminChatId().split(/[,;\s]+/)) {
    const id = part.trim();
    if (id) set.add(id);
  }
  return set;
}

export function webhookSecret(): string {
  return (process.env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '').trim();
}

export function isAdminChat(chatId: string | number | undefined | null): boolean {
  if (chatId == null || chatId === '') return false;
  const ids = adminIdSet();
  if (!ids.size) return false;
  return ids.has(String(chatId).trim());
}

export function isAdminActor(input: {
  chatId?: string | number | null;
  fromId?: string | number | null;
}): boolean {
  const ids = adminIdSet();
  if (!ids.size) return false;
  if (
    input.chatId != null &&
    input.chatId !== '' &&
    ids.has(String(input.chatId).trim())
  ) {
    return true;
  }
  if (
    input.fromId != null &&
    input.fromId !== '' &&
    ids.has(String(input.fromId).trim())
  ) {
    return true;
  }
  return false;
}

export function primaryAdminChatId(): string {
  return adminIdSet().values().next().value || adminChatId();
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * One-path ledger: app activate requires an active `licenses` row.
 * Bridge must INSERT/UPDATE — token alone is rejected when Supabase is authority.
 */
export async function persistLicenseLedger(input: {
  token: string;
  hwid: string;
  planId: PaidPlanId;
}): Promise<{ ok: boolean; licenseId?: string; error?: string }> {
  const cfg = supabaseConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        'Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trên bridge Vercel. App sẽ từ chối key (không có row licenses).',
    };
  }
  const hwidNorm = input.hwid.trim().toLowerCase();
  if (!hwidNorm || hwidNorm.length < 6) {
    return { ok: false, error: 'HWID không hợp lệ' };
  }
  const plan = PAID_PLANS[input.planId] || PAID_PLANS.lifetime;
  const expAt = new Date(Date.now() + plan.expSeconds * 1000).toISOString();
  const tokenHash = hashToken(input.token);
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    // Prefer update existing active row for this HWID
    const selUrl =
      `${cfg.url}/rest/v1/licenses` +
      `?hwid=ilike.${encodeURIComponent(hwidNorm)}` +
      `&status=eq.active&select=id&order=created_at.desc&limit=1`;
    const selRes = await fetch(selUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    const selRows = (await selRes.json().catch(() => [])) as Array<{
      id?: string;
    }>;
    if (!selRes.ok) {
      return {
        ok: false,
        error: `Supabase select licenses HTTP ${selRes.status}: ${JSON.stringify(selRows).slice(0, 200)}`,
      };
    }

    const existingId = selRows?.[0]?.id;
    if (existingId) {
      const upRes = await fetch(
        `${cfg.url}/rest/v1/licenses?id=eq.${encodeURIComponent(existingId)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            plan: 'pro',
            hwid: hwidNorm,
            status: 'active',
            exp_at: expAt,
            token_hash: tokenHash,
            activation_code: null,
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const upBody = await upRes.json().catch(() => ({}));
      if (!upRes.ok) {
        return {
          ok: false,
          error: `Supabase update HTTP ${upRes.status}: ${JSON.stringify(upBody).slice(0, 200)}`,
        };
      }
      return { ok: true, licenseId: String(existingId) };
    }

    const insRes = await fetch(`${cfg.url}/rest/v1/licenses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: null,
        order_id: null,
        plan: 'pro',
        hwid: hwidNorm,
        status: 'active',
        exp_at: expAt,
        token_hash: tokenHash,
        activation_code: null,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const insRows = (await insRes.json().catch(() => [])) as Array<{
      id?: string;
    }>;
    if (!insRes.ok) {
      return {
        ok: false,
        error: `Supabase insert HTTP ${insRes.status}: ${JSON.stringify(insRows).slice(0, 200)}`,
      };
    }
    const id = Array.isArray(insRows) ? insRows[0]?.id : undefined;
    return { ok: true, licenseId: id ? String(id) : undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Issue a Pro Ed25519 token bound to HWID (AINOVEL2 wire format). */
export function issueProToken(hwid: string, planId: PaidPlanId): string {
  const id = hwid.trim().toLowerCase();
  if (!id || id.length < 6) throw new Error('HWID không hợp lệ');
  const plan = PAID_PLANS[planId] || PAID_PLANS.lifetime;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + plan.expSeconds;
  const payload = {
    is_pro: true,
    is_vip: false,
    is_trial: false,
    plan: 'pro' as const,
    exp,
    iat: now,
    ver: 2 as const,
    license_id: crypto.randomUUID(),
    hwid: id,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signer = signingKey();
  const signingInput = `AINOVEL2.${signer.kid}.${body}`;
  const sig = b64url(
    crypto.sign(null, Buffer.from(signingInput, 'utf8'), signer.key),
  );
  return `${signingInput}.${sig}`;
}

/** Sign AINOVEL2 + write Supabase licenses (required for app activate). */
export async function issueAndPersist(
  hwid: string,
  planId: PaidPlanId,
): Promise<{
  token: string;
  dbOk: boolean;
  dbError?: string;
  licenseId?: string;
}> {
  const token = issueProToken(hwid, planId);
  const ledger = await persistLicenseLedger({ token, hwid, planId });
  return {
    token,
    dbOk: ledger.ok,
    dbError: ledger.error,
    licenseId: ledger.licenseId,
  };
}

export type CallbackAction =
  | { action: 'issue'; planId: PaidPlanId; hwid: string }
  | { action: 'pick'; planId: PaidPlanId; hwid: string }
  | { action: 'reject'; hwid: string }
  | { action: 'pick_cancel' }
  | { action: 'revoke_confirm'; licenseId: string }
  | { action: 'revoke_cancel' }
  | {
      action: 'menu';
      item:
        | 'activate'
        | 'lookup'
        | 'list'
        | 'revoke'
        | 'plans'
        | 'status'
        | 'help';
    };

export function parseCallback(
  raw: string | undefined | null,
): CallbackAction | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (s === 'pick_cancel') return { action: 'pick_cancel' };
  if (s === 'revoke_cancel') return { action: 'revoke_cancel' };
  if (s.startsWith('menu:')) {
    const item = s.slice(5).trim().toLowerCase();
    const ok = new Set([
      'activate',
      'lookup',
      'list',
      'revoke',
      'plans',
      'status',
      'help',
    ]);
    if (!ok.has(item)) return null;
    return { action: 'menu', item: item as 'activate' };
  }
  if (s.startsWith('revoke_confirm:')) {
    const licenseId = s.slice('revoke_confirm:'.length).trim();
    if (!licenseId || licenseId.length < 6) return null;
    return { action: 'revoke_confirm', licenseId };
  }
  if (s.startsWith('pick:') || s.startsWith('issue:')) {
    const prefix = s.startsWith('pick:') ? 'pick:' : 'issue:';
    const rest = s.slice(prefix.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const planRaw = rest.slice(0, colon) as PaidPlanId;
    const hwid = rest.slice(colon + 1).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    const planId: PaidPlanId =
      planRaw === 'month' || planRaw === 'year' || planRaw === 'lifetime'
        ? planRaw
        : 'lifetime';
    return {
      action: prefix === 'pick:' ? 'pick' : 'issue',
      planId,
      hwid,
    };
  }
  if (s.startsWith('reject:')) {
    const hwid = s.slice('reject:'.length).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    return { action: 'reject', hwid };
  }
  return null;
}

/** Normalize device id: strip non-hex, uppercase. */
export function normalizeHwid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const hex = String(raw)
    .trim()
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (hex.length < 8) return null;
  return hex;
}

function tryParseBareHwid(text: string): string | null {
  const t = (text || '').trim();
  if (!t || t.startsWith('/')) return null;
  if (!/^[0-9a-fA-F:\-\s]+$/.test(t)) return null;
  return normalizeHwid(t);
}

function parsePlanArg(raw: string | undefined): PaidPlanId | undefined {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'month' || s === 'year' || s === 'lifetime') return s;
  if (s === 'm' || s === '1m' || s === 'thang') return 'month';
  if (s === 'y' || s === '1y' || s === 'nam') return 'year';
  if (s === 'life' || s === 'lt' || s === 'tron') return 'lifetime';
  return undefined;
}

type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type ReplyKeyboard = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: boolean;
  is_persistent?: boolean;
};

const REPLY_BTN = {
  activate: '🔑 Cấp key',
  lookup: '🔎 Tra cứu',
  list: '📋 List active',
  revoke: '🚫 Thu hồi',
  plans: '📦 Gói',
  status: '🩺 Status',
  menu: '❓ Menu',
} as const;

const BOT_MENU_COMMANDS = [
  { command: 'start', description: 'Mở menu quản lý' },
  { command: 'menu', description: 'Hiện bàn phím + nút thao tác' },
  { command: 'activate', description: 'Cấp key (sau đó dán HWID)' },
  { command: 'lookup', description: 'Tra license theo HWID' },
  { command: 'list', description: 'List license active' },
  { command: 'revoke', description: 'Thu hồi license' },
  { command: 'plans', description: 'Bảng gói Pro' },
  { command: 'status', description: 'Trạng thái bot + ledger' },
  { command: 'help', description: 'Hướng dẫn' },
];

type PendingMode = 'await_hwid' | 'await_lookup' | 'await_revoke';
const pendingByChat = new Map<string, { mode: PendingMode; at: number }>();
const PENDING_TTL_MS = 15 * 60_000;

function setPending(chatId: string | number, mode: PendingMode) {
  pendingByChat.set(String(chatId), { mode, at: Date.now() });
}
function takePending(chatId: string | number): PendingMode | null {
  const key = String(chatId);
  const p = pendingByChat.get(key);
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL_MS) {
    pendingByChat.delete(key);
    return null;
  }
  pendingByChat.delete(key);
  return p.mode;
}
function clearPending(chatId: string | number) {
  pendingByChat.delete(String(chatId));
}

function planPickerKeyboard(hwid: string): InlineKeyboard {
  const id = hwid.toUpperCase();
  const mk = (plan: PaidPlanId, label: string) => {
    const data = `pick:${plan}:${id}`;
    return {
      text: label,
      callback_data:
        data.length > 64 ? `pick:${plan}:${id.slice(0, 48)}`.slice(0, 64) : data,
    };
  };
  return {
    inline_keyboard: [
      [
        mk('month', '1 tháng'),
        mk('year', '1 năm'),
        mk('lifetime', '⭐ Trọn đời'),
      ],
      [{ text: '❌ Huỷ', callback_data: 'pick_cancel' }],
    ],
  };
}

function revokeConfirmKeyboard(licenseId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: '⚠️ Xác nhận thu hồi',
          callback_data: `revoke_confirm:${licenseId}`.slice(0, 64),
        },
        { text: 'Huỷ', callback_data: 'revoke_cancel' },
      ],
    ],
  };
}

function removeReplyKeyboard(): { remove_keyboard: true } {
  return { remove_keyboard: true };
}

function mainInlineMenu(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🔑 Cấp key', callback_data: 'menu:activate' },
        { text: '🔎 Tra cứu', callback_data: 'menu:lookup' },
      ],
      [
        { text: '📋 List', callback_data: 'menu:list' },
        { text: '🚫 Thu hồi', callback_data: 'menu:revoke' },
      ],
      [
        { text: '📦 Gói', callback_data: 'menu:plans' },
        { text: '🩺 Status', callback_data: 'menu:status' },
      ],
      [{ text: '❓ Help', callback_data: 'menu:help' }],
    ],
  };
}

const HELP_TEXT = [
  '🤖 AI Novel — Bot seller',
  '',
  '👉 Bấm nút trong tin nhắn (bên dưới).',
  '👉 Menu (góc trái) · dán HWID → chọn gói → copy key gửi khách.',
  '',
  '🔔 Khách «Đã thanh toán» → ✅ Cấp Key / ❌ Từ chối.',
  '🔑 AINOVEL2 + Supabase licenses (One-Path).',
].join('\n');

async function registerBotMenu() {
  await tgApi('setMyCommands', { commands: BOT_MENU_COMMANDS });
  await tgApi('setChatMenuButton', { menu_button: { type: 'commands' } });
}

async function tgApi(method: string, body: Record<string, unknown>) {
  const token = botToken();
  if (!token) return { ok: false as const, error: 'no bot token' };
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
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
      ok: false as const,
      error: data.description || `HTTP ${res.status}`,
      data,
      messageId: undefined as number | undefined,
    };
  }
  return {
    ok: true as const,
    data,
    messageId: data.result?.message_id,
  };
}

export async function answerCallback(
  id: string,
  text?: string,
  alert = false,
) {
  return tgApi('answerCallbackQuery', {
    callback_query_id: id,
    ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}),
  });
}

export async function editMessage(
  chatId: string | number,
  messageId: number,
  text: string,
) {
  return tgApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function sendMessage(
  text: string,
  reply_markup?:
    | InlineKeyboard
    | ReplyKeyboard
    | { remove_keyboard: true },
  overrideChatId?: string | number,
) {
  const chatId =
    overrideChatId != null && overrideChatId !== ''
      ? String(overrideChatId)
      : primaryAdminChatId();
  return tgApi('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

/** Fan-out to every admin id; ok only if ≥1 message_id. */
export async function sendMessageToAllAdmins(
  text: string,
  reply_markup?: InlineKeyboard | ReplyKeyboard | { remove_keyboard: true },
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const ids = [...adminIdSet()];
  if (!ids.length) {
    return { ok: false, error: 'No admin chat id' };
  }
  let messageId: number | undefined;
  const errors: string[] = [];
  for (const id of ids) {
    const r = await sendMessage(text, reply_markup, id);
    if (r.ok && r.messageId != null) {
      if (messageId == null) messageId = r.messageId;
    } else {
      errors.push(`${id}: ${r.error || 'send failed'}`);
    }
  }
  if (messageId == null) {
    return { ok: false, error: errors.join(' | ') || 'no messageId' };
  }
  return { ok: true, messageId };
}

function paymentIssueKeyboard(planId: PaidPlanId, hwid: string): InlineKeyboard {
  const id = hwid.toUpperCase();
  const issue = `issue:${planId}:${id}`;
  const reject = `reject:${id}`;
  return {
    inline_keyboard: [
      [
        {
          text: '✅ Cấp Key',
          callback_data:
            issue.length > 64
              ? `issue:${planId}:${id.slice(0, 48)}`.slice(0, 64)
              : issue,
        },
        {
          text: '❌ Từ chối',
          callback_data: reject.slice(0, 64),
        },
      ],
    ],
  };
}

/** In-memory cooldown: 1 customer report / HWID / 2 min (bridge instance). */
const lastCustomerPayAt = new Map<string, number>();
const CUSTOMER_PAY_COOLDOWN_MS = 120_000;

/**
 * Customer (non-admin) → forward payment ticket to admin with Cấp Key buttons.
 * Fixes silent drop: previously non-admin messages were ignored → "bot không nhận".
 */
export async function handleCustomerPaymentMessage(msg: {
  text?: string;
  chat?: { id?: number | string };
  from?: { id?: number; username?: string; first_name?: string };
}): Promise<void> {
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  if (!text || chatId == null) return;

  const who = msg.from?.username
    ? `@${msg.from.username}`
    : String(msg.from?.id || msg.from?.first_name || '?');

  let planId: PaidPlanId = 'lifetime';
  let hwid: string | null = null;

  // /start pay_lifetime_HWID
  if (/^\/start\b/i.test(text)) {
    const rest = text.replace(/^\/start\s*/i, '').trim();
    const m = rest.match(/^pay_([a-z]+)_([A-Za-z0-9]{6,48})$/i);
    if (m) {
      const p = m[1].toLowerCase() as PaidPlanId;
      planId = PAID_PLANS[p] ? p : 'lifetime';
      hwid = m[2].toUpperCase();
    } else if (!rest) {
      await sendMessage(
        [
          '👋 AI Novel License Bot',
          '',
          'Báo đã thanh toán:',
          '1) App: Logo → Bản quyền → ✓ Đã thanh toán — báo Admin',
          '2) Hoặc gửi: HWID + gói (month|year|lifetime)',
          '',
          'Ví dụ: F925B0FF900599A0 lifetime',
        ].join('\n'),
        undefined,
        chatId,
      );
      return;
    }
  }

  if (!hwid) {
    const parts = text.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const n = normalizeHwid(part);
      if (n) hwid = n;
      const low = part.toLowerCase();
      if (low === 'month' || low === 'thang') planId = 'month';
      if (low === 'year' || low === 'nam') planId = 'year';
      if (low === 'lifetime' || low === 'trondoi' || low === 'tron')
        planId = 'lifetime';
    }
  }

  if (!hwid || hwid.length < 8) {
    await sendMessage(
      'Gửi HWID (mã thiết bị trong app) kèm gói month|year|lifetime.\nHoặc bấm «Đã thanh toán» trong app.',
      undefined,
      chatId,
    );
    return;
  }

  const now = Date.now();
  const last = lastCustomerPayAt.get(hwid) || 0;
  if (now - last < CUSTOMER_PAY_COOLDOWN_MS) {
    const wait = Math.ceil((CUSTOMER_PAY_COOLDOWN_MS - (now - last)) / 1000);
    await sendMessage(
      `⏳ Bạn vừa gửi rồi. Thử lại sau ~${wait}s.`,
      undefined,
      chatId,
    );
    return;
  }

  const plan = PAID_PLANS[planId] || PAID_PLANS.lifetime;
  const adminText = [
    '🔔 AI Novel — Báo đã thanh toán (từ chat bot khách)',
    '',
    `👤 Khách: ${who}`,
    `📦 Gói: ${plan.label} (${planId})`,
    `🖥 HWID: ${hwid}`,
    `🕐 ${new Date().toISOString()}`,
    '',
    '⬇️ Kiểm tra bill rồi bấm nút:',
  ].join('\n');

  const sent = await sendMessageToAllAdmins(
    adminText,
    paymentIssueKeyboard(planId, hwid),
  );
  if (!sent.ok || sent.messageId == null) {
    await sendMessage(
      `⚠️ Chưa gửi được Admin: ${sent.error || 'no messageId'}. Thử lại hoặc Zalo admin.`,
      undefined,
      chatId,
    );
    return;
  }
  lastCustomerPayAt.set(hwid, now);
  await sendMessage(
    `✅ Đã báo Admin.\n🖥 ${hwid}\n📦 ${planId}\nmessage #${sent.messageId}\nChờ Cấp Key.`,
    undefined,
    chatId,
  );
}

export function approveText(
  planId: PaidPlanId,
  hwid: string,
  token: string,
  original?: string,
  opts?: { dbOk?: boolean; dbError?: string; licenseId?: string },
): string {
  const plan = PAID_PLANS[planId] || PAID_PLANS.lifetime;
  const ledgerLine =
    opts?.dbOk === true
      ? `📒 Supabase licenses: OK${opts.licenseId ? ` (id ${opts.licenseId})` : ''}`
      : opts?.dbOk === false
        ? `⚠️ Supabase licenses LỖI — app sẽ TỪ CHỐI key:\n${opts.dbError || 'unknown'}`
        : '📒 Supabase: (chưa kiểm tra)';
  const body = [
    '✅ ĐÃ CẤP KEY',
    '',
    `📦 Gói: ${plan.label} (${planId})`,
    `🖥 HWID: ${hwid.toUpperCase()}`,
    '🔐 Bridge: Ed25519 AINOVEL2 (kid = SHA256 public SPKI[:16])',
    ledgerLine,
    '',
    '🔑 License Key (copy 1 dòng gửi khách — phải bắt đầu AINOVEL2.):',
    token,
    '',
    'Khách: Logo → Bản quyền → dán đúng 1 dòng AINOVEL2.… → Kích hoạt ngay.',
  ].join('\n');
  const head = (original || '').trim();
  return head ? `${head}\n\n─────────────────\n${body}` : body;
}

export function rejectText(hwid?: string, original?: string): string {
  const tail = hwid
    ? `❌ ĐÃ TỪ CHỐI\n🖥 HWID: ${hwid.toUpperCase()}`
    : '❌ ĐÃ TỪ CHỐI';
  const head = (original || '').trim();
  return head ? `${head}\n\n─────────────────\n${tail}` : tail;
}

type LicenseRow = {
  id?: string;
  plan?: string;
  status?: string;
  hwid?: string;
  exp_at?: string;
  created_at?: string;
};

async function supabaseRest(
  pathAndQuery: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false, status: 0, body: 'no supabase' };
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function formatRows(title: string, rows: LicenseRow[], total?: number): string {
  if (!rows.length) return `${title}\n(không có bản ghi)`;
  const lines = [
    title,
    total != null
      ? `Tổng khớp: ${total} · hiển thị ${rows.length}`
      : `Hiển thị ${rows.length}`,
    '',
  ];
  for (const r of rows) {
    const h = (r.hwid || '').toUpperCase();
    const id = r.id || '?';
    const shortId = id.length > 12 ? `${id.slice(0, 8)}…` : id;
    const exp = r.exp_at ? r.exp_at.slice(0, 10) : '?';
    lines.push(
      `• ${r.status || '?'} | ${r.plan || '?'} | HWID ${h.slice(0, 16)}${h.length > 16 ? '…' : ''}`,
      `  id=${shortId} exp=${exp}`,
    );
  }
  return lines.join('\n');
}

async function cmdLookup(q: string, chatId?: string | number): Promise<void> {
  const hwidQ = normalizeHwid(q) || q;
  const pattern = encodeURIComponent(`%${hwidQ}%`);
  const r = await supabaseRest(
    `licenses?hwid=ilike.${pattern}&select=id,plan,status,hwid,exp_at,created_at&order=created_at.desc&limit=10`,
  );
  if (!r.ok) {
    await sendMessage(
      `❌ Lookup fail HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`,
      undefined,
      chatId,
    );
    return;
  }
  const rows = (Array.isArray(r.body) ? r.body : []) as LicenseRow[];
  await sendMessage(
    formatRows(`🔎 Lookup «${q}»`, rows, rows.length),
    undefined,
    chatId,
  );
}

async function cmdList(
  status: 'active' | 'revoked' | 'all',
  limit: number,
  chatId?: string | number,
): Promise<void> {
  let q =
    `licenses?select=id,plan,status,hwid,exp_at,created_at&order=created_at.desc&limit=${limit}`;
  if (status !== 'all') q += `&status=eq.${status}`;
  const r = await supabaseRest(q);
  if (!r.ok) {
    await sendMessage(
      `❌ List fail HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`,
      undefined,
      chatId,
    );
    return;
  }
  const rows = (Array.isArray(r.body) ? r.body : []) as LicenseRow[];
  await sendMessage(
    formatRows(`📋 List status=${status}`, rows, rows.length),
    undefined,
    chatId,
  );
}

async function cmdRevokePrompt(
  target: string,
  chatId?: string | number,
): Promise<void> {
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let licenseId = uuidRe.test(target) ? target : '';
  let preview = '';

  if (!licenseId) {
    const hwid = normalizeHwid(target) || target.toLowerCase();
    const r = await supabaseRest(
      `licenses?hwid=ilike.${encodeURIComponent(hwid)}&status=eq.active&select=id,plan,status,hwid,exp_at&order=created_at.desc&limit=5`,
    );
    const rows = (
      r.ok && Array.isArray(r.body) ? r.body : []
    ) as LicenseRow[];
    const pick =
      rows.find((x) => (x.hwid || '').toLowerCase() === hwid.toLowerCase()) ||
      rows[0];
    if (!pick?.id) {
      await sendMessage(
        `Không tìm thấy license active cho «${target}».`,
        undefined,
        chatId,
      );
      return;
    }
    licenseId = pick.id;
    preview = formatRows('Ứng viên thu hồi:', [pick]);
  } else {
    preview = `id=${licenseId}`;
  }

  await sendMessage(
    `${preview}\n\n⚠️ Xác nhận thu hồi? Máy khách → Free sau heartbeat.`,
    revokeConfirmKeyboard(licenseId),
    chatId,
  );
}

async function cmdStatus(chatId?: string | number): Promise<void> {
  let kid = '(n/a)';
  try {
    kid = signingKey().kid;
  } catch {
    kid = '(signer missing)';
  }
  await sendMessage(
    [
      '🩺 Bridge status',
      `Telegram configured: ${telegramConfigured() ? 'yes' : 'NO'}`,
      `Admin ids: ${[...adminIdSet()].join(', ') || '(empty)'}`,
      `Supabase ledger: ${supabaseConfig() ? 'yes' : 'NO'}`,
      `Signer kid: ${kid}`,
      '',
      'One-Path: AINOVEL2 + licenses.active.',
      'Bấm ❓ Menu nếu bàn phím biến mất.',
    ].join('\n'),
    undefined,
    chatId,
  );
}

async function deliverIssue(
  planId: PaidPlanId,
  hwid: string,
  originalText?: string,
  editCtx?: { chatId: string | number; messageId: number },
): Promise<{ dbOk: boolean }> {
  const issued = await issueAndPersist(hwid, planId);
  const text = approveText(planId, hwid, issued.token, originalText, {
    dbOk: issued.dbOk,
    dbError: issued.dbError,
    licenseId: issued.licenseId,
  });
  if (editCtx) {
    const edited = await editMessage(editCtx.chatId, editCtx.messageId, text);
    if (!edited.ok) {
      await sendMessage(
        approveText(planId, hwid, issued.token, undefined, {
          dbOk: issued.dbOk,
          dbError: issued.dbError,
          licenseId: issued.licenseId,
        }),
      );
    }
  } else {
    await sendMessage(text);
  }
  if (!issued.dbOk) {
    await sendMessage(
      `⚠️ Key đã ký nhưng Supabase LỖI (HWID ${hwid.toUpperCase()}):\n${issued.dbError || 'unknown'}\n` +
        'App One-Path: không có row licenses active → khách dán key bị từ chối. Kiểm tra SERVICE_ROLE trên Vercel bridge.',
    );
  }
  return { dbOk: issued.dbOk };
}

export async function setWebhook(publicBaseUrl: string) {
  const token = botToken();
  if (!token) return { ok: false, error: 'Missing bot token' };
  const base = publicBaseUrl.replace(/\/$/, '');
  const webhookUrl = `${base}/api/entitlement/telegram-webhook`;
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['callback_query', 'message'],
    drop_pending_updates: false,
  };
  const sec = webhookSecret();
  if (sec) body.secret_token = sec;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  // Register left Menu + default commands button
  await registerBotMenu().catch(() => undefined);
  return {
    ok: Boolean((data as { ok?: boolean }).ok),
    webhookUrl,
    data,
    error: (data as { description?: string }).description,
  };
}

export type TgUpdate = {
  update_id?: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id?: number;
      text?: string;
      chat?: { id?: number | string };
    };
    from?: { id?: number; username?: string };
  };
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number; username?: string };
  };
};

function matchReplyBtn(text: string): string | null {
  const t = text.trim();
  if (t === REPLY_BTN.activate || /^🔑/.test(t)) return 'activate';
  if (t === REPLY_BTN.lookup || /^🔎/.test(t)) return 'lookup';
  if (t === REPLY_BTN.list || /^📋/.test(t)) return 'list';
  if (t === REPLY_BTN.revoke || /^🚫/.test(t)) return 'revoke';
  if (t === REPLY_BTN.plans || /^📦/.test(t)) return 'plans';
  if (t === REPLY_BTN.status || /^🩺/.test(t)) return 'status';
  if (t === REPLY_BTN.menu || /^❓/.test(t)) return 'menu';
  return null;
}

async function openMenu(chatId: string | number) {
  await registerBotMenu().catch(() => undefined);
  // Ẩn reply keyboard dưới khung chat — chỉ giữ nút inline trong tin
  await sendMessage(HELP_TEXT, removeReplyKeyboard(), chatId);
  await sendMessage(
    '⬇️ Bấm nút trong tin nhắn:',
    mainInlineMenu(),
    chatId,
  );
}

export async function processUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query?.id) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const originalText = cq.message?.text || '';
    const fromId = cq.from?.id;

    if (!isAdminActor({ chatId, fromId })) {
      await answerCallback(
        cq.id,
        'Chat/user không được phép. Thêm id vào AINOVEL_TELEGRAM_CHAT_ID.',
        true,
      );
      return;
    }
    const parsed = parseCallback(cq.data);
    if (!parsed) {
      await answerCallback(
        cq.id,
        `Callback lạ: ${(cq.data || '').slice(0, 40)}`,
        true,
      );
      return;
    }
    if (chatId == null || messageId == null) {
      await answerCallback(cq.id, 'Thiếu message context.', true);
      return;
    }

    if (parsed.action === 'issue' || parsed.action === 'pick') {
      await answerCallback(cq.id, '⏳ Đang cấp key…');
    }

    if (parsed.action === 'menu') {
      clearPending(chatId);
      if (parsed.item === 'activate') {
        setPending(chatId, 'await_hwid');
        await answerCallback(cq.id, 'Gửi HWID…');
        await sendMessage(
          '🔑 Gửi HWID khách ở tin tiếp theo (hoặc dán HWID bất kỳ lúc nào).',
          undefined,
          chatId,
        );
        return;
      }
      if (parsed.item === 'lookup') {
        setPending(chatId, 'await_lookup');
        await answerCallback(cq.id, 'Gửi HWID…');
        await sendMessage('🔎 Gửi HWID/prefix (≥3 ký tự).', undefined, chatId);
        return;
      }
      if (parsed.item === 'revoke') {
        setPending(chatId, 'await_revoke');
        await answerCallback(cq.id, 'Gửi id…');
        await sendMessage(
          '🚫 Gửi licenseId hoặc HWID active để thu hồi.',
          undefined,
          chatId,
        );
        return;
      }
      if (parsed.item === 'list') {
        await answerCallback(cq.id, 'List…');
        await cmdList('active', 10, chatId);
        return;
      }
      if (parsed.item === 'plans') {
        await answerCallback(cq.id, 'Gói');
        await sendMessage(
          '📦 Gói Pro\n• month · year · lifetime\nDán HWID → chọn gói.',
          undefined,
          chatId,
        );
        return;
      }
      if (parsed.item === 'status') {
        await answerCallback(cq.id, 'Status');
        await cmdStatus(chatId);
        return;
      }
      if (parsed.item === 'help') {
        await answerCallback(cq.id, 'Menu');
        await openMenu(chatId);
        return;
      }
      return;
    }

    if (parsed.action === 'pick_cancel') {
      await editMessage(
        chatId,
        messageId,
        `${originalText}\n\n─────────────────\n❌ Đã huỷ chọn gói.`,
      );
      await answerCallback(cq.id, 'Đã huỷ.');
      return;
    }
    if (parsed.action === 'revoke_cancel') {
      await editMessage(
        chatId,
        messageId,
        `${originalText}\n\n─────────────────\n↩ Đã huỷ thu hồi.`,
      );
      await answerCallback(cq.id, 'Đã huỷ revoke.');
      return;
    }
    if (parsed.action === 'revoke_confirm') {
      await answerCallback(cq.id, '⏳ Revoke…');
      const r = await supabaseRest(
        `licenses?id=eq.${encodeURIComponent(parsed.licenseId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
          }),
        },
      );
      if (!r.ok) {
        await sendMessage(
          `❌ Revoke fail: ${JSON.stringify(r.body).slice(0, 200)}`,
          undefined,
          chatId,
        );
        return;
      }
      await editMessage(
        chatId,
        messageId,
        `${originalText}\n\n─────────────────\n✅ ĐÃ THU HỒI\nid=${parsed.licenseId}`,
      );
      return;
    }

    if (parsed.action === 'reject') {
      const text = rejectText(parsed.hwid, originalText);
      const edited = await editMessage(chatId, messageId, text);
      await answerCallback(
        cq.id,
        edited.ok ? 'Đã từ chối.' : edited.error || 'Edit fail',
        !edited.ok,
      );
      return;
    }

    if (parsed.action === 'issue' || parsed.action === 'pick') {
      try {
        await deliverIssue(parsed.planId, parsed.hwid, originalText, {
          chatId,
          messageId,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await sendMessage(
          `❌ Lỗi cấp key (HWID ${parsed.hwid}): ${errMsg}`,
          undefined,
          chatId,
        );
      }
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;
  if (!isAdminActor({ chatId: msg.chat?.id, fromId: msg.from?.id })) {
    // Khách nhắn bot / deep-link start=pay_… → forward ticket Admin (không nuốt im)
    await handleCustomerPaymentMessage(msg);
    return;
  }
  const chatId = msg.chat?.id;
  if (chatId == null) return;
  const text = msg.text.trim();

  try {
    // Pending multi-step
    const pending = takePending(chatId);
    if (pending === 'await_hwid') {
      const hwid = normalizeHwid(text);
      if (!hwid) {
        setPending(chatId, 'await_hwid');
        await sendMessage(
          'HWID không hợp lệ (≥8 hex). Gửi lại.',
          undefined,
          chatId,
        );
        return;
      }
      await sendMessage(
        [
          '🖥 Mã thiết bị nhận được',
          `HWID: ${hwid}`,
          '',
          'Chọn gói để cấp key Pro:',
        ].join('\n'),
        planPickerKeyboard(hwid),
        chatId,
      );
      return;
    }
    if (pending === 'await_lookup') {
      if (text.length < 3) {
        setPending(chatId, 'await_lookup');
        await sendMessage('Cần ≥3 ký tự.', undefined, chatId);
        return;
      }
      await cmdLookup(text, chatId);
      return;
    }
    if (pending === 'await_revoke') {
      if (text.length < 6) {
        setPending(chatId, 'await_revoke');
        await sendMessage('Cần licenseId hoặc HWID.', undefined, chatId);
        return;
      }
      await cmdRevokePrompt(text, chatId);
      return;
    }

    // Reply keyboard buttons
    const btn = matchReplyBtn(text);
    if (btn === 'activate') {
      setPending(chatId, 'await_hwid');
      await sendMessage(
        '🔑 Gửi HWID khách ở tin tiếp theo.',
        undefined,
        chatId,
      );
      return;
    }
    if (btn === 'lookup') {
      setPending(chatId, 'await_lookup');
      await sendMessage('🔎 Gửi HWID/prefix.', undefined, chatId);
      return;
    }
    if (btn === 'revoke') {
      setPending(chatId, 'await_revoke');
      await sendMessage('🚫 Gửi licenseId hoặc HWID.', undefined, chatId);
      return;
    }
    if (btn === 'list') {
      await cmdList('active', 10, chatId);
      return;
    }
    if (btn === 'plans') {
      await sendMessage(
        '📦 Gói Pro\n• month · year · lifetime',
        undefined,
        chatId,
      );
      return;
    }
    if (btn === 'status') {
      await cmdStatus(chatId);
      return;
    }
    if (btn === 'menu') {
      await openMenu(chatId);
      return;
    }

    // Bare HWID wizard
    const bare = tryParseBareHwid(text);
    if (bare) {
      await sendMessage(
        [
          '🖥 Mã thiết bị nhận được',
          `HWID: ${bare}`,
          '',
          'Chọn gói để cấp key Pro:',
        ].join('\n'),
        planPickerKeyboard(bare),
        chatId,
      );
      return;
    }

    if (!text.startsWith('/')) return;
    const parts = text.split(/\s+/).filter(Boolean);
    const cmd = (parts[0] || '').split('@')[0]!.toLowerCase();

    if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
      await openMenu(chatId);
      return;
    }
    if (cmd === '/status' || cmd === '/ping') {
      await cmdStatus(chatId);
      return;
    }
    if (cmd === '/plans' || cmd === '/goi') {
      await sendMessage(
        '📦 Gói Pro\n• month · year · lifetime',
        undefined,
        chatId,
      );
      return;
    }
    if (
      cmd === '/activate' ||
      cmd === '/gen' ||
      cmd === '/cap' ||
      cmd === '/issue'
    ) {
      const hwid = normalizeHwid(parts[1] || '');
      if (!hwid) {
        setPending(chatId, 'await_hwid');
        await sendMessage(
          '🔑 Gửi HWID khách ở tin tiếp theo.',
          undefined,
          chatId,
        );
        return;
      }
      const planId = parsePlanArg(parts[2]);
      if (!planId) {
        await sendMessage(
          [
            '🖥 Mã thiết bị nhận được',
            `HWID: ${hwid.toUpperCase()}`,
            '',
            'Chọn gói để cấp key Pro:',
          ].join('\n'),
          planPickerKeyboard(hwid),
          chatId,
        );
        return;
      }
      await deliverIssue(planId, hwid);
      return;
    }
    if (cmd === '/lookup' || cmd === '/find' || cmd === '/search') {
      const q = (parts[1] || '').trim();
      if (q.length < 3) {
        setPending(chatId, 'await_lookup');
        await sendMessage('🔎 Gửi HWID/prefix.', undefined, chatId);
        return;
      }
      await cmdLookup(q, chatId);
      return;
    }
    if (cmd === '/list' || cmd === '/ls') {
      let status: 'active' | 'revoked' | 'all' = 'active';
      let limit = 10;
      for (const p of parts.slice(1)) {
        const low = p.toLowerCase();
        if (low === 'active' || low === 'revoked' || low === 'all') status = low;
        else if (/^\d+$/.test(p)) limit = Math.min(15, Math.max(1, Number(p)));
      }
      await cmdList(status, limit, chatId);
      return;
    }
    if (cmd === '/revoke' || cmd === '/thuhoi') {
      const target = (parts[1] || '').trim();
      if (!target || target.length < 6) {
        setPending(chatId, 'await_revoke');
        await sendMessage('🚫 Gửi licenseId hoặc HWID.', undefined, chatId);
        return;
      }
      await cmdRevokePrompt(target, chatId);
      return;
    }
  } catch (e) {
    await sendMessage(
      `❌ Lỗi hệ thống: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      chatId,
    );
  }
}
