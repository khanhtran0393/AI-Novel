/**
 * Telegram seller bot — command parse + menus (pure helpers).
 *
 * UX (không cần gõ lệnh):
 *  - Nút Menu góc trái (setMyCommands) → danh sách /command
 *  - Reply keyboard dưới khung chat (luôn hiện)
 *  - Inline menu + wizard gói (callback)
 */

import type { PaidPlanId } from './pricingPlans';
import { PAID_PLANS, formatVnd } from './pricingPlans';

const PLAN_IDS = new Set<string>(PAID_PLANS.map((p) => p.id));

export type AdminPlanId = PaidPlanId;

/** Labels for persistent reply keyboard (exact match). */
export const REPLY_BTN = {
  activate: '🔑 Cấp key',
  lookup: '🔎 Tra cứu',
  list: '📋 List active',
  revoke: '🚫 Thu hồi',
  plans: '📦 Gói',
  status: '🩺 Status',
  menu: '❓ Menu',
} as const;

/** Bot API setMyCommands — hiện khi bấm nút Menu (góc trái khung nhập). */
export const BOT_MENU_COMMANDS: Array<{ command: string; description: string }> =
  [
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

export type ParsedAdminCommand =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'plans' }
  | { kind: 'menu' }
  | { kind: 'prompt_activate' }
  | { kind: 'prompt_lookup' }
  | { kind: 'prompt_revoke' }
  | { kind: 'activate'; hwid: string; planId?: PaidPlanId }
  | { kind: 'lookup'; q: string }
  | { kind: 'list'; status: 'active' | 'revoked' | 'all'; limit: number }
  | { kind: 'revoke'; target: string }
  | { kind: 'bare_hwid'; hwid: string }
  | { kind: 'unknown'; raw: string };

export type PendingMode = 'await_hwid' | 'await_lookup' | 'await_revoke';

/** Strip non-hex; return uppercase hex or null if too short. */
export function normalizeHwid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const hex = String(raw)
    .trim()
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (hex.length < 8) return null;
  return hex;
}

/**
 * True when the entire message is only a device id (hex + optional separators).
 */
export function tryParseBareHwid(text: string): string | null {
  const t = (text || '').trim();
  if (!t || t.startsWith('/')) return null;
  if (!/^[0-9a-fA-F:\-\s]+$/.test(t)) return null;
  return normalizeHwid(t);
}

export function parsePlanId(
  raw: string | undefined | null,
): PaidPlanId | undefined {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'month' || s === 'year' || s === 'lifetime') return s;
  if (s === 'm' || s === '1m' || s === 'thang') return 'month';
  if (s === 'y' || s === '1y' || s === 'nam') return 'year';
  if (s === 'life' || s === 'lt' || s === 'tron' || s === 'vĩnh') return 'lifetime';
  return undefined;
}

function stripBotCommand(cmd: string): string {
  const base = cmd.split('@')[0] || cmd;
  return base.toLowerCase();
}

/** Map reply-keyboard / common labels → command. */
function parseUiButton(raw: string): ParsedAdminCommand | null {
  const t = raw.trim();
  if (!t) return null;
  if (
    t === REPLY_BTN.activate ||
    t === 'Cấp key' ||
    t === '🔑 Cấp Key' ||
    /^🔑/.test(t)
  ) {
    return { kind: 'prompt_activate' };
  }
  if (t === REPLY_BTN.lookup || t === 'Tra cứu' || /^🔎/.test(t)) {
    return { kind: 'prompt_lookup' };
  }
  if (t === REPLY_BTN.list || t === 'List' || t === 'List active' || /^📋/.test(t)) {
    return { kind: 'list', status: 'active', limit: 10 };
  }
  if (t === REPLY_BTN.revoke || t === 'Thu hồi' || /^🚫/.test(t)) {
    return { kind: 'prompt_revoke' };
  }
  if (t === REPLY_BTN.plans || t === 'Gói' || /^📦/.test(t)) {
    return { kind: 'plans' };
  }
  if (t === REPLY_BTN.status || t === 'Status' || /^🩺/.test(t)) {
    return { kind: 'status' };
  }
  if (
    t === REPLY_BTN.menu ||
    t === 'Menu' ||
    t === '❓ Menu' ||
    /^❓/.test(t)
  ) {
    return { kind: 'menu' };
  }
  return null;
}

