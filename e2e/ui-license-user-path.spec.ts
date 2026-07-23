/**
 * User-path UI: Logo → Bản quyền
 * 1) Dùng thử → toast + nút «chờ Ns» trong 3s (máy Free mock)
 * 2) Đã thanh toán → success banner (Cấp Key / messageId), không mở bot trống
 */
import { test, expect } from '@playwright/test';

test.describe('License modal user path', () => {
  test('trial countdown 3s + paid notify requires messageId (no empty bot)', async ({
    page,
  }) => {
    // Capture every window.open href (what Electron shell.openExternal receives)
    await page.addInitScript(() => {
      const w = window as Window & { __openedUrls?: string[] };
      w.__openedUrls = [];
      window.open = ((url?: string | URL) => {
        const href = url == null ? '' : String(url);
        w.__openedUrls!.push(href);
        return null;
      }) as typeof window.open;
      try {
        localStorage.removeItem('ainovel.entitlementToken');
        sessionStorage.removeItem('ainovel.entitlementToken');
        sessionStorage.removeItem('ainovel.paidNotifyAt');
        localStorage.removeItem('ainovel.paidNotifyAt');
        sessionStorage.removeItem('ainovel.paidNotifySuccessMsg');
      } catch {
        /* ignore */
      }
    });

    // Force FREE tier so Trial stays enabled (real machine may be Pro)
    await page.route('**/api/commercial/status', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            tier: 'free',
            tokenValid: false,
            trial: { enabled: true, active: false, days: 7 },
            claims: null,
            entitlement: { hwid: 'E2EUSERPATHTEST01' },
            freeLimits: {
              applies: true,
              tier: 'free',
              maxWordsPerChapter: 600,
              maxChapters: 2,
              dailyUsesPerFeature: 3,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    // Stable paid-notify success so we don't depend on server 2-min cooldown
    await page.route('**/api/entitlement/payment-notify', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            messageId: 999001,
            notified: true,
            message:
              'Admin đã nhận báo thanh toán (messageId #999001). Admin có nút Cấp Key / Từ chối. Chờ key trong app.',
            telegramUrl:
              'https://t.me/AINovel_license_bot?start=pay_lifetime_E2EUSERPATHTEST01',
            telegramDeepLink:
              'https://t.me/AINovel_license_bot?start=pay_lifetime_E2EUSERPATHTEST01',
          }),
        });
        return;
      }
      await route.continue();
    });

    // Fast trial so UI wait is dominated by 3s countdown, not API hang
    await page.route('**/api/cloud/license/trial', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            cloud: true,
            token: 'AINOVEL2.mock.trial.userpath',
            message: 'Trial mock OK',
            claims: { is_pro: true, is_trial: true, plan: 'trial' },
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/entitlement/trial', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            token: 'AINOVEL2.mock.trial.userpath',
            message: 'Trial local mock OK',
            claims: { is_pro: true, is_trial: true, plan: 'trial' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      try {
        sessionStorage.removeItem('ainovel.paidNotifyAt');
        localStorage.removeItem('ainovel.paidNotifyAt');
        sessionStorage.removeItem('ainovel.paidNotifySuccessMsg');
        localStorage.removeItem('ainovel.entitlementToken');
      } catch {
        /* ignore */
      }
    });

    await expect(
      page.getByText(/AI Novel|Trợ Lý Biên Kịch|Đang nạp|Workspace/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    const logo = page.getByRole('button', { name: /Mở Bản quyền License/i });
    await expect(logo).toBeVisible({ timeout: 30_000 });
    await logo.click({ force: true });
    const dialog = page.locator('[role="dialog"][aria-label*="Bản quyền"]');
    try {
      await expect(dialog).toBeVisible({ timeout: 8_000 });
    } catch {
      await logo.click({ force: true });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
    }

    // Tier line must not contradict (FREE · Pro…)
    const headerTier = (
      await dialog.locator('p').filter({ hasText: /Tier hiện tại/i }).first().innerText()
    ).normalize('NFC');
    expect(headerTier).not.toMatch(/FREE\s*·\s*Pro đã kích hoạt/i);

    // --- 1) Trial: must show «chờ Ns» (not silent) ---
    const trialBtn = page.getByRole('button', {
      name: /Dùng thử Trial|Đang kích hoạt|Đang xử lý trial/i,
    });
    await expect(trialBtn).toBeVisible();
    await expect(trialBtn).toBeEnabled({ timeout: 10_000 });
    const tClick = Date.now();
    await trialBtn.click();

    await expect(
      page.getByRole('button', { name: /Đang kích hoạt — chờ \d+s/i }),
    ).toBeVisible({ timeout: 1_500 });

    await expect(
      page.getByText(/vui lòng chờ \d+s|chờ 3s/i).first(),
    ).toBeVisible({ timeout: 2_000 });

    // Hold until countdown finishes (~3s)
    await expect(
      page.getByRole('button', {
        name: /Dùng thử Trial|Đang xử lý trial|Trial đang dùng|Đã Pro/i,
      }),
    ).toBeVisible({ timeout: 8_000 });
    const trialElapsed = Date.now() - tClick;
    expect(
      trialElapsed,
      `trial UI should hold ~3s, elapsed=${trialElapsed}ms`,
    ).toBeGreaterThanOrEqual(2_500);

    // --- 2) Paid notify success: durable banner with Cấp Key / messageId ---
    await page.evaluate(() => {
      (window as Window & { __openedUrls?: string[] }).__openedUrls = [];
      try {
        sessionStorage.removeItem('ainovel.paidNotifyAt');
        localStorage.removeItem('ainovel.paidNotifyAt');
      } catch {
        /* ignore */
      }
    });
    // Force re-open so cooldown state re-reads cleared storage
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await logo.click({ force: true });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const paidBtn = page.getByRole('button', {
      name: /Đã thanh toán|Đang báo Admin/i,
    });
    await expect(paidBtn).toBeEnabled({ timeout: 8_000 });
    await paidBtn.click();

    // Durable in-modal banner (toast alone is not enough for strict match)
    await expect(page.getByTestId('paid-notify-success')).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId('paid-notify-success')).toContainText(
      /messageId|Cấp Key|Admin đã nhận/i,
    );

    // Success path must NOT open t.me/zalo (empty bot was confusing)
    await page.waitForTimeout(800);
    const urls = await page.evaluate(
      () =>
        (window as Window & { __openedUrls?: string[] }).__openedUrls || [],
    );
    expect(urls.join(' ')).not.toMatch(/zalo\.me/i);
    expect(urls.join(' ')).not.toMatch(/t\.me\//i);

    const dialogText = (
      await page.locator('[role="dialog"]').innerText()
    ).normalize('NFC');
    expect(dialogText).toMatch(/Cấp Key|báo Admin|messageId|Admin đã nhận/i);
  });
});
