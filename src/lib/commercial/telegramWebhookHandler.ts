/**
 * Shared Telegram update handling (webhook POST + desktop getUpdates poller).
 * Admin: issue key, bare-HWID wizard, lookup/list/revoke, help/status.
 */
import {
  issueProLicenseForPlan,
  hashToken,
  paidPlanToLicense,
  auditLog,
  listLicenses,
  revokeLicense,
  type LicenseListRow,
} from '@/lib/cloud/licenseBridge';
import { createServiceSupabase } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  answerTelegramCallback,
  buildApproveMessage,
  buildRejectMessage,
  editTelegramMessage,
  isAdminActor,
  notifyPaymentReported,
  parsePayStartPayload,
  parseTelegramCallbackData,
  registerTelegramBotMenu,
  sendTelegramMessage,
  telegramAdminIdSet,
  telegramBotToken,
  telegramConfigured,
} from '@/lib/commercial/telegramNotify';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import {
  buildHelpMessage,
  buildMainInlineMenu,
  buildPlanPickerKeyboard,
  buildPlanPickerText,
  buildPlansMessage,
  buildRemoveReplyKeyboard,
  buildRevokeConfirmKeyboard,
  formatLicenseRows,
  normalizeHwid,
  parseAdminCommand,
  promptActivateText,
  promptLookupText,
  promptRevokeText,
  syntaxHint,
  type PendingMode,
} from '@/lib/commercial/telegramAdminCommands';
import { getEntitlementPublicStatus } from '@/lib/entitlement';

/** Pending multi-step input (Cấp key / Tra cứu / Thu hồi) per chat. */
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
  from?: { id?: number; username?: string; first_name?: string };
};

export type TgUpdate = {
  update_id?: number;
  callback_query?: TgCallbackQuery;
  message?: TgMessage;
};

function signerKidHint(): string {
  try {
    const kids = getEntitlementPublicStatus().keyringKids || [];
    return kids.length ? kids.join(',') : '(no public kids)';
  } catch {
    return '(n/a)';
  }
}

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
    // Prefer update existing active row for this HWID (parity with bridge)
    const { data: existing } = await service
      .from('licenses')
      .select('id')
      .ilike('hwid', hwidNorm)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { error: upErr } = await service
        .from('licenses')
        .update({
          plan: meta.licensePlan,
          hwid: hwidNorm,
          status: 'active',
          exp_at: expAt,
          token_hash: tokenHash,
          activation_code: null,
        })
        .eq('id', existing.id);
      if (upErr) {
        return { token: issued.token, dbOk: false, dbError: upErr.message };
      }
      await auditLog(
        service,
        'telegram.issue_key',
        {
          planId,
          hwid: hwidNorm,
          licenseId: existing.id,
          source: 'telegram',
          mode: 'update',
        },
        'telegram-admin',
      );
      return {
        token: issued.token,
        dbOk: true,
        licenseId: existing.id as string,
      };
    }

    const { insertLicenseRow } = await import('@/lib/cloud/licenseBridge');
    let licenseId: string;
    try {
      const lic = await insertLicenseRow(service, {
        order_id: null,
        plan: meta.licensePlan,
        hwid: hwidNorm,
        status: 'active',
        exp_at: expAt,
        token_hash: tokenHash,
        activation_code: null,
      });
      licenseId = lic.id;
    } catch (e) {
      return {
        token: issued.token,
        dbOk: false,
        dbError: e instanceof Error ? e.message : String(e),
      };
    }

    await auditLog(
      service,
      'telegram.issue_key',
      {
        planId,
        hwid: hwidNorm,
        licenseId,
        source: 'telegram',
        mode: 'insert',
      },
      'telegram-admin',
    );

    return {
      token: issued.token,
      dbOk: true,
      licenseId,
    };
  } catch (e) {
    return {
      token: issued.token,
      dbOk: false,
      dbError: e instanceof Error ? e.message : String(e),
    };
  }
}

