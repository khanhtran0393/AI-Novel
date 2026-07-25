/**
 * Empirical: stuck await_hwid must never answer «HWID không hợp lệ» for /menu|/start|/activate…
 * Covers app handler + bridge processUpdate (mocked Telegram fetch).
 *
 * Run: npx tsx scripts/smoke-telegram-pending-escape.mts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function ok(label: string) {
  console.log(`  OK  ${label}`);
}

type TgCall = { method: string; body: Record<string, unknown> };

function installFetchMock(bag: TgCall[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // Telegram Bot API
    const m = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
    if (m) {
      let body: Record<string, unknown> = {};
      try {
        body = init?.body ? JSON.parse(String(init.body)) : {};
      } catch {
        body = {};
      }
      bag.push({ method: m[1]!, body });
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 1 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // Supabase REST — fail closed offline
    if (url.includes('supabase') || url.includes('/rest/v1/')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

function sendTexts(bag: TgCall[]): string[] {
  return bag
    .filter((c) => c.method === 'sendMessage')
    .map((c) => String(c.body.text || ''));
}

function assertNoFalseHwid(texts: string[], ctx: string) {
  const bad = texts.filter((t) => /HWID không hợp lệ/i.test(t));
  assert.equal(
    bad.length,
    0,
    `${ctx}: must not say invalid HWID, got:\n${bad.join('\n---\n')}`,
  );
}

// ── Env for signing + admin gate ──────────────────────────────────────
const keys = crypto.generateKeyPairSync('ed25519');
process.env.AINOVEL_TELEGRAM_BOT_TOKEN = '999:SMOKE_PENDING_ESCAPE';
process.env.AINOVEL_TELEGRAM_CHAT_ID = '555001';
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY = keys.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
process.env.AINOVEL_ENTITLEMENT_PUBLIC_KEY = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY_B64 = Buffer.from(
  process.env.AINOVEL_ENTITLEMENT_PRIVATE_KEY,
  'utf8',
).toString('base64');
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── APP handler ───────────────────────────────────────────────────────
{
  const bag: TgCall[] = [];
  const restore = installFetchMock(bag);
  try {
    const {
      handleAdminMessage,
      shouldBypassPendingInput,
    } = await import('../src/lib/commercial/telegramWebhookHandler.ts');

    const cmds = [
      '/menu',
      '/start',
      '/activate',
      '/lookup',
      '/status',
      '/plans',
      '/help',
      '/gencode',
    ];
    for (const c of cmds) {
      assert.equal(shouldBypassPendingInput(c), true, c);
    }
    assert.equal(shouldBypassPendingInput('ABCDEF1234567890'), false);

    // Enter stuck state
    await handleAdminMessage({
      text: '/activate',
      chat: { id: 555001 },
      from: { id: 555001 },
    });
    for (const cmd of cmds) {
      bag.length = 0;
      await handleAdminMessage({
        text: cmd,
        chat: { id: 555001 },
        from: { id: 555001 },
      });
      const texts = sendTexts(bag);
      assertNoFalseHwid(texts, `app ${cmd}`);
      assert.ok(
        texts.length > 0 || bag.some((c) => c.method === 'sendMessage'),
        `app ${cmd}: expected bot reply`,
      );
    }
    // Real HWID after activate still works
    bag.length = 0;
    await handleAdminMessage({
      text: '/activate',
      chat: { id: 555001 },
      from: { id: 555001 },
    });
    bag.length = 0;
    await handleAdminMessage({
      text: 'F925B0FF900599A0',
      chat: { id: 555001 },
      from: { id: 555001 },
    });
    const afterHwid = sendTexts(bag).join('\n');
    assert.match(afterHwid, /HWID|gói|Chọn/i, afterHwid);
    assertNoFalseHwid(sendTexts(bag), 'app real hwid');
    ok('APP: stuck await_hwid escaped by all slash commands');
  } finally {
    restore();
  }
}

// ── BRIDGE processUpdate (live production path) ───────────────────────
{
  const bag: TgCall[] = [];
  const restore = installFetchMock(bag);
  try {
    // Load bridge as CJS/TS via dynamic import of source through tsx
    const bridgePath = path.join(root, 'deploy/telegram-bridge/lib/bridge.ts');
    const bridge = await import(pathToFileUrl(bridgePath));
    const processUpdate = bridge.processUpdate as (u: unknown) => Promise<void>;
    assert.equal(typeof processUpdate, 'function');

    const adminMsg = (text: string) => ({
      message: {
        text,
        chat: { id: 555001 },
        from: { id: 555001, username: 'seller' },
      },
    });

    // Enter await_hwid via /activate
    await processUpdate(adminMsg('/activate'));
    const escapeCmds = [
      '/menu',
      '/start',
      '/activate',
      '/lookup',
      '/status',
      '/plans',
      '/help',
      '/gencode',
      '/list',
    ];
    for (const cmd of escapeCmds) {
      bag.length = 0;
      await processUpdate(adminMsg(cmd));
      const texts = sendTexts(bag);
      assertNoFalseHwid(texts, `bridge ${cmd}`);
      assert.ok(texts.length > 0, `bridge ${cmd}: expected reply, got ${JSON.stringify(bag.map((b) => b.method))}`);
    }

    // Still accept real HWID
    bag.length = 0;
    await processUpdate(adminMsg('/activate'));
    bag.length = 0;
    await processUpdate(adminMsg('F925B0FF900599A0'));
    const t = sendTexts(bag).join('\n');
    assert.match(t, /HWID|gói|Chọn|tháng|năm|đời/i, t);
    assertNoFalseHwid(sendTexts(bag), 'bridge real hwid');

    // Inline menu:gencode after stuck state
    bag.length = 0;
    await processUpdate(adminMsg('/activate'));
    bag.length = 0;
    await processUpdate({
      callback_query: {
        id: 'cq1',
        data: 'menu:gencode',
        message: {
          message_id: 10,
          text: 'menu',
          chat: { id: 555001 },
        },
        from: { id: 555001 },
      },
    });
    assert.ok(
      bag.some((c) => c.method === 'answerCallbackQuery'),
      'callback answered',
    );
    const gencodeText = sendTexts(bag).join('\n');
    assert.match(gencodeText, /Tạo mã|AINOVEL|thời hạn/i, gencodeText);

    ok('BRIDGE: stuck await_hwid escaped + menu:gencode works');
  } finally {
    restore();
  }
}

function pathToFileUrl(p: string): string {
  const resolved = path.resolve(p);
  let u = resolved.replace(/\\/g, '/');
  if (!u.startsWith('/')) u = '/' + u; // Windows drive
  // file:///D:/...
  if (/^[A-Za-z]:\//.test(u.replace(/^\//, ''))) {
    return 'file:///' + u.replace(/^\//, '');
  }
  return 'file://' + u;
}

console.log('\n[smoke-telegram-pending-escape] PASS');
