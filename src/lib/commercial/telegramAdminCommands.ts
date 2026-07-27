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
import {
  formatExpSecondsLabel,
  parseDurationToExpSeconds,
} from './activationVault';

const PLAN_IDS = new Set<string>(PAID_PLANS.map((p) => p.id));

/** Default: 1 code, lifetime duration. */
export const GENCODE_DEFAULT_COUNT = 1;
export const GENCODE_DEFAULT_EXP =
  60 * 60 * 24 * 365 * 50; /* lifetime ~50y */
export const GENCODE_MAX_COUNT = 50;

/** Seller day-based Pro key durations (Cấp key + Tạo mã). */
export const DAY_KEY_PRESETS = [1, 3, 7, 15, 30] as const;
export type DayKeyPreset = (typeof DAY_KEY_PRESETS)[number];

export function isDayKeyExpKey(raw: string | undefined | null): boolean {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  return DAY_KEY_PRESETS.some((d) => t === `${d}d` || t === String(d));
}

export function normalizeExpKey(raw: string | undefined | null): string {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!t) return 'lifetime';
  if (PLAN_IDS.has(t)) return t;
  // bare day number → Nd
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (DAY_KEY_PRESETS.includes(n as DayKeyPreset)) return `${n}d`;
  }
  return t;
}

export type AdminPlanId = PaidPlanId;

/** Labels for persistent reply keyboard (exact match). */
export const REPLY_BTN = {
  activate: '🔑 Cấp key',
  gencode: '🎟 Tạo mã',
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
    { command: 'activate', description: 'Cấp key gắn HWID (dán HWID)' },
    {
      command: 'gencode',
      description: 'Tạo mã Pro AINOVEL-… (số lượng + thời hạn)',
    },
    { command: 'lookup', description: 'Tra license theo HWID' },
    { command: 'list', description: 'List license active' },
    { command: 'listcodes', description: 'List mã kích hoạt gần đây' },
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
  | { kind: 'prompt_gencode' }
  | { kind: 'prompt_lookup' }
  | { kind: 'prompt_revoke' }
  | { kind: 'activate'; hwid: string; planId?: PaidPlanId }
  | {
      kind: 'gencode';
      count: number;
      expSeconds: number;
      planId?: PaidPlanId;
    }
  | { kind: 'listcodes'; limit: number }
  | { kind: 'lookup'; q: string }
  | { kind: 'list'; status: 'active' | 'revoked' | 'all'; limit: number }
  | { kind: 'revoke'; target: string }
  | { kind: 'bare_hwid'; hwid: string }
  | { kind: 'unknown'; raw: string };

export type PendingMode =
  | 'await_hwid'
  | 'await_lookup'
  | 'await_revoke'
  | 'await_gencode_count';

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

/**
 * Parse `/gencode` args: count + duration.
 * - `5 year` · `3 month` · `10 90d` · `2 lifetime` · `5` (count only → lifetime)
 * - `year 5` also accepted (plan first)
 */
export function parseGencodeArgs(
  args: string[],
): Extract<ParsedAdminCommand, { kind: 'gencode' }> {
  let count = GENCODE_DEFAULT_COUNT;
  let expSeconds = GENCODE_DEFAULT_EXP;
  let planId: PaidPlanId | undefined;

  for (const raw of args) {
    const a = raw.trim();
    if (!a) continue;
    if (/^\d+$/.test(a)) {
      count = Math.min(GENCODE_MAX_COUNT, Math.max(1, Number(a)));
      continue;
    }
    const plan = parsePlanId(a);
    if (plan) {
      planId = plan;
      const p = PAID_PLANS.find((x) => x.id === plan);
      if (p) expSeconds = p.expSeconds;
      continue;
    }
    const dur = parseDurationToExpSeconds(a);
    if (dur != null) {
      expSeconds = dur;
    }
  }

  return { kind: 'gencode', count, expSeconds, planId };
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
  if (
    t === REPLY_BTN.gencode ||
    t === 'Tạo mã' ||
    t === '🎟 Tạo mã' ||
    /^🎟/.test(t)
  ) {
    return { kind: 'prompt_gencode' };
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
  // /gencode [count] [plan|30d|year] — unbound Pro codes (1 HWID each)
  if (
    cmd === '/gencode' ||
    cmd === '/makecode' ||
    cmd === '/codes' ||
    cmd === '/taoma'
  ) {
    if (parts.length === 1) {
      return { kind: 'prompt_gencode' };
    }
    return parseGencodeArgs(parts.slice(1));
  }
  if (cmd === '/listcodes' || cmd === '/lscodes' || cmd === '/codeslist') {
    let limit = 15;
    for (const p of parts.slice(1)) {
      if (/^\d+$/.test(p)) limit = Math.min(50, Math.max(1, Number(p)));
    }
    return { kind: 'listcodes', limit };
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
    '👉 Menu (góc trái) · dán HWID → chọn gói → copy key AINOVEL2 gửi khách.',
    '',
    '🎟 Tạo mã Pro (AINOVEL-…): bất kỳ HWID nào nhập được, mỗi mã chỉ 1 máy.',
    '   /gencode 5 year   ·  /gencode 3 30d   ·  /gencode 10 lifetime',
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
    'Chọn thời hạn key Pro:',
    '• Theo ngày: 3 · 7 · 15 · 30 ngày',
    '• Theo gói: 1 tháng · 1 năm · trọn đời',
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
        { text: '🎟 Tạo mã', callback_data: 'menu:gencode' },
      ],
      [
        { text: '🔎 Tra cứu', callback_data: 'menu:lookup' },
        { text: '📋 List', callback_data: 'menu:list' },
      ],
      [
        { text: '🚫 Thu hồi', callback_data: 'menu:revoke' },
        { text: '📦 Gói', callback_data: 'menu:plans' },
      ],
      [
        { text: '🩺 Status', callback_data: 'menu:status' },
        { text: '❓ Help', callback_data: 'menu:help' },
      ],
    ],
  };
}

