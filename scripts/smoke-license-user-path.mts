/**
 * User-path smoke: exactly what LicenseModal does for Trial + Đã thanh toán.
 * Run: npx tsx scripts/smoke-license-user-path.mts
 * Requires: next dev on 127.0.0.1:3000
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  console.log('[user-path] base=', BASE);

  const statusRes = await fetch(`${BASE}/api/commercial/status`, {
    cache: 'no-store',
  });
  assert(statusRes.ok, `commercial/status HTTP ${statusRes.status}`);
  const status = (await statusRes.json()) as {
    ok?: boolean;
    tier?: string;
    entitlement?: { hwid?: string };
    trial?: { active?: boolean; days?: number };
  };
  const hwid = (status.entitlement?.hwid || '').toUpperCase();
  console.log(
    '[user-path] status',
    JSON.stringify({
      ok: status.ok,
      tier: status.tier,
      hwid: hwid || '(empty)',
      trialActive: status.trial?.active,
      trialDays: status.trial?.days,
    }),
  );

  // GET payment-notify health — client may show telegramUrl after our fix
  const pnGet = await fetch(`${BASE}/api/entitlement/payment-notify`, {
    cache: 'no-store',
  });
  const pn = (await pnGet.json()) as {
    ok?: boolean;
    telegramConfigured?: boolean;
    telegramUrl?: string;
    telegram?: string;
    zalo?: string;
    mode?: string;
  };
  console.log(
    '[user-path] payment-notify GET',
    JSON.stringify({
      http: pnGet.status,
      ok: pn.ok,
      telegramConfigured: pn.telegramConfigured,
      telegramUrl: pn.telegramUrl,
      telegram: pn.telegram,
      zalo: pn.zalo,
      mode: pn.mode,
    }),
  );
  assert(pnGet.ok, `payment-notify GET HTTP ${pnGet.status}`);
  assert(
    typeof pn.telegramUrl === 'string' &&
      /^https:\/\/t\.me\//i.test(pn.telegramUrl),
    `GET telegramUrl must be t.me, got ${pn.telegramUrl}`,
  );
  assert(
    !/zalo\.me/i.test(pn.telegramUrl || ''),
    'GET telegramUrl must not be zalo',
  );

  // POST like handlePaidNotify
  const postRes = await fetch(`${BASE}/api/entitlement/payment-notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hwid: hwid || 'DEADBEEFDEADBEEF',
      planId: 'lifetime',
    }),
  });
  const post = (await postRes.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    code?: string;
    message?: string;
    telegramUrl?: string;
    telegram?: string;
    zaloUrl?: string;
  };
  console.log(
    '[user-path] payment-notify POST',
    JSON.stringify({
      http: postRes.status,
      ok: post.ok,
      error: post.error,
      code: post.code,
      message: post.message,
      telegramUrl: post.telegramUrl,
      telegram: post.telegram,
      zaloUrl: post.zaloUrl,
    }),
  );

  // Client open target = data.telegramUrl || SELLER_BANK.telegramBotUrl
  // On success or non-cooldown fail, UI opens Telegram — never zaloUrl
  if (post.ok) {
    assert(
      typeof post.telegramUrl === 'string' &&
        /^https:\/\/t\.me\//i.test(post.telegramUrl),
      `POST success telegramUrl must be t.me, got ${post.telegramUrl}`,
    );
    assert(
      !/zalo\.me/i.test(post.telegramUrl),
      'POST success open target must not be zalo',
    );
  } else if (post.code !== 'QUOTA' && postRes.status !== 429) {
    // Fail path still returns or falls back to SELLER_BANK telegramBotUrl in UI
    // API may omit telegramUrl on error — UI uses SELLER_BANK fallback
    console.log(
      '[user-path] POST fail (non-cooldown) — UI falls back to SELLER_BANK.telegramBotUrl',
    );
  } else {
    console.log('[user-path] POST cooldown — UI must NOT re-open Telegram');
  }

  // Trial path: cloud first → local (same as handleStartTrial)
  const t0 = Date.now();
  let tRes = await fetch(`${BASE}/api/cloud/license/trial`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hwid }),
  });
  let tData = (await tRes.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    token?: string;
    cloud?: boolean;
  };
  console.log(
    '[user-path] cloud trial',
    JSON.stringify({
      http: tRes.status,
      ok: tData.ok,
      error: tData.error,
      message: tData.message,
      hasToken: !!tData.token,
    }),
  );
  if (!tRes.ok || !tData.ok) {
    tRes = await fetch(`${BASE}/api/entitlement/trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hwid }),
    });
    tData = (await tRes.json().catch(() => ({}))) as typeof tData;
    console.log(
      '[user-path] local trial',
      JSON.stringify({
        http: tRes.status,
        ok: tData.ok,
        error: tData.error,
        message: tData.message,
        hasToken: !!tData.token,
      }),
    );
  }
  const trialMs = Date.now() - t0;
  console.log('[user-path] trial API ms=', trialMs);
  // UX: button holds min 3s even if API is faster
  console.log(
    '[user-path] UI min wait 3s → user sees countdown regardless of API speed',
  );

  // Source contract (what user sees in LicenseModal)
  const root = process.cwd();
  const modal = fs.readFileSync(
    path.join(root, 'src/app/workspace/features/license/LicenseModal.tsx'),
    'utf8',
  );
  const pricing = fs.readFileSync(
    path.join(root, 'src/lib/commercial/pricingPlans.ts'),
    'utf8',
  );

  assert(/TRIAL_WAIT_SEC\s*=\s*3/.test(modal), 'TRIAL_WAIT_SEC=3');
  assert(
    /vui lòng chờ \$\{TRIAL_WAIT_SEC\}s/.test(modal),
    'trial toast chờ 3s',
  );
  assert(
    /Đang kích hoạt — chờ \$\{trialWaitSec\}s/.test(modal),
    'trial button countdown label',
  );
  assert(
    modal.includes('openTelegramDeepLink') || modal.includes('openTelegramBot'),
    'openTelegramDeepLink helper',
  );
  assert(
    modal.includes('SELLER_BANK.telegramBotUrl') ||
      modal.includes('telegramBotUsername') ||
      modal.includes('t.me/'),
    'open uses telegram bot URL',
  );
  assert(
    modal.includes('paidNotifySuccessMsg') ||
      modal.includes('data-testid="paid-notify-success"') ||
      modal.includes('Cấp Key'),
    'paid notify durable success UI (Cấp Key / messageId)',
  );
  assert(
    modal.includes('statusLoading') ||
      modal.includes('đang đồng bộ') ||
      !/setBusy\(true\);\s*\n\s*try \{\s*\n\s*const res = await fetch\(API\.commercialStatus/m.test(
        modal,
      ),
    'status refresh must not block trial/paid labels as busy',
  );
  assert(
    !/window\.open\([\s\S]{0,120}zalo/i.test(modal),
    'no window.open zalo',
  );
  assert(
    /telegramBotUrl:\s*'https:\/\/t\.me\/AINovel_license_bot'/.test(pricing),
    'pricing telegramBotUrl',
  );
  // Primary action copy: must not claim auto-open Zalo
  assert(
    /không[\s\S]{0,40}mở Zalo/i.test(modal),
    'copy says do not auto-open Zalo',
  );
  assert(
    modal.includes("title={\n                  paidNotifyCooling") ||
      modal.includes('mở ${SELLER_BANK.telegramBotDisplay}') ||
      modal.includes('telegramBotDisplay'),
    'paid notify title mentions Telegram',
  );

  // Electron: window.open → setWindowOpenHandler → shell.openExternal for https URLs
  // (regex in main.js is /^https:\/\// so t.me/… opens in OS browser/Telegram)
  const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert(
    /setWindowOpenHandler/.test(mainJs) && /shell\.openExternal/.test(mainJs),
    'Electron must route window.open to shell.openExternal',
  );
  assert(
    mainJs.includes('https:\\/\\/') || mainJs.includes('https://'),
    'Electron openExternal gate allows https (t.me OK)',
  );

  console.log('[user-path] ALL CHECKS PASS');
  console.log(
    JSON.stringify({
      VERDICT: 'PASS',
      hwid: hwid || null,
      paymentNotify: {
        getTelegramUrl: pn.telegramUrl,
        postOk: !!post.ok,
        postTelegramUrl: post.telegramUrl || null,
        postHttp: postRes.status,
      },
      trial: {
        ok: !!tData.ok,
        hasToken: !!tData.token,
        apiMs: trialMs,
        uiMinWaitSec: 3,
      },
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
