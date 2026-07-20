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

export function webhookSecret(): string {
  return (process.env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '').trim();
}

export function isAdminChat(chatId: string | number | undefined | null): boolean {
  const expected = adminChatId();
  if (!expected || chatId == null || chatId === '') return false;
  return String(chatId).trim() === expected;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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

export function parseCallback(
  raw: string | undefined | null,
):
  | { action: 'issue'; planId: PaidPlanId; hwid: string }
  | { action: 'reject'; hwid: string }
  | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (s.startsWith('issue:')) {
    const rest = s.slice('issue:'.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    const planRaw = rest.slice(0, colon) as PaidPlanId;
    const hwid = rest.slice(colon + 1).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    const planId: PaidPlanId =
      planRaw === 'month' || planRaw === 'year' || planRaw === 'lifetime'
        ? planRaw
        : 'lifetime';
    return { action: 'issue', planId, hwid };
  }
  if (s.startsWith('reject:')) {
    const hwid = s.slice('reject:'.length).trim().toUpperCase();
    if (!hwid || hwid.length < 6) return null;
    return { action: 'reject', hwid };
  }
  return null;
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
  };
  if (!res.ok || !data.ok) {
    return {
      ok: false as const,
      error: data.description || `HTTP ${res.status}`,
      data,
    };
  }
  return { ok: true as const, data };
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

export async function sendMessage(text: string) {
  return tgApi('sendMessage', {
    chat_id: adminChatId(),
    text,
    disable_web_page_preview: true,
  });
}

export function approveText(
  planId: PaidPlanId,
  hwid: string,
  token: string,
  original?: string,
): string {
  const plan = PAID_PLANS[planId] || PAID_PLANS.lifetime;
  const body = [
    '✅ ĐÃ CẤP KEY',
    '',
    `📦 Gói: ${plan.label} (${planId})`,
    `🖥 HWID: ${hwid.toUpperCase()}`,
    '🔐 Bridge: Ed25519 AINOVEL2 (kid = SHA256 public SPKI[:16])',
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
  };
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
};

export async function processUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query?.id) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    const originalText = cq.message?.text || '';

    if (!isAdminChat(chatId)) {
      await answerCallback(cq.id, 'Chat không được phép.', true);
      return;
    }
    const parsed = parseCallback(cq.data);
    if (!parsed) {
      await answerCallback(cq.id, 'Callback không hợp lệ.', true);
      return;
    }
    if (chatId == null || messageId == null) {
      await answerCallback(cq.id, 'Thiếu message context.', true);
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

    try {
      const token = issueProToken(parsed.hwid, parsed.planId);
      const text = approveText(
        parsed.planId,
        parsed.hwid,
        token,
        originalText,
      );
      const edited = await editMessage(chatId, messageId, text);
      if (!edited.ok) {
        await sendMessage(
          approveText(parsed.planId, parsed.hwid, token),
        );
      }
      await answerCallback(cq.id, 'Đã cấp key.', false);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await answerCallback(cq.id, `Lỗi: ${errMsg}`.slice(0, 200), true);
      await sendMessage(`❌ Lỗi cấp key (HWID ${parsed.hwid}): ${errMsg}`);
    }
    return;
  }

  // /gen <hwid> [month|year|lifetime]
  const msg = update.message;
  if (!msg?.text || !isAdminChat(msg.chat?.id)) return;
  const text = msg.text.trim();
  if (!text.startsWith('/gen')) return;
  const parts = text.split(/\s+/).filter(Boolean);
  const hwid = (parts[1] || '').trim();
  let planId = (parts[2] || 'lifetime') as PaidPlanId;
  if (!PAID_PLANS[planId]) planId = 'lifetime';
  if (!hwid || hwid.length < 6) {
    await sendMessage('Cú pháp: /gen <hwid> [month|year|lifetime]');
    return;
  }
  try {
    const token = issueProToken(hwid, planId);
    await sendMessage(approveText(planId, hwid, token));
  } catch (e) {
    await sendMessage(
      `❌ Lỗi hệ thống: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
