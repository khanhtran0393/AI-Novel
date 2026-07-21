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
      const issued = await issueAndPersist(parsed.hwid, parsed.planId);
      const text = approveText(
        parsed.planId,
        parsed.hwid,
        issued.token,
        originalText,
        {
          dbOk: issued.dbOk,
          dbError: issued.dbError,
          licenseId: issued.licenseId,
        },
      );
      const edited = await editMessage(chatId, messageId, text);
      if (!edited.ok) {
        await sendMessage(
          approveText(parsed.planId, parsed.hwid, issued.token, undefined, {
            dbOk: issued.dbOk,
            dbError: issued.dbError,
            licenseId: issued.licenseId,
          }),
        );
      }
      if (!issued.dbOk) {
        await sendMessage(
          `⚠️ Key đã ký nhưng Supabase LỖI (HWID ${parsed.hwid.toUpperCase()}):\n${issued.dbError || 'unknown'}\n` +
            'App One-Path: không có row licenses active → khách dán key bị từ chối. Kiểm tra SERVICE_ROLE trên Vercel bridge.',
        );
      }
      await answerCallback(
        cq.id,
        issued.dbOk ? 'Đã cấp key + ghi DB.' : 'Đã cấp key (DB lỗi!).',
        !issued.dbOk,
      );
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
    const issued = await issueAndPersist(hwid, planId);
    await sendMessage(
      approveText(planId, hwid, issued.token, undefined, {
        dbOk: issued.dbOk,
        dbError: issued.dbError,
        licenseId: issued.licenseId,
      }),
    );
    if (!issued.dbOk) {
      await sendMessage(
        `⚠️ /gen: Supabase LỖI — app sẽ không nhận key:\n${issued.dbError || 'unknown'}`,
      );
    }
  } catch (e) {
    await sendMessage(
      `❌ Lỗi hệ thống: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
