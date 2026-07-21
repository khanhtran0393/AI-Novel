/**
 * Shared Telegram update handling (webhook POST + desktop getUpdates poller).
 */
import {
  issueProLicenseForPlan,
  hashToken,
  paidPlanToLicense,
  auditLog,
} from '@/lib/cloud/licenseBridge';
import { createServiceSupabase } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  answerTelegramCallback,
  buildApproveMessage,
  buildRejectMessage,
  editTelegramMessage,
  isAdminChatId,
  parseTelegramCallbackData,
  sendTelegramMessage,
  telegramBotToken,
} from '@/lib/commercial/telegramNotify';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import { PAID_PLANS } from '@/lib/commercial/pricingPlans';

const PLAN_IDS = new Set(PAID_PLANS.map((p) => p.id));

export type TgCallbackQuery = {
  id: string;
  data?: string;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string };
  };
  from?: { id?: number; username?: string };
};

export type TgMessage = {
  text?: string;
  chat?: { id?: number | string };
};

export type TgUpdate = {
  update_id?: number;
  callback_query?: TgCallbackQuery;
  message?: TgMessage;
};

export async function issueAndPersistLicense(
  planId: PaidPlanId,
  hwid: string,
): Promise<{
  token: string;
  dbOk: boolean;
  dbError?: string;
  licenseId?: string;
}> {
  const issued = issueProLicenseForPlan(planId, hwid);
  const meta = paidPlanToLicense(planId);
  const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();
  const tokenHash = hashToken(issued.token);
  const hwidNorm = hwid.trim().toLowerCase();

  if (!isSupabaseAdminConfigured()) {
    return {
      token: issued.token,
      dbOk: false,
      dbError:
        'Supabase admin chưa cấu hình. Hãy cấu hình license server với khóa ký Ed25519 trước khi cấp key.',
    };
  }

  try {
    const service = createServiceSupabase();
    const { data, error: licErr } = await service
      .from('licenses')
      .insert({
        user_id: null,
        order_id: null,
        plan: meta.licensePlan,
        hwid: hwidNorm,
        status: 'active',
        exp_at: expAt,
        token_hash: tokenHash,
        activation_code: null,
      })
      .select('id')
      .single();

    if (licErr) {
      return { token: issued.token, dbOk: false, dbError: licErr.message };
    }

    await auditLog(
      service,
      'telegram.issue_key',
      {
        planId,
        hwid: hwidNorm,
        licenseId: data?.id,
        source: 'telegram',
      },
      'telegram-admin',
    );

    return {
      token: issued.token,
      dbOk: true,
      licenseId: data?.id as string | undefined,
    };
  } catch (e) {
    return {
      token: issued.token,
      dbOk: false,
      dbError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function handleCallbackQuery(cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const originalText = cq.message?.text || '';

  if (!isAdminChatId(chatId)) {
    await answerTelegramCallback(cq.id, 'Chat không được phép.', true);
    return;
  }

  const parsed = parseTelegramCallbackData(cq.data);
  if (!parsed) {
    await answerTelegramCallback(cq.id, 'Callback không hợp lệ.', true);
    return;
  }

  if (chatId == null || messageId == null) {
    await answerTelegramCallback(cq.id, 'Thiếu message context.', true);
    return;
  }

  if (parsed.action === 'reject') {
    const text = buildRejectMessage({
      originalText,
      hwid: parsed.hwid,
    });
    const edited = await editTelegramMessage({ chatId, messageId, text });
    await answerTelegramCallback(
      cq.id,
      edited.ok ? 'Đã từ chối.' : edited.error || 'Edit fail',
      !edited.ok,
    );
    return;
  }

  try {
    const result = await issueAndPersistLicense(parsed.planId, parsed.hwid);
    const text = buildApproveMessage({
      originalText,
      planId: parsed.planId,
      hwid: parsed.hwid,
      token: result.token,
      dbOk: result.dbOk,
      dbError: result.dbError,
    });
    const edited = await editTelegramMessage({ chatId, messageId, text });
    if (!edited.ok) {
      await sendTelegramMessage(
        buildApproveMessage({
          planId: parsed.planId,
          hwid: parsed.hwid,
          token: result.token,
          dbOk: result.dbOk,
          dbError: result.dbError || edited.error,
        }),
      );
    }
    // Cảnh báo admin khi DB fail — khách kích hoạt có thể bị Free nếu app enforce Supabase
    if (!result.dbOk) {
      await sendTelegramMessage(
        `⚠️ Key đã tạo nhưng Supabase LỖI (HWID ${parsed.hwid.toUpperCase()}):\n${result.dbError || 'unknown'}\n` +
          'Supabase ledger bắt buộc: nếu không ghi được licenses thì khách dán key sẽ Free (không self-heal). Kiểm tra SERVICE_ROLE.',
      );
    }
    await answerTelegramCallback(
      cq.id,
      result.dbOk ? 'Đã cấp key + ghi DB.' : 'Đã cấp key (DB cảnh báo).',
      !result.dbOk,
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await answerTelegramCallback(cq.id, `Lỗi: ${errMsg}`.slice(0, 200), true);
    await sendTelegramMessage(
      `❌ Lỗi cấp key (HWID ${parsed.hwid}): ${errMsg}`,
    );
  }
}

export async function handleAdminMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  if (!isAdminChatId(chatId)) return;
  if (!text.startsWith('/gen')) return;

  const parts = text.split(/\s+/).filter(Boolean);
  const hwid = (parts[1] || '').trim();
  let planId = (parts[2] || 'lifetime') as PaidPlanId;
  if (!PLAN_IDS.has(planId)) planId = 'lifetime';

  if (!hwid || hwid.length < 6) {
    await sendTelegramMessage(
      'Cú pháp: /gen <hwid> [month|year|lifetime]',
    );
    return;
  }

  try {
    const result = await issueAndPersistLicense(planId, hwid);
    await sendTelegramMessage(
      buildApproveMessage({
        planId,
        hwid,
        token: result.token,
        dbOk: result.dbOk,
        dbError: result.dbError,
      }),
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await sendTelegramMessage(`❌ Lỗi hệ thống: ${errMsg}`);
  }
}

/** Process one Telegram update object (from webhook or getUpdates). */
export async function processTelegramUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query?.id) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message?.text) {
    await handleAdminMessage(update.message);
  }
}