/** Wizard: pick plan duration then ask count (or use /gencode N plan). */
export function buildGencodePlanKeyboard(): InlineKeyboard {
  const row1 = [1, 3, 7].map((d) => ({
    text: `${d} ngày`,
    callback_data: `gencode_plan:${d}d`,
  }));
  const row2 = [15, 30].map((d) => ({
    text: `${d} ngày`,
    callback_data: `gencode_plan:${d}d`,
  }));
  return {
    inline_keyboard: [
      row1,
      row2,
      [
        { text: '1 tháng', callback_data: 'gencode_plan:month' },
        { text: '1 năm', callback_data: 'gencode_plan:year' },
        { text: '⭐ Trọn đời', callback_data: 'gencode_plan:lifetime' },
      ],
      [{ text: '❌ Huỷ', callback_data: 'gencode_cancel' }],
    ],
  };
}

export function buildGencodeCountKeyboard(expKey: string): InlineKeyboard {
  const key = expKey.slice(0, 20);
  const mk = (n: number) => ({
    text: `${n} mã`,
    callback_data: `gencode_do:${n}:${key}`.slice(0, 64),
  });
  return {
    inline_keyboard: [
      [mk(1), mk(3), mk(5), mk(10)],
      [mk(20), mk(50)],
      [{ text: '❌ Huỷ', callback_data: 'gencode_cancel' }],
    ],
  };
}

export function resolveGencodeExpKey(
  key: string,
): { expSeconds: number; label: string; planId?: PaidPlanId; expKey: string } {
  const expKey = normalizeExpKey(key);
  const plan = parsePlanId(expKey);
  if (plan) {
    const p = PAID_PLANS.find((x) => x.id === plan)!;
    return {
      expSeconds: p.expSeconds,
      label: p.label,
      planId: plan,
      expKey: plan,
    };
  }
  const dur = parseDurationToExpSeconds(expKey);
  if (dur != null) {
    return {
      expSeconds: dur,
      label: formatExpSecondsLabel(dur),
      expKey,
    };
  }
  return {
    expSeconds: GENCODE_DEFAULT_EXP,
    label: formatExpSecondsLabel(GENCODE_DEFAULT_EXP),
    planId: 'lifetime',
    expKey: 'lifetime',
  };
}

export type GencodeCodeRow = {
  code: string;
  expSeconds: number;
  expLabel: string;
  licenseId?: string;
  ledgerOk: boolean;
  ledgerError?: string;
};

/**
 * Build Telegram messages for handoff:
 * 1) header (tóm tắt)
 * 2) each code = **one message, one line** → long-press / forward dễ copy
 * 3) optional bulk block (copy cả lô)
 * 4) footer hướng dẫn khách
 */
export function buildGencodeDeliveryMessages(input: {
  codes: GencodeCodeRow[];
  expLabel: string;
  ledgerConfigured: boolean;
}): string[] {
  const okCodes = input.codes.filter((c) => c.ledgerOk !== false || !input.ledgerConfigured);
  // Prefer ledger-ok when ledger is on; still list failed separately
  const good = input.ledgerConfigured
    ? input.codes.filter((c) => c.ledgerOk)
    : input.codes;
  const bad = input.ledgerConfigured
    ? input.codes.filter((c) => !c.ledgerOk)
    : [];

  const header = [
    '🎟 Mã Pro đã tạo — sẵn sàng giao khách',
    `⏱ Thời hạn: ${input.expLabel}`,
    `📦 Số mã: ${good.length}${bad.length ? ` · ⚠️ lỗi ${bad.length}` : ''}`,
    '📌 Mỗi mã = 1 máy · bất kỳ HWID',
    '',
    '⬇️ Mỗi tin sau = 1 mã (giữ / copy / chuyển tiếp cho khách).',
  ].join('\n');

  const messages: string[] = [header];

  // One code per message — plain text, no id/noise (mobile copy-friendly)
  for (const c of good) {
    messages.push(String(c.code || '').trim());
  }

  // Bulk block for multi-select / paste into sheet
  if (good.length > 1) {
    messages.push(
      [
        '📋 Copy cả lô (mỗi dòng 1 mã):',
        good.map((c) => c.code).join('\n'),
      ].join('\n'),
    );
  }

  if (bad.length) {
    messages.push(
      [
        '⚠️ Mã tạo local nhưng ledger lỗi (đừng giao khách):',
        ...bad.map(
          (c) =>
            `${c.code} — ${c.ledgerError || 'ledger fail'}`,
        ),
      ].join('\n'),
    );
  } else if (!input.ledgerConfigured) {
    messages.push(
      '⚠️ Supabase chưa cấu hình — mã chỉ vault local (dev). Packaged cần ledger.',
    );
  }

  messages.push(
    [
      'Khách dán mã:',
      'Logo → Bản quyền → dán AINOVEL-… → Kích hoạt',
      '(Không phải key AINOVEL2.)',
    ].join('\n'),
  );

  return messages.filter((m) => m && m.trim());
}

