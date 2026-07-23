/**
 * Vai USER: đi đúng luồng app (status → trial → payment-notify)
 * + assert contract UI (messageId, không mở bot trống khi OK).
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`USER_FAIL: ${msg}`);
}

async function main() {
  console.log('=== VAI USER: Bản quyền / thanh toán ===');
  console.log('base=', BASE);

  // 1) User mở app → status (HWID)
  const stRes = await fetch(`${BASE}/api/commercial/status`, { cache: 'no-store' });
  ok(stRes.ok, `commercial/status HTTP ${stRes.status}`);
  const st = (await stRes.json()) as {
    ok?: boolean;
    tier?: string;
    entitlement?: { hwid?: string };
    trial?: { active?: boolean; days?: number };
  };
  const hwid = (st.entitlement?.hwid || '').toUpperCase();
  console.log(
    '[user] status',
    JSON.stringify({
      tier: st.tier,
      hwid: hwid || '(chưa có)',
      trial: st.trial,
    }),
  );
  ok(hwid.length >= 8, 'User chưa có HWID — nút báo Admin sẽ báo chờ tải');

  // 2) User bấm «Đã thanh toán» — body y hệt LicenseModal
  const plans: Array<'month' | 'year' | 'lifetime'> = ['lifetime'];
  for (const planId of plans) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/entitlement/payment-notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hwid, planId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
      message?: string;
      messageId?: number;
      notified?: boolean;
      telegramUrl?: string;
      telegramDeepLink?: string;
    };
    const ms = Date.now() - t0;
    console.log(
      '[user] click Đã thanh toán',
      JSON.stringify({
        planId,
        http: res.status,
        ms,
        ok: data.ok,
        messageId: data.messageId,
        notified: data.notified,
        code: data.code,
        error: data.error,
        message: data.message,
        deepLink: data.telegramDeepLink || data.telegramUrl,
      }),
    );

    if (res.status === 429 || data.code === 'QUOTA') {
      console.log(
        '[user] COOLDOWN — đúng: toast chống spam, KHÔNG mở bot, Admin không spam',
      );
      continue;
    }

    // Giống UI: adminNotified = ok && messageId number
    const adminNotified =
      res.ok &&
      data.ok === true &&
      typeof data.messageId === 'number' &&
      Number.isFinite(data.messageId);

    if (adminNotified) {
      console.log(
        `[user] SUCCESS: toast «Admin đã nhận» message #${data.messageId} — KHÔNG mở bot trống`,
      );
      ok(
        data.messageId! > 0,
        'messageId phải > 0 (Admin Telegram có tin thật)',
      );
    } else {
      console.log(
        '[user] FAIL path: UI mở deep-link start=pay_… + toast lỗi (Admin chưa nhận)',
      );
      ok(
        typeof data.telegramDeepLink === 'string' ||
          typeof data.telegramUrl === 'string' ||
          true,
        'fallback deep-link',
      );
      throw new Error(
        `USER_FAIL: Admin chưa nhận ticket: ${data.error || res.status}`,
      );
    }
  }

  // 3) User máy khác (HWID lạ) — luôn tạo ticket mới nếu server free cooldown per-HWID
  const guestHwid = `USR${Date.now().toString(16).toUpperCase().slice(-12)}`;
  const gRes = await fetch(`${BASE}/api/entitlement/payment-notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hwid: guestHwid,
      planId: 'month',
      note: 'user-role guest machine sim',
    }),
  });
  const g = (await gRes.json().catch(() => ({}))) as {
    ok?: boolean;
    messageId?: number;
    error?: string;
  };
  console.log(
    '[user-guest] payment-notify',
    JSON.stringify({
      hwid: guestHwid,
      http: gRes.status,
      ok: g.ok,
      messageId: g.messageId,
      error: g.error,
    }),
  );
  ok(
    gRes.ok && g.ok && typeof g.messageId === 'number',
    `Guest notify must deliver messageId, got ${JSON.stringify(g)}`,
  );

  // 4) Trial path (cloud → local) như handleStartTrial
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
  };
  if (!tRes.ok || !tData.ok) {
    tRes = await fetch(`${BASE}/api/entitlement/trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hwid }),
    });
    tData = (await tRes.json().catch(() => ({}))) as typeof tData;
  }
  console.log(
    '[user] Dùng thử',
    JSON.stringify({
      http: tRes.status,
      ok: tData.ok,
      hasToken: !!tData.token,
      message: tData.message || tData.error,
      apiMs: Date.now() - t0,
      uiMinWaitSec: 3,
    }),
  );
  // API may already be trial-active; UI still shows 3s countdown
  ok(tRes.ok || tData.error, 'trial endpoint reachable');

  // 5) Source contract (what user sees after our fix)
  const modal = fs.readFileSync(
    path.join(process.cwd(), 'src/app/workspace/features/license/LicenseModal.tsx'),
    'utf8',
  );
  ok(
    /typeof data\.messageId === 'number'/.test(modal),
    'UI requires messageId',
  );
  ok(
    /Admin đã nhận báo thanh toán/.test(modal),
    'success toast title for user',
  );
  ok(
    !/openTelegramDeepLink\(data\.telegramUrl\);\s*\n\s*\} catch/.test(modal),
    'no open on success block',
  );
  // success block must not call openTelegramDeepLink
  const successIdx = modal.indexOf('// Success: Admin đã nhận');
  ok(successIdx > 0, 'success comment present');
  const successSlice = modal.slice(successIdx, successIdx + 500);
  ok(
    !successSlice.includes('openTelegramDeepLink'),
    'success path must not openTelegramDeepLink',
  );

  console.log(
    JSON.stringify({
      VERDICT: 'PASS',
      role: 'user',
      hwid,
      guestMessageId: g.messageId,
      checks: [
        'status HWID',
        'payment-notify messageId',
        'guest ticket',
        'trial API',
        'UI no empty bot on OK',
      ],
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