async function deliverIssuedKey(
  planId: PaidPlanId,
  hwid: string,
  originalText?: string,
  editCtx?: { chatId: string | number; messageId: number },
): Promise<void> {
  const result = await issueAndPersistLicense(planId, hwid);
  const text = buildApproveMessage({
    originalText,
    planId,
    hwid,
    token: result.token,
    dbOk: result.dbOk,
    dbError: result.dbError,
  });
  const replyTo =
    editCtx?.chatId != null ? editCtx.chatId : undefined;
  const canEdit =
    editCtx != null &&
    Number.isFinite(editCtx.messageId) &&
    editCtx.messageId > 0;
  if (canEdit && editCtx) {
    const edited = await editTelegramMessage({
      chatId: editCtx.chatId,
      messageId: editCtx.messageId,
      text,
    });
    if (!edited.ok) {
      await sendTelegramMessage(
        buildApproveMessage({
          planId,
          hwid,
          token: result.token,
          dbOk: result.dbOk,
          dbError: result.dbError || edited.error,
        }),
        undefined,
        replyTo,
      );
    }
  } else {
    await sendTelegramMessage(text, undefined, replyTo);
  }
  if (!result.dbOk) {
    await sendTelegramMessage(
      `⚠️ Key đã tạo nhưng Supabase LỖI (HWID ${hwid.toUpperCase()}):\n${result.dbError || 'unknown'}\n` +
        'Supabase ledger bắt buộc: nếu không ghi được licenses thì khách dán key sẽ Free (không self-heal). Kiểm tra SERVICE_ROLE.',
      undefined,
      replyTo,
    );
  }
}

async function replyToChat(
  chatId: string | number | undefined,
  text: string,
  markup?: Parameters<typeof sendTelegramMessage>[1],
) {
  await sendTelegramMessage(text, markup, chatId);
}

async function openMainMenu(chatId: string | number | undefined) {
  await registerTelegramBotMenu().catch(() => undefined);
  // Ẩn reply keyboard cũ (nếu còn dính) — chỉ giữ nút inline trong tin nhắn
  await replyToChat(
    chatId,
    buildHelpMessage(),
    buildRemoveReplyKeyboard(),
  );
  await replyToChat(
    chatId,
    '⬇️ Bấm nút trong tin nhắn:',
    buildMainInlineMenu(),
  );
}

