/**
 * Live probe: deployed bridge health + sequential /activate → /menu (no false HWID).
 * Does not print secrets. Sends real Telegram messages to admin chat.
 *
 * Run: npx tsx scripts/probe-telegram-bridge-live.mts
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE =
  process.env.AINOVEL_TG_BRIDGE_URL ||
  'https://ainovel-telegram-bridge.vercel.app';

function loadEnvFile(name: string): Record<string, string> {
  const p = path.join(process.cwd(), name);
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v) out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = {
  ...process.env,
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
} as Record<string, string>;

const token = (env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
const chatRaw = (env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
const chat = chatRaw.split(/[,;\s]+/).filter(Boolean)[0] || '';
const secret = (env.AINOVEL_TELEGRAM_WEBHOOK_SECRET || '').trim();

if (!token || !chat) {
  console.error('FAIL: missing AINOVEL_TELEGRAM_BOT_TOKEN or CHAT_ID in .env*');
  process.exit(1);
}

function ok(label: string) {
  console.log(`  OK  ${label}`);
}

async function tg(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: {
      message_id?: number;
      text?: string;
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
    };
  };
}

async function postWebhook(update: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
  const res = await fetch(`${BASE}/api/entitlement/telegram-webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  return { status: res.status, j };
}

const chatIdNum = Number(chat);
const chatId = Number.isFinite(chatIdNum) ? chatIdNum : chat;

let updateId = Math.floor(Date.now() / 1000);
function msgUpdate(text: string) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId % 1_000_000,
      text,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: {
        id: chatId,
        is_bot: false,
        first_name: 'LiveProbe',
      },
    },
  };
}

// 1) Health
{
  const res = await fetch(`${BASE}/api/entitlement/telegram-webhook`, {
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as {
    ok?: boolean;
    configured?: boolean;
    supabaseLedger?: boolean;
  };
  assert(res.status === 200 && j.ok && j.configured, `health ${res.status} ${JSON.stringify(j)}`);
  ok(`health configured supabaseLedger=${j.supabaseLedger}`);
}

// 2) Webhook info
{
  const wh = await tg('getWebhookInfo');
  assert(wh.ok, wh.description || 'getWebhookInfo fail');
  const url = wh.result?.url || '';
  assert(
    url.includes('ainovel-telegram-bridge') || url.includes('/telegram-webhook'),
    `unexpected webhook url: ${url}`,
  );
  ok(`webhook ${url} pending=${wh.result?.pending_update_count ?? '?'}`);
  if (wh.result?.last_error_message) {
    console.log(`  note last_error: ${wh.result.last_error_message}`);
  }
}

// 3) Enter await_hwid then escape with commands (webhook path = production)
const escapeCmds = ['/menu', '/start', '/lookup', '/status', '/gencode', '/plans'];
{
  const a = await postWebhook(msgUpdate('/activate'));
  assert(a.status === 200 && a.j.ok === true, `activate ${JSON.stringify(a)}`);
  ok('POST /activate → ok');

  for (const cmd of escapeCmds) {
    const r = await postWebhook(msgUpdate(cmd));
    assert(
      r.status === 200 && r.j.ok === true,
      `${cmd} → ${r.status} ${JSON.stringify(r.j)}`,
    );
    ok(`POST ${cmd} → ok (no 5xx)`);
  }
}

// 4) Confirm bot can send (getMe)
{
  const me = await tg('getMe');
  assert(me.ok, me.description || 'getMe fail');
  ok(`getMe bot ok`);
}

// 5) Callback menu:gencode
{
  updateId += 1;
  const r = await postWebhook({
    update_id: updateId,
    callback_query: {
      id: `probe_${Date.now()}`,
      data: 'menu:gencode',
      from: { id: chatId, is_bot: false, first_name: 'LiveProbe' },
      message: {
        message_id: 1,
        text: 'menu',
        chat: { id: chatId, type: 'private' },
      },
    },
  });
  assert(r.status === 200 && r.j.ok === true, `callback ${JSON.stringify(r)}`);
  ok('POST callback menu:gencode → ok');
}

console.log('\n[probe-telegram-bridge-live] PASS');
console.log(
  JSON.stringify({
    base: BASE,
    chatConfigured: true,
    at: new Date().toISOString(),
  }),
);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}
