/**
 * Exhaustive Telegram button matrix smoke (no live bot required).
 *
 * 1) Every inline callback_data ≤64 bytes + parses
 * 2) Every reply-keyboard label → command
 * 3) Every setMyCommands /slash parses
 * 4) handleCallbackQuery answers spinner for every button (mocked fetch)
 * 5) gencode wizard: plan → count keyboard stays on edit
 *
 * Run: npx tsx scripts/smoke-telegram-buttons.mts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  BOT_MENU_COMMANDS,
  REPLY_BTN,
  buildGencodeCountKeyboard,
  buildGencodePlanKeyboard,
  buildMainInlineMenu,
  buildPlanPickerKeyboard,
  buildRevokeConfirmKeyboard,
  parseAdminCommand,
  resolveGencodeExpKey,
} from '../src/lib/commercial/telegramAdminCommands.ts';
import {
  buildIssueCallbackData,
  buildRejectCallbackData,
  parseTelegramCallbackData,
  type TelegramCallbackAction,
} from '../src/lib/commercial/telegramNotify.ts';
import {
  handleCallbackQuery,
  shouldBypassPendingInput,
} from '../src/lib/commercial/telegramWebhookHandler.ts';

function ok(label: string) {
  console.log(`  OK  ${label}`);
}

type InlineBtn = { text: string; callback_data: string };

function collectCallbacks(
  kb: { inline_keyboard: InlineBtn[][] },
  bag: Map<string, string>,
) {
  for (const row of kb.inline_keyboard) {
    for (const b of row) {
      bag.set(b.callback_data, b.text);
      assert.ok(
        Buffer.byteLength(b.callback_data, 'utf8') <= 64,
        `callback >64 bytes: ${b.callback_data}`,
      );
    }
  }
}

/** Actions the handler must cover (sync with handleCallbackQuery). */
function assertHandlerCovered(parsed: TelegramCallbackAction): string {
  switch (parsed.action) {
    case 'menu':
      return `menu:${parsed.item}`;
    case 'gencode_plan':
      return `gencode_plan:${parsed.expKey}`;
    case 'gencode_do':
      return `gencode_do:${parsed.count}:${parsed.expKey}`;
    case 'gencode_cancel':
      return 'gencode_cancel';
    case 'pick':
      return `pick:${parsed.planId}`;
    case 'issue':
      return `issue:${parsed.planId}`;
    case 'reject':
      return 'reject';
    case 'pick_cancel':
      return 'pick_cancel';
    case 'revoke_confirm':
      return 'revoke_confirm';
    case 'revoke_cancel':
      return 'revoke_cancel';
    default: {
      const _x: never = parsed;
      throw new Error(`unhandled action in smoke: ${JSON.stringify(_x)}`);
    }
  }
}