export async function handleCallbackQuery(cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const originalText = cq.message?.text || '';
  const fromId = cq.from?.id;

  if (!isAdminActor({ chatId, fromId })) {
    await answerTelegramCallback(
      cq.id,
      'Chat/user không được phép. Thêm user id vào AINOVEL_TELEGRAM_CHAT_ID (phẩy).',
      true,
    );
    return;
  }

  const parsed = parseTelegramCallbackData(cq.data);
  if (!parsed) {
    await answerTelegramCallback(
      cq.id,
      `Callback lạ: ${(cq.data || '').slice(0, 40)}`,
      true,
    );
    return;
  }

  if (chatId == null || messageId == null) {
    await answerTelegramCallback(cq.id, 'Thiếu message context.', true);
    return;
  }

  // Answer immediately so Telegram stops the loading spinner on buttons
  if (parsed.action === 'issue' || parsed.action === 'pick') {
    await answerTelegramCallback(cq.id, '⏳ Đang cấp key…');
  }

  if (parsed.action === 'menu') {
    clearPending(chatId);
    switch (parsed.item) {
      case 'activate':
        setPending(chatId, 'await_hwid');
        await answerTelegramCallback(cq.id, 'Gửi HWID…');
        await replyToChat(chatId, promptActivateText());
        return;
      case 'lookup':
        setPending(chatId, 'await_lookup');
        await answerTelegramCallback(cq.id, 'Gửi HWID…');
        await replyToChat(chatId, promptLookupText());
        return;
      case 'revoke':
        setPending(chatId, 'await_revoke');
        await answerTelegramCallback(cq.id, 'Gửi id/HWID…');
        await replyToChat(chatId, promptRevokeText());
        return;
      case 'list':
        await answerTelegramCallback(cq.id, 'List…');
        await cmdList('active', 10, chatId);
        return;
      case 'plans':
        await answerTelegramCallback(cq.id, 'Gói');
        await replyToChat(chatId, buildPlansMessage());
        return;
      case 'status':
        await answerTelegramCallback(cq.id, 'Status');
        await cmdStatus(chatId);
        return;
      case 'help':
        await answerTelegramCallback(cq.id, 'Menu');
        await openMainMenu(chatId);
        return;
      default:
        await answerTelegramCallback(cq.id, 'OK');
        return;
    }
  }

  if (parsed.action === 'pick_cancel') {
    const text = `${originalText}\n\n─────────────────\n❌ Đã huỷ chọn gói.`;
    await editTelegramMessage({ chatId, messageId, text });
    await answerTelegramCallback(cq.id, 'Đã huỷ.');
    return;
  }

  if (parsed.action === 'revoke_cancel') {
    const text = `${originalText}\n\n─────────────────\n↩ Đã huỷ thu hồi.`;
    await editTelegramMessage({ chatId, messageId, text });
    await answerTelegramCallback(cq.id, 'Đã huỷ revoke.');
    return;
  }

  if (parsed.action === 'revoke_confirm') {
    if (!isSupabaseAdminConfigured()) {
      await answerTelegramCallback(cq.id, 'Supabase chưa cấu hình.', true);
      return;
    }
    try {
      await answerTelegramCallback(cq.id, '⏳ Revoke…');
      const service = createServiceSupabase();
      await revokeLicense({
        service,
        licenseId: parsed.licenseId,
        actorId: 'telegram-admin',
      });
      const text = `${originalText}\n\n─────────────────\n✅ ĐÃ THU HỒI\nid=${parsed.licenseId}\nHeartbeat/verify máy khách → Free.`;
      await editTelegramMessage({ chatId, messageId, text });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await answerTelegramCallback(cq.id, `Lỗi: ${errMsg}`.slice(0, 200), true);
      await replyToChat(chatId, `❌ Revoke fail: ${errMsg}`);
    }
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

  // issue (payment) or pick (wizard) — same issue path
  if (parsed.action === 'issue' || parsed.action === 'pick') {
    try {
      await deliverIssuedKey(parsed.planId, parsed.hwid, originalText, {
        chatId,
        messageId,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await replyToChat(
        chatId,
        `❌ Lỗi cấp key (HWID ${parsed.hwid}): ${errMsg}`,
      );
    }
  }
}

async function cmdLookup(
  q: string,
  chatId?: string | number,
): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    await replyToChat(
      chatId,
      '❌ Supabase admin chưa cấu hình — không tra được.',
    );
    return;
  }
  const service = createServiceSupabase();
  const hwidQ = normalizeHwid(q) || q;
  const { rows, total } = await listLicenses({
    service,
    q: hwidQ,
    status: 'all',
    limit: 10,
  });
  await replyToChat(
    chatId,
    formatLicenseRows(rows as LicenseListRow[], `🔎 Lookup «${q}»`, total),
  );
}

async function cmdList(
  status: 'active' | 'revoked' | 'all',
  limit: number,
  chatId?: string | number,
): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    await replyToChat(
      chatId,
      '❌ Supabase admin chưa cấu hình — không list được.',
    );
    return;
  }
  const service = createServiceSupabase();
  const { rows, total } = await listLicenses({
    service,
    status,
    limit,
  });
  await replyToChat(
    chatId,
    formatLicenseRows(
      rows as LicenseListRow[],
      `📋 List status=${status}`,
      total,
    ),
  );
}

async function cmdRevokePrompt(
  target: string,
  chatId?: string | number,
): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    await replyToChat(
      chatId,
      '❌ Supabase admin chưa cấu hình — không revoke được.',
    );
    return;
  }
  const service = createServiceSupabase();
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      target,
    );

  let licenseId = looksLikeUuid ? target : '';
  let preview = '';

  if (!licenseId) {
    const hwid = normalizeHwid(target) || target.toLowerCase();
    const { rows } = await listLicenses({
      service,
      q: hwid,
      status: 'active',
      limit: 5,
    });
    const exact = rows.find(
      (r) => (r.hwid || '').toLowerCase() === hwid.toLowerCase(),
    );
    const pick = exact || rows[0];
    if (!pick) {
      await replyToChat(
        chatId,
        `Không tìm thấy license active cho «${target}».\nThử Tra cứu.`,
      );
      return;
    }
    licenseId = pick.id;
    preview = formatLicenseRows(
      [pick],
      'Ứng viên thu hồi (active mới nhất khớp):',
    );
  } else {
    const { data: found, error } = await service
      .from('licenses')
      .select('id,plan,status,hwid,exp_at,created_at')
      .eq('id', licenseId)
      .maybeSingle();
    preview =
      !error && found
        ? formatLicenseRows([found as LicenseListRow], 'Ứng viên thu hồi:')
        : `id=${licenseId} (không load preview — vẫn có thể revoke)`;
  }

  await replyToChat(
    chatId,
    `${preview}\n\n⚠️ Xác nhận thu hồi? Máy khách sẽ về Free sau heartbeat.`,
    buildRevokeConfirmKeyboard(licenseId),
  );
}

