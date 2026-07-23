/**
 * Empirical: payment-notify must deliver messageId to admin Telegram.
 * Also simulates customer deep-link path via direct Bot API parse test.
 * Usage: npx tsx scripts/probe-payment-notify-telegram.mts
 */
import fs from 'fs';
import path from 'path';

function loadEnvFile(file: string) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const LICENSE_API =
  process.env.AINOVEL_LICENSE_API_URL || 'https://ai-novel-flax.vercel.app';

async function main() {
  const token = (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.AINOVEL_TELEGRAM_CHAT_ID || '')
    .trim()
    .split(/[,;\s]+/)[0];
  if (!token || !chatId) {
    console.error('FAIL: missing TELEGRAM env');
    process.exit(1);
  }

  // 1) Direct Bot API
  const hwidDirect = `D${Date.now().toString(16).slice(-14).toUpperCase()}`;
  const directRes = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: [
          '🧪 PROBE direct — admin MUST see this',
          `HWID: ${hwidDirect}`,
          new Date().toISOString(),
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Cấp Key',
                callback_data: `issue:lifetime:${hwidDirect}`.slice(0, 64),
              },
              {
                text: '❌ Từ chối',
                callback_data: `reject:${hwidDirect}`.slice(0, 64),
              },
            ],
          ],
        },
      }),
    },
  );
  const directBody = (await directRes.json()) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  console.log(
    'direct',
    JSON.stringify({
      ok: directBody.ok,
      messageId: directBody.result?.message_id,
      err: directBody.description,
    }),
  );
  if (!directBody.ok || !directBody.result?.message_id) {
    console.error('FAIL: direct send — admin will never get payment tickets');
    process.exit(2);
  }

  // 2) Local Next payment-notify (dev path)
  const hwidLocal = `L${Date.now().toString(16).slice(-14).toUpperCase()}`;
  let local: { http: number; body: Record<string, unknown> } | null = null;
  try {
    const res = await fetch(`${BASE}/api/entitlement/payment-notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hwid: hwidLocal,
        planId: 'lifetime',
        note: 'probe local require messageId',
      }),
    });
    local = { http: res.status, body: (await res.json()) as Record<string, unknown> };
    console.log(
      'local',
      JSON.stringify({
        http: local.http,
        ok: local.body.ok,
        messageId: local.body.messageId,
        notified: local.body.notified,
        error: local.body.error,
      }),
    );
    if (local.http === 200 && local.body.ok && local.body.messageId == null) {
      console.error('FAIL: local ok without messageId (soft success)');
      process.exit(3);
    }
  } catch (e) {
    console.log('local_skip', e instanceof Error ? e.message : e);
  }

  // 3) Production license API (packaged customer proxy target)
  const hwidProd = `R${Date.now().toString(16).slice(-14).toUpperCase()}`;
  const prodRes = await fetch(
    `${LICENSE_API.replace(/\/$/, '')}/api/entitlement/payment-notify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hwid: hwidProd,
        planId: 'year',
        note: 'probe prod packaged path',
      }),
    },
  );
  const prodBody = (await prodRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  console.log(
    'prod',
    JSON.stringify({
      http: prodRes.status,
      ok: prodBody.ok,
      messageId: prodBody.messageId,
      error: prodBody.error,
    }),
  );
  if (prodRes.status >= 400 || !prodBody.ok || prodBody.messageId == null) {
    console.error(
      'FAIL_PROD: packaged customers cannot notify admin — deploy flax with TELEGRAM_* + messageId gate',
    );
    process.exit(4);
  }

  // 4) Source contracts
  const modal = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/features/license/LicenseModal.tsx'),
    'utf8',
  );
  if (!/typeof data\.messageId === 'number'/.test(modal)) {
    console.error('FAIL: UI must require messageId for success');
    process.exit(5);
  }
  if (/openTelegramBot\(data\.telegramUrl\)/.test(modal) && /toast\.success[\s\S]{0,200}openTelegram/.test(modal)) {
    console.error('FAIL: success path must not open empty bot');
    process.exit(6);
  }

  console.log(
    JSON.stringify({
      VERDICT: 'PASS',
      note: 'Check Telegram admin chat for direct + local + prod tickets with Cấp Key buttons',
      messageIds: {
        direct: directBody.result?.message_id,
        local: local?.body?.messageId ?? null,
        prod: prodBody.messageId,
      },
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