export function parseAdminCommand(text: string): ParsedAdminCommand | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  const ui = parseUiButton(raw);
  if (ui) return ui;

  const bare = tryParseBareHwid(raw);
  if (bare) return { kind: 'bare_hwid', hwid: bare };

  if (!raw.startsWith('/')) return null;

  const parts = raw.split(/\s+/).filter(Boolean);
  const cmd = stripBotCommand(parts[0] || '');

  if (cmd === '/start' || cmd === '/help') {
    return { kind: 'help' };
  }
  if (cmd === '/menu') {
    return { kind: 'menu' };
  }
  if (cmd === '/status' || cmd === '/ping') {
    return { kind: 'status' };
  }
  if (cmd === '/plans' || cmd === '/goi') {
    return { kind: 'plans' };
  }
  if (
    cmd === '/activate' ||
    cmd === '/gen' ||
    cmd === '/cap' ||
    cmd === '/issue'
  ) {
    const hwid = normalizeHwid(parts[1] || '');
    if (!hwid) {
      return { kind: 'prompt_activate' };
    }
    const planId = parsePlanId(parts[2]);
    return { kind: 'activate', hwid, planId };
  }
  if (cmd === '/lookup' || cmd === '/find' || cmd === '/search') {
    const q = (parts[1] || '').trim();
    if (!q || q.length < 3) return { kind: 'prompt_lookup' };
    return { kind: 'lookup', q };
  }
  if (cmd === '/list' || cmd === '/ls') {
    let status: 'active' | 'revoked' | 'all' = 'active';
    let limit = 10;
    for (const p of parts.slice(1)) {
      const low = p.toLowerCase();
      if (low === 'active' || low === 'revoked' || low === 'all') {
        status = low;
      } else if (/^\d+$/.test(p)) {
        limit = Math.min(15, Math.max(1, Number(p)));
      }
    }
    return { kind: 'list', status, limit };
  }
  if (cmd === '/revoke' || cmd === '/thuhoi') {
    const target = (parts[1] || '').trim();
    if (!target || target.length < 6) {
      return { kind: 'prompt_revoke' };
    }
    return { kind: 'revoke', target };
  }

  return { kind: 'unknown', raw: cmd };
}

export function buildHelpMessage(): string {
  return [
    '🤖 AI Novel — Bot seller',
    '',
    '👉 Bấm nút trong tin nhắn (bên dưới).',
    '👉 Menu (góc trái) · dán HWID → chọn gói → copy key gửi khách.',
    '',
    '🔔 Khách «Đã thanh toán» → ✅ Cấp Key / ❌ Từ chối.',
    '🔑 AINOVEL2.… + ledger Supabase (One-Path).',
  ].join('\n');
}

/** Ẩn reply keyboard dưới khung chat — chỉ dùng inline trong tin. */
export function buildRemoveReplyKeyboard(): { remove_keyboard: true } {
  return { remove_keyboard: true };
}

export function buildPlansMessage(): string {
  const lines = ['📦 Gói Pro (VND)', ''];
  for (const p of PAID_PLANS) {
    lines.push(
      `• ${p.label} (\`${p.id}\`) — ${formatVnd(p.priceVnd)}${p.highlight ? ' ⭐' : ''}`,
    );
  }
  lines.push('', 'Bấm «Cấp key» rồi dán HWID, hoặc dán HWID thuần.');
  return lines.join('\n');
}

export function buildPlanPickerText(hwid: string): string {
  return [
    '🖥 Mã thiết bị nhận được',
    `HWID: ${hwid.toUpperCase()}`,
    '',
    'Chọn gói để cấp key Pro:',
  ].join('\n');
}

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type ReplyKeyboard = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
};

/** @deprecated Không dùng — chỉ inline trong tin; giữ type cho parse UI cũ. */
export function buildReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [[{ text: REPLY_BTN.menu }]],
    resize_keyboard: true,
    is_persistent: false,
  };
}