// ── 1) Collect all keyboards ──────────────────────────────────────────
const all = new Map<string, string>();
collectCallbacks(buildMainInlineMenu(), all);
collectCallbacks(buildGencodePlanKeyboard(), all);
for (const exp of ['month', 'year', 'lifetime', '30d', '90d']) {
  collectCallbacks(buildGencodeCountKeyboard(exp), all);
}
collectCallbacks(buildPlanPickerKeyboard('ABCDEF1234567890'), all);
collectCallbacks(
  buildRevokeConfirmKeyboard('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  all,
);
// payment approve/reject
all.set(
  buildIssueCallbackData('lifetime', 'ABCDEF1234567890'),
  '✅ Cấp Key',
);
all.set(buildRejectCallbackData('ABCDEF1234567890'), '❌ Từ chối');

assert.ok(all.size >= 20, `expected many buttons, got ${all.size}`);
ok(`collected ${all.size} unique callback_data`);

// ── 2) Parse + handler coverage ───────────────────────────────────────
for (const [data, label] of all) {
  const parsed = parseTelegramCallbackData(data);
  assert.ok(parsed, `parse failed for [${label}] data=${data}`);
  assertHandlerCovered(parsed!);
}
ok('all callbacks parse + handler-covered');

// gencode exp keys resolve
for (const k of ['month', 'year', 'lifetime', '30d', '90d']) {
  const r = resolveGencodeExpKey(k);
  assert.ok(r.expSeconds > 0, k);
  assert.ok(r.label.length > 0, k);
}
ok('resolveGencodeExpKey');

// ── 3) Reply keyboard labels ──────────────────────────────────────────
const replyExpect: Array<[string, string]> = [
  [REPLY_BTN.activate, 'prompt_activate'],
  [REPLY_BTN.gencode, 'prompt_gencode'],
  [REPLY_BTN.lookup, 'prompt_lookup'],
  [REPLY_BTN.list, 'list'],
  [REPLY_BTN.revoke, 'prompt_revoke'],
  [REPLY_BTN.plans, 'plans'],
  [REPLY_BTN.status, 'status'],
  [REPLY_BTN.menu, 'menu'],
];
for (const [label, kind] of replyExpect) {
  const p = parseAdminCommand(label);
  assert.equal(p?.kind, kind, `reply btn «${label}» → ${kind}, got ${p?.kind}`);
}
ok('reply keyboard labels');

// ── 4) Menu slash commands ────────────────────────────────────────────
for (const c of BOT_MENU_COMMANDS) {
  const p = parseAdminCommand(`/${c.command}`);
  assert.ok(p, `/${c.command} must parse`);
  assert.notEqual(p!.kind, 'unknown', `/${c.command} must not be unknown`);
}
ok(`BOT_MENU_COMMANDS (${BOT_MENU_COMMANDS.length})`);

// ── 5) Mock fetch + fire every callback through handleCallbackQuery ───
const keys = crypto.generateKeyPairSync('ed25519');
process.env.AINOVEL_TELEGRAM_BOT_TOKEN = '123456:TEST_SMOKE_TOKEN';
process.env.AINOVEL_TELEGRAM_CHAT_ID = '424242';
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = keys.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
// Force no Supabase so list/revoke/gencode stay offline-safe
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

type TgCall = { method: string; body: Record<string, unknown> };
const calls: TgCall[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
  const method = m?.[1] || 'unknown';
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  calls.push({ method, body });
  // Simulate Telegram success
  return new Response(
    JSON.stringify({ ok: true, result: { message_id: 99 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof fetch;

try {
  let n = 0;
  for (const [data, label] of all) {
    calls.length = 0;
    const cqId = `cq_${n++}_${data.slice(0, 12)}`;
    await handleCallbackQuery({
      id: cqId,
      data,
      message: {
        message_id: 77,
        text: `fixture for ${label}`,
        chat: { id: 424242 },
      },
      from: { id: 424242, username: 'seller' },
    });

    const answered = calls.some(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        c.body.callback_query_id === cqId,
    );
    assert.ok(
      answered,
      `NO answerCallbackQuery for [${label}] data=${data}\ncalls=${JSON.stringify(calls.map((c) => c.method))}`,
    );

    // Side-effect sanity: menu/gencode should sendMessage or editMessageText
    const parsed = parseTelegramCallbackData(data)!;
    if (parsed.action === 'menu' && parsed.item === 'gencode') {
      const sent = calls.some(
        (c) =>
          c.method === 'sendMessage' &&
          JSON.stringify(c.body.reply_markup || '').includes('gencode_plan:'),
      );
      assert.ok(sent, 'menu:gencode must send plan keyboard');
    }
    if (parsed.action === 'gencode_plan') {
      const edited = calls.find((c) => c.method === 'editMessageText');
      assert.ok(edited, 'gencode_plan must editMessageText');
      const markup = JSON.stringify(edited!.body.reply_markup || '');
      assert.ok(
        markup.includes('gencode_do:'),
        `gencode_plan edit must include count keyboard, got ${markup.slice(0, 200)}`,
      );
    }
    if (parsed.action === 'gencode_do') {
      // Without Supabase: still sends a result or error message (not silent)
      const msg = calls.some((c) => c.method === 'sendMessage');
      assert.ok(msg, 'gencode_do must sendMessage (codes or error)');
    }
    if (parsed.action === 'menu' && parsed.item === 'activate') {
      const msg = calls.some(
        (c) =>
          c.method === 'sendMessage' &&
          String(c.body.text || '').includes('HWID'),
      );
      assert.ok(msg, 'menu:activate must prompt HWID');
    }
  }
  ok(`handleCallbackQuery answered spinner for ${all.size} buttons`);
} finally {
  globalThis.fetch = realFetch;
}

// ── 6) Non-admin button must answer with alert (not silent) ───────────
process.env.AINOVEL_TELEGRAM_CHAT_ID = '999999'; // different admin set
calls.length = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
  const method = m?.[1] || 'unknown';
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  calls.push({ method, body });
  return new Response(JSON.stringify({ ok: true, result: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

try {
  await handleCallbackQuery({
    id: 'cq_stranger',
    data: 'menu:gencode',
    message: { message_id: 1, chat: { id: 111 } },
    from: { id: 111 },
  });
  const denied = calls.find((c) => c.method === 'answerCallbackQuery');
  assert.ok(denied, 'non-admin must get answerCallbackQuery');
  assert.equal(denied!.body.show_alert, true);
  assert.match(String(denied!.body.text || ''), /không được phép|CHAT_ID/i);
  ok('non-admin button → alert (not silent drop)');
} finally {
  globalThis.fetch = realFetch;
}

// ── 7) Stuck await_hwid must NOT eat /menu /start /activate ───────────
assert.equal(shouldBypassPendingInput('/menu'), true);
assert.equal(shouldBypassPendingInput('/start'), true);
assert.equal(shouldBypassPendingInput('/activate'), true);
assert.equal(shouldBypassPendingInput('/lookup'), true);
assert.equal(shouldBypassPendingInput(REPLY_BTN.menu), true);
assert.equal(shouldBypassPendingInput(REPLY_BTN.gencode), true);
assert.equal(shouldBypassPendingInput('hủy'), true);
// Real HWID paste stays as pending input
assert.equal(shouldBypassPendingInput('ABCDEF1234567890'), false);
assert.equal(shouldBypassPendingInput('ab-cd-ef-12-34-56-78-90'), false);
ok('pending bypass: commands escape HWID wizard');

// Integration: after await_hwid set, /menu opens help not «HWID không hợp lệ»
process.env.AINOVEL_TELEGRAM_CHAT_ID = '424242';
process.env.AINOVEL_TELEGRAM_BOT_TOKEN = '123456:TEST_SMOKE_TOKEN';
const pendingCalls: TgCall[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
  const method = m?.[1] || 'unknown';
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  pendingCalls.push({ method, body });
  return new Response(
    JSON.stringify({ ok: true, result: { message_id: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof fetch;

try {
  const { handleAdminMessage } = await import(
    '../src/lib/commercial/telegramWebhookHandler.ts'
  );
  // Enter await_hwid
  await handleAdminMessage({
    text: '/activate',
    chat: { id: 424242 },
    from: { id: 424242 },
  });
  pendingCalls.length = 0;
  // Escape with /menu
  await handleAdminMessage({
    text: '/menu',
    chat: { id: 424242 },
    from: { id: 424242 },
  });
  const texts = pendingCalls
    .filter((c) => c.method === 'sendMessage')
    .map((c) => String(c.body.text || ''));
  assert.ok(
    texts.some((t) => /Bot seller|Menu|nút|Gói|Tạo mã|Cấp key/i.test(t)),
    `expected menu help, got: ${JSON.stringify(texts)}`,
  );
  assert.ok(
    !texts.some((t) => /HWID không hợp lệ/i.test(t)),
    `must not say invalid HWID on /menu: ${JSON.stringify(texts)}`,
  );
  ok('/menu escapes stuck await_hwid (no false HWID error)');
} finally {
  globalThis.fetch = realFetch;
}

console.log('\n[smoke-telegram-buttons] PASS');
console.log(
  JSON.stringify({
    buttons: all.size,
    menuCommands: BOT_MENU_COMMANDS.length,
    replyBtns: Object.keys(REPLY_BTN).length,
  }),
);