async function cmdStatus(chatId?: string | number): Promise<void> {
  const ids = [...telegramAdminIdSet()].join(', ') || '(empty)';
  const lines = [
    '🩺 Bot status',
    `Telegram configured: ${telegramConfigured() ? 'yes' : 'NO'}`,
    `Bot token: ${telegramBotToken() ? 'set' : 'missing'}`,
    `Admin ids: ${ids}`,
    `Supabase ledger: ${isSupabaseAdminConfigured() ? 'yes' : 'NO'}`,
    `Public kids: ${signerKidHint()}`,
    '',
    'One-Path: AINOVEL2 + licenses.active.',
    'Bấm ❓ Menu nếu bàn phím biến mất.',
  ];
  await replyToChat(chatId, lines.join('\n'));
}

/**
 * Khách (không phải admin) nhắn bot / bấm deep-link start=pay_…
 * → forward thành báo thanh toán cho admin (nút Cấp Key).
 * Trước đây non-admin bị nuốt im lặng → user tưởng bot không nhận.
 */
export async function handleCustomerMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const text = (msg.text || '').trim();
  if (!text || chatId == null) return;

  // /start pay_lifetime_HWID  or bare /start
  if (/^\/start\b/i.test(text)) {
    const pay = parsePayStartPayload(text);
    if (pay) {
      const who = msg.from?.username
        ? `@${msg.from.username}`
        : String(fromId || msg.from?.first_name || '?');
      const result = await notifyPaymentReported({
        hwid: pay.hwid,
        planId: pay.planId,
        note: `Khách Telegram ${who} deep-link start`,
      });
      if (result.ok) {
        await replyToChat(
          chatId,
          `✅ Đã gửi yêu cầu kích hoạt cho Admin.\n🖥 HWID: ${pay.hwid}\n📦 Gói: ${pay.planId}\n⏳ Chờ Admin bấm Cấp Key — bạn sẽ nhận key qua kênh hỗ trợ.`,
        );
      } else if (result.cooldown) {
        await replyToChat(
          chatId,
          `⏳ ${result.error || 'Bạn vừa gửi rồi, chờ ~2 phút rồi thử lại.'}`,
        );
      } else {
        await replyToChat(
          chatId,
          `⚠️ Chưa gửi được cho Admin: ${result.error || 'lỗi Telegram'}. Gửi lại HWID (hex) + gói hoặc báo Zalo admin.`,
        );
      }
      return;
    }

    await replyToChat(
      chatId,
      [
        '👋 AI Novel License Bot',
        '',
        'Cách báo đã thanh toán (khuyến nghị):',
        '1) Trong app: Logo → Bản quyền → ✓ Đã thanh toán — báo Admin',
        '2) Hoặc gửi tin: HWID + gói (month|year|lifetime)',
        '',
        'Ví dụ: F925B0FF900599A0 lifetime',
      ].join('\n'),
    );
    return;
  }

  // "HWID" or "HWID plan" from customer chat
  const parts = text.split(/\s+/).filter(Boolean);
  let hwid: string | null = null;
  let planId: PaidPlanId = 'lifetime';
  for (const p of parts) {
    const n = normalizeHwid(p);
    if (n) hwid = n;
    const low = p.toLowerCase();
    if (low === 'month' || low === 'thang' || low === 'tháng') planId = 'month';
    if (low === 'year' || low === 'nam' || low === 'năm') planId = 'year';
    if (low === 'lifetime' || low === 'trondoi' || low === 'tron' || low === 'đời')
      planId = 'lifetime';
  }
  if (!hwid) {
    await replyToChat(
      chatId,
      'Gửi HWID (mã thiết bị trong app Bản quyền) kèm gói: month | year | lifetime.\nHoặc bấm «Đã thanh toán» trong app để Admin nhận nút Cấp Key.',
    );
    return;
  }

  const result = await notifyPaymentReported({
    hwid,
    planId,
    note: `Khách Telegram @${msg.from?.username || fromId || '?'} nhắn bot`,
  });
  if (result.ok) {
    await replyToChat(
      chatId,
      `✅ Đã báo Admin.\n🖥 ${hwid}\n📦 ${planId}\nChờ Cấp Key.`,
    );
  } else if (result.cooldown) {
    await replyToChat(chatId, `⏳ ${result.error || 'Chờ ~2 phút.'}`);
  } else {
    await replyToChat(
      chatId,
      `⚠️ Lỗi: ${result.error || 'không gửi được Admin'}`,
    );
  }
}