/** Single-blob fallback (tests / short). Prefer buildGencodeDeliveryMessages. */
export function formatGencodeResultMessage(input: {
  codes: GencodeCodeRow[];
  expLabel: string;
  ledgerConfigured: boolean;
}): string {
  return buildGencodeDeliveryMessages(input).join('\n\n———\n\n');
}

export function buildPlanPickerKeyboard(hwid: string): InlineKeyboard {
  const id = hwid.toUpperCase();
  const dayRow = DAY_KEY_PRESETS.map((d) => ({
    text: `${d} ngày`,
    callback_data: buildPickCallbackData(`${d}d`, id),
  }));
  const planRow = PAID_PLANS.map((p) => ({
    text:
      p.id === 'lifetime' ? '⭐ Trọn đời' : p.id === 'year' ? '1 năm' : '1 tháng',
    callback_data: buildPickCallbackData(p.id, id),
  }));
  return {
    inline_keyboard: [
      dayRow,
      planRow,
      [{ text: '❌ Huỷ', callback_data: 'pick_cancel' }],
    ],
  };
}

/**
 * pick:<expKey>:<hwid> — expKey = month|year|lifetime|3d|7d|15d|30d
 * Telegram callback_data ≤64 bytes.
 */
export function buildPickCallbackData(
  expKey: string | PaidPlanId,
  hwid: string,
): string {
  const key = normalizeExpKey(String(expKey || 'lifetime'));
  const id = (hwid || '').trim().toUpperCase();
  const data = `pick:${key}:${id}`;
  if (data.length > 64) {
    return `pick:${key}:${id.slice(0, 48)}`.slice(0, 64);
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
    '',
    'Muốn mã tự do (không cần HWID trước)? Bấm «🎟 Tạo mã» hoặc /gencode.',
  ].join('\n');
}

export function promptGencodeText(): string {
  return [
    '🎟 Tạo mã Pro (AINOVEL-…)',
    '',
    '• Bất kỳ máy nào dán mã được (không cần HWID trước).',
    '• Mỗi mã chỉ gắn 1 HWID (máy đầu tiên nhập).',
    '• Máy khác nhập cùng mã → thông báo đã được nhập.',
    '',
    'Chọn thời hạn bên dưới, rồi chọn số lượng.',
    'Hoặc gõ: /gencode 5 year   ·  /gencode 3 90d',
  ].join('\n');
}

export function promptGencodeCountText(expLabel: string): string {
  return [
    `🎟 Thời hạn: ${expLabel}`,
    '',
    'Chọn số lượng mã, hoặc gõ số (1–50) trong tin nhắn tiếp theo.',
  ].join('\n');
}

export function promptLookupText(): string {
  return '🔎 Gửi HWID hoặc prefix (≥3 ký tự) để tra license.';
}

export function promptRevokeText(): string {
  return '🚫 Gửi licenseId (UUID) hoặc HWID active cần thu hồi.\nSẽ có nút xác nhận trước khi revoke.';
}

export function formatActivationCodeRows(
  rows: Array<{
    code: string;
    redeemedHwid?: string;
    seats?: string[];
    expSeconds: number;
    createdAt: number;
  }>,
  title: string,
): string {
  if (!rows.length) return `${title}\n(không có mã)`;
  const lines = [title, `Hiển thị ${rows.length}`, ''];
  for (const r of rows) {
    const seats = r.seats?.length
      ? r.seats
      : r.redeemedHwid
        ? [r.redeemedHwid]
        : [];
    const status =
      seats.length > 0
        ? `đã gắn ${seats[0]!.toUpperCase().slice(0, 12)}…`
        : 'chưa dùng';
    const when = new Date(r.createdAt * 1000).toISOString().slice(0, 10);
    lines.push(
      `• ${r.code}`,
      `  ${status} · ${formatExpSecondsLabel(r.expSeconds)} · tạo ${when}`,
    );
  }
  return lines.join('\n');
}
