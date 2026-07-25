/**
 * Shared Telegram update handling (webhook POST + desktop getUpdates poller).
 * Admin: issue key, bare-HWID wizard, lookup/list/revoke, help/status.
 */
import {
  issueProLicenseForDuration,
  issueProLicenseForPlan,
  persistIssuedProToken,
  listLicenses,
  revokeLicense,
  issueUnboundProActivationCodes,
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
  buildGencodeCountKeyboard,
  buildGencodePlanKeyboard,
  buildHelpMessage,
  buildMainInlineMenu,
  buildPlanPickerKeyboard,
  buildPlanPickerText,
  buildPlansMessage,
  buildRemoveReplyKeyboard,
  buildRevokeConfirmKeyboard,
  formatActivationCodeRows,
  buildGencodeDeliveryMessages,
  formatLicenseRows,
  normalizeHwid,
  parseAdminCommand,
  promptActivateText,
  promptGencodeCountText,
  promptGencodeText,
  promptLookupText,
  promptRevokeText,
  resolveGencodeExpKey,
  syntaxHint,
  type PendingMode,
} from '@/lib/commercial/telegramAdminCommands';
import { getEntitlementPublicStatus } from '@/lib/entitlement';

/** Pending multi-step input (Cấp key / Tra cứu / Thu hồi / Tạo mã) per chat. */
type PendingState = {
  mode: PendingMode;
  at: number;
  /** For await_gencode_count: duration key (month|year|lifetime|30d…) */
  expKey?: string;
};
const pendingByChat = new Map<string, PendingState>();
const PENDING_TTL_MS = 15 * 60_000;

function setPending(
  chatId: string | number,
  mode: PendingMode,
  extra?: { expKey?: string },
) {
  pendingByChat.set(String(chatId), {
    mode,
    at: Date.now(),
    expKey: extra?.expKey,
  });
}

function takePending(chatId: string | number): PendingState | null {
  const key = String(chatId);
  const p = pendingByChat.get(key);
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL_MS) {
    pendingByChat.delete(key);
    return null;
  }
  pendingByChat.delete(key);
  return p;
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

/**
 * Issue Pro key for paid plan OR day preset (3d/7d/15d/30d).
 * expKey: month|year|lifetime|3d|7d|15d|30d|…
 */
export async function issueAndPersistLicense(
  planIdOrExpKey: PaidPlanId | string,
  hwid: string,
): Promise<{
  token: string;
  dbOk: boolean;
  dbError?: string;
  licenseId?: string;
  expSeconds: number;
  expLabel: string;
  expKey: string;
  planId?: PaidPlanId;
}> {
  const resolved = resolveGencodeExpKey(String(planIdOrExpKey));
  const expSeconds = resolved.expSeconds;
  const expLabel = resolved.label;
  const expKey = resolved.expKey;
  const planId = resolved.planId;
  const issued = planId
    ? issueProLicenseForPlan(planId, hwid)
    : issueProLicenseForDuration(hwid, expSeconds);
  const hwidNorm = hwid.trim().toLowerCase();

  if (!isSupabaseAdminConfigured()) {
    // Never return a usable token when ledger cannot be written.
    return {
      token: '',
      dbOk: false,
      dbError:
        'Supabase admin chưa cấu hình. Hãy cấu hình license server với khóa ký Ed25519 trước khi cấp key.',
      expSeconds,
      expLabel,
      expKey,
      planId,
    };
  }

  try {
    const service = createServiceSupabase();
    const persisted = await persistIssuedProToken({
      service,
      token: issued.token,
      hwid: hwidNorm,
      actorId: 'telegram-admin',
      source: `telegram:${planId || expKey}`,
    });

    return {
      token: issued.token,
      dbOk: true,
      licenseId: persisted.licenseId,
      expSeconds,
      expLabel,
      expKey,
      planId,
    };
  } catch (e) {
    return {
      token: '',
      dbOk: false,
      dbError: e instanceof Error ? e.message : String(e),
      expSeconds,
      expLabel,
      expKey,
      planId,
    };
  }
}