export async function handleAdminMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const text = (msg.text || '').trim();
  if (!isAdminActor({ chatId, fromId })) {
    await handleCustomerMessage(msg);
    return;
  }
  if (!text || chatId == null) return;

  // Multi-step pending (button → next message)
  const pending = takePending(chatId);
  if (pending === 'await_hwid') {
    const hwid = normalizeHwid(text) || tryBareFromPending(text);
    if (!hwid) {
      setPending(chatId, 'await_hwid');
      await replyToChat(
        chatId,
        'HWID không hợp lệ (cần ≥8 hex). Gửi lại hoặc bấm Menu.',
      );
      return;
    }
    await replyToChat(
      chatId,
      buildPlanPickerText(hwid),
      buildPlanPickerKeyboard(hwid),
    );
    return;
  }
  if (pending === 'await_lookup') {
    if (text.trim().length < 3) {
      setPending(chatId, 'await_lookup');
      await replyToChat(chatId, promptLookupText());
      return;
    }
    await cmdLookup(text.trim(), chatId);
    return;
  }
  if (pending === 'await_revoke') {
    if (text.trim().length < 6) {
      setPending(chatId, 'await_revoke');
      await replyToChat(chatId, promptRevokeText());
      return;
    }
    await cmdRevokePrompt(text.trim(), chatId);
    return;
  }

  const parsed = parseAdminCommand(text);
  if (!parsed) return;

  try {
    switch (parsed.kind) {
      case 'help':
      case 'menu':
        await openMainMenu(chatId);
        return;
      case 'status':
        await cmdStatus(chatId);
        return;
      case 'plans':
        await replyToChat(chatId, buildPlansMessage());
        return;
      case 'prompt_activate':
        setPending(chatId, 'await_hwid');
        await replyToChat(chatId, promptActivateText());
        return;
      case 'prompt_lookup':
        setPending(chatId, 'await_lookup');
        await replyToChat(chatId, promptLookupText());
        return;
      case 'prompt_revoke':
        setPending(chatId, 'await_revoke');
        await replyToChat(chatId, promptRevokeText());
        return;
      case 'bare_hwid':
        await replyToChat(
          chatId,
          buildPlanPickerText(parsed.hwid),
          buildPlanPickerKeyboard(parsed.hwid),
        );
        return;
      case 'activate': {
        if (!parsed.planId) {
          await replyToChat(
            chatId,
            buildPlanPickerText(parsed.hwid),
            buildPlanPickerKeyboard(parsed.hwid),
          );
          return;
        }
        await deliverIssuedKey(parsed.planId, parsed.hwid, undefined, {
          chatId,
          messageId: 0,
        });
        return;
      }
      case 'lookup':
        await cmdLookup(parsed.q, chatId);
        return;
      case 'list':
        await cmdList(parsed.status, parsed.limit, chatId);
        return;
      case 'revoke':
        await cmdRevokePrompt(parsed.target, chatId);
        return;
      case 'unknown':
        await replyToChat(chatId, syntaxHint(parsed.raw));
        return;
      default:
        return;
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await replyToChat(chatId, `❌ Lỗi hệ thống: ${errMsg}`);
  }
}

function tryBareFromPending(text: string): string | null {
  return normalizeHwid(text);
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