/** Inline actions on /start (work even if reply keyboard hidden). */
export function buildMainInlineMenu(): InlineKeyboard {
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

export function buildPlanPickerKeyboard(hwid: string): InlineKeyboard {
  const id = hwid.toUpperCase();
  const row = PAID_PLANS.map((p) => ({
    text:
      p.id === 'lifetime' ? '⭐ Trọn đời' : p.id === 'year' ? '1 năm' : '1 tháng',
    callback_data: buildPickCallbackData(p.id, id),
  }));
  return {
    inline_keyboard: [
      row,
      [{ text: '❌ Huỷ', callback_data: 'pick_cancel' }],
    ],
  };
}

/** pick:<planId>:<hwid> — ≤64 bytes. */
export function buildPickCallbackData(planId: PaidPlanId, hwid: string): string {
  const plan = PLAN_IDS.has(planId) ? planId : 'lifetime';
  const id = (hwid || '').trim().toUpperCase();
  const data = `pick:${plan}:${id}`;
  if (data.length > 64) {
    return `pick:${plan}:${id.slice(0, 48)}`.slice(0, 64);
  }
  return data;
}

export function buildRevokeConfirmKeyboard(licenseId: string): InlineKeyboard {
  const data = `revoke_confirm:${licenseId}`.slice(0, 64);
  return {
    inline_keyboard: [
      [
        { text: '⚠️ Xác nhận thu hồi', callback_data: data },
        { text: 'Huỷ', callback_data: 'revoke_cancel' },
      ],
    ],
  };
}

export type LicenseRowSummary = {
  id: string;
  plan: string;
  status: string;
  hwid: string;
  exp_at?: string | null;
  created_at?: string | null;
};

export function formatLicenseRows(
  rows: LicenseRowSummary[],
  title: string,
  total?: number,
): string {
  if (!rows.length) {
    return `${title}\n(không có bản ghi)`;
  }
  const lines = [
    title,
    total != null
      ? `Tổng khớp: ${total} · hiển thị ${rows.length}`
      : `Hiển thị ${rows.length}`,
    '',
  ];
  for (const r of rows) {
    const exp = r.exp_at ? r.exp_at.slice(0, 10) : '?';
    const h = (r.hwid || '').toUpperCase();
    const shortId = r.id.length > 12 ? `${r.id.slice(0, 8)}…` : r.id;
    lines.push(
      `• ${r.status} | ${r.plan} | HWID ${h.slice(0, 16)}${h.length > 16 ? '…' : ''}`,
      `  id=${shortId} exp=${exp}`,
    );
  }
  return lines.join('\n');
}

export function syntaxHint(kind: string): string {
  switch (kind) {
    case 'activate_need_hwid':
      return 'Bấm «Cấp key» rồi dán HWID, hoặc dán HWID thuần.';
    case 'lookup_need_q':
      return 'Bấm «Tra cứu» rồi gửi HWID / prefix (≥3 ký tự).';
    case 'revoke_need_target':
      return 'Bấm «Thu hồi» rồi gửi licenseId hoặc HWID.';
    default:
      return `Lệnh không rõ: ${kind}\nBấm ❓ Menu hoặc /help.`;
  }
}

export function isPaidPlanId(s: string): s is PaidPlanId {
  return PLAN_IDS.has(s);
}

export function promptActivateText(): string {
  return [
    '🔑 Cấp key Pro',
    '',
    'Gửi mã thiết bị (HWID) của khách trong tin nhắn tiếp theo.',
    'Ví dụ: ABCDEF1234567890',
    '',
    'Hoặc dán HWID bất kỳ lúc nào — bot tự mở chọn gói.',
  ].join('\n');
}

export function promptLookupText(): string {
  return '🔎 Gửi HWID hoặc prefix (≥3 ký tự) để tra license.';
}

export function promptRevokeText(): string {
  return '🚫 Gửi licenseId (UUID) hoặc HWID active cần thu hồi.\nSẽ có nút xác nhận trước khi revoke.';
}