async function deliverIssuedKey(
  planIdOrExpKey: PaidPlanId | string,
  hwid: string,
  originalText?: string,
  editCtx?: { chatId: string | number; messageId: number },
): Promise<void> {
  const result = await issueAndPersistLicense(planIdOrExpKey, hwid);
  const approve = {
    originalText,
    planId: result.planId,
    planLabel: result.expLabel,
    expKey: result.expKey,
    hwid,
    token: result.token,
    dbOk: result.dbOk,
    dbError: result.dbError,
  };
  const text = buildApproveMessage(approve);
  const replyTo =
    editCtx?.chatId != null ? editCtx.chatId : undefined;
  const canEdit =
    editCtx != null &&
    Number.isFinite(editCtx.messageId) &&
    editCtx.messageId > 0;
  if (!result.dbOk) {
    if (canEdit && editCtx) {
      const edited = await editTelegramMessage({
        chatId: editCtx.chatId,
        messageId: editCtx.messageId,
        text,
      });
      if (!edited.ok) {
        await sendTelegramMessage(text, undefined, replyTo);
      }
    } else {
      await sendTelegramMessage(text, undefined, replyTo);
    }
    return;
  }
  if (canEdit && editCtx) {
    const edited = await editTelegramMessage({
      chatId: editCtx.chatId,
      messageId: editCtx.messageId,
      text,
    });
    if (!edited.ok) {
      await sendTelegramMessage(
        buildApproveMessage({
          ...approve,
          originalText: undefined,
          dbError: result.dbError || edited.error,
        }),
        undefined,
        replyTo,
      );
    }
  } else {
    await sendTelegramMessage(text, undefined, replyTo);
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

  // Answer IMMEDIATELY for every button — Telegram shows spinner until this fires.
  // (Second answerCallback on same id is ignored by Telegram.)
  const earlyHint =
    parsed.action === 'issue' || parsed.action === 'pick'
      ? '⏳ Đang cấp key…'
      : parsed.action === 'gencode_do'
        ? '⏳ Đang tạo mã…'
        : parsed.action === 'revoke_confirm'
          ? '⏳ Revoke…'
          : parsed.action === 'menu'
            ? 'OK'
            : '…';
  await answerTelegramCallback(cq.id, earlyHint);

  if (parsed.action === 'menu') {
    clearPending(chatId);
    switch (parsed.item) {
      case 'activate':
        setPending(chatId, 'await_hwid');
        await replyToChat(chatId, promptActivateText());
        return;
      case 'gencode':
        await replyToChat(
          chatId,
          promptGencodeText(),
          buildGencodePlanKeyboard(),
        );
        return;
      case 'lookup':
        setPending(chatId, 'await_lookup');
        await replyToChat(chatId, promptLookupText());
        return;
      case 'revoke':
        setPending(chatId, 'await_revoke');
        await replyToChat(chatId, promptRevokeText());
        return;
      case 'list':
        await cmdList('active', 10, chatId);
        return;
      case 'plans':
        await replyToChat(chatId, buildPlansMessage());
        return;
      case 'status':
        await cmdStatus(chatId);
        return;
      case 'help':
        await openMainMenu(chatId);
        return;
      default:
        await replyToChat(
          chatId,
          `Nút menu lạ: ${String((parsed as { item?: string }).item || '?')}`,
        );
        return;
    }
  }

  if (parsed.action === 'gencode_cancel') {
    clearPending(chatId);
    const text = `${originalText}\n\n─────────────────\n❌ Đã huỷ tạo mã.`;
    await editTelegramMessage({ chatId, messageId, text });
    return;
  }

  if (parsed.action === 'gencode_plan') {
    const resolved = resolveGencodeExpKey(parsed.expKey);
    setPending(chatId, 'await_gencode_count', { expKey: parsed.expKey });
    // Keep buttons on the SAME message so user never loses the count keyboard
    await editTelegramMessage({
      chatId,
      messageId,
      text: promptGencodeCountText(resolved.label),
      replyMarkup: buildGencodeCountKeyboard(parsed.expKey),
    });
    return;
  }

  if (parsed.action === 'gencode_do') {
    clearPending(chatId);
    const resolved = resolveGencodeExpKey(parsed.expKey);
    await cmdGencode(parsed.count, resolved.expSeconds, chatId);
    return;
  }

  if (parsed.action === 'pick_cancel') {
    const text = `${originalText}\n\n─────────────────\n❌ Đã huỷ chọn gói.`;
    await editTelegramMessage({ chatId, messageId, text });
    return;
  }

  if (parsed.action === 'revoke_cancel') {
    const text = `${originalText}\n\n─────────────────\n↩ Đã huỷ thu hồi.`;
    await editTelegramMessage({ chatId, messageId, text });
    return;
  }

  if (parsed.action === 'revoke_confirm') {
    if (!isSupabaseAdminConfigured()) {
      await replyToChat(chatId, '❌ Supabase chưa cấu hình — không revoke được.');
      return;
    }
    try {
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
      await replyToChat(chatId, `❌ Revoke fail: ${errMsg}`);
    }
    return;
  }

  if (parsed.action === 'reject') {
    const text = buildRejectMessage({
      originalText,
      hwid: parsed.hwid,
    });
    await editTelegramMessage({ chatId, messageId, text });
    return;
  }

  // issue (payment) or pick (wizard) — same issue path; supports 3d/7d/15d/30d
  if (parsed.action === 'issue' || parsed.action === 'pick') {
    try {
      const expKey = parsed.expKey || parsed.planId;
      await deliverIssuedKey(expKey, parsed.hwid, originalText, {
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
    return;
  }

  // Unreachable if parseTelegramCallbackData stays in sync with handlers
  await replyToChat(
    chatId,
    `⚠️ Callback đã parse nhưng chưa có handler: ${JSON.stringify(parsed).slice(0, 120)}`,
  );
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
    'Tạo mã: /gencode 5 year · AINOVEL-… (1 HWID/mã).',
    'Bấm ❓ Menu nếu bàn phím biến mất.',
  ];
  await replyToChat(chatId, lines.join('\n'));
}

async function cmdGencode(
  count: number,
  expSeconds: number,
  chatId?: string | number,
): Promise<void> {
  try {
    const service = isSupabaseAdminConfigured()
      ? createServiceSupabase()
      : null;
    const result = await issueUnboundProActivationCodes({
      service,
      count,
      expSeconds,
      note: `telegram-admin chat=${chatId ?? '?'}`,
    });
    // One code = one message → long-press copy / forward to customer
    const messages = buildGencodeDeliveryMessages(result);
    for (const msg of messages) {
      await replyToChat(chatId, msg);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await replyToChat(chatId, `❌ Tạo mã thất bại: ${errMsg}`);
  }
}

async function cmdListCodes(
  limit: number,
  chatId?: string | number,
): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    await replyToChat(
      chatId,
      '❌ Supabase ledger chưa cấu hình — không có danh sách mã local.',
    );
    return;
  }
  const listed = await listLicenses({
    service: createServiceSupabase(),
    limit: Math.max(limit, 100),
  });
  const rows = listed.rows
    .filter((row) => Boolean(row.activation_code))
    .slice(0, limit)
    .map((row) => {
      const createdAtMs = new Date(row.created_at || 0).getTime();
      const expAtMs = new Date(row.exp_at).getTime();
      const unbound = String(row.hwid || '').startsWith('unbound:');
      return {
        code: String(row.activation_code),
        redeemedHwid: unbound ? undefined : row.hwid,
        expSeconds: Math.max(
          60,
          Math.floor((expAtMs - createdAtMs) / 1000),
        ),
        createdAt: Math.floor(createdAtMs / 1000),
      };
    });
  await replyToChat(
    chatId,
    formatActivationCodeRows(rows, '🎟 Mã kích hoạt (Supabase ledger)'),
  );
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

  // /menu /start /activate … always win over pending HWID wizard.
  // (Bug: stuck await_hwid treated every command as invalid HWID.)
  if (shouldBypassPendingInput(text)) {
    clearPending(chatId);
  } else {
    // Multi-step pending (button → next message = raw HWID / count / query)
    const pending = takePending(chatId);
    if (pending?.mode === 'await_hwid') {
      const hwid = normalizeHwid(text) || tryBareFromPending(text);
      if (!hwid) {
        setPending(chatId, 'await_hwid');
        await replyToChat(
          chatId,
          'HWID không hợp lệ (cần ≥8 hex).\n' +
            'Gửi lại HWID, hoặc gõ /menu · /start để thoát.',
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
    if (pending?.mode === 'await_gencode_count') {
      const n = Number(String(text).trim());
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        setPending(chatId, 'await_gencode_count', { expKey: pending.expKey });
        await replyToChat(
          chatId,
          'Số lượng không hợp lệ. Gõ số 1–50, hoặc /menu để thoát.',
        );
        return;
      }
      const expKey = pending.expKey || 'lifetime';
      const resolved = resolveGencodeExpKey(expKey);
      await cmdGencode(Math.floor(n), resolved.expSeconds, chatId);
      return;
    }
    if (pending?.mode === 'await_lookup') {
      if (text.trim().length < 3) {
        setPending(chatId, 'await_lookup');
        await replyToChat(chatId, promptLookupText());
        return;
      }
      await cmdLookup(text.trim(), chatId);
      return;
    }
    if (pending?.mode === 'await_revoke') {
      if (text.trim().length < 6) {
        setPending(chatId, 'await_revoke');
        await replyToChat(chatId, promptRevokeText());
        return;
      }
      await cmdRevokePrompt(text.trim(), chatId);
      return;
    }
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
      case 'prompt_gencode':
        await replyToChat(
          chatId,
          promptGencodeText(),
          buildGencodePlanKeyboard(),
        );
        return;
      case 'gencode':
        await cmdGencode(parsed.count, parsed.expSeconds, chatId);
        return;
      case 'listcodes':
        await cmdListCodes(parsed.limit, chatId);
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

/**
 * Slash commands, menu buttons, and cancel words must escape pending wizards
 * (await_hwid / await_lookup / …). Otherwise /menu is misread as invalid HWID.
 */
export function shouldBypassPendingInput(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.startsWith('/')) return true;
  if (
    /^(hủy|huy|cancel|stop|thoát|thoat|menu|help|bỏ|bo)$/i.test(t)
  ) {
    return true;
  }
  const p = parseAdminCommand(t);
  if (!p) return false;
  // Pure HWID paste is intended pending input — do not bypass
  if (p.kind === 'bare_hwid') return false;
  if (p.kind === 'unknown') return false;
  // activate with HWID in same line is a full command, not pending fill-in
  return true;
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
