/**
 * DIAG BUG A — SetupPhase number spinbuttons (so_chuong / so_tu_chuong)
 *
 * Drives the packaged clean-room app via Chrome CDP (Playwright connectOverCDP).
 * Opens the Setup modal from the Sidebar, then probes the two number inputs:
 *   - role=spinbutton presence
 *   - invalid / aria-invalid / :invalid state
 *   - max attribute + value clamping when typing out-of-range
 *   - onBlur restoration behavior
 */
import { chromium } from 'playwright-core';

const CDP = 'http://127.0.0.1:9222';
const OUT = 'output/diag-bug-a-result.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('connected. launching...');
  const browser = await chromium.connectOverCDP(CDP);
  console.log('connected. contexts:', browser.contexts().length);
  const ctx = browser.contexts()[0];
  let pages = ctx.pages();
  console.log('pages:', pages.map((p) => p.url()));

  let page = pages.find((p) => p.url().includes('127.0.0.1:3000') || p.url().includes('localhost:3000'));
  if (!page && pages.length) page = pages[0];
  if (!page) throw new Error('No app page found');
  if (page.url() !== 'http://127.0.0.1:3000/workspace') {
    await page.goto('http://127.0.0.1:3000/workspace', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  console.log('waiting for workspace shell...');
  await page.waitForSelector('text=AI Novel', { timeout: 30000 }).catch(() => {});
  console.log('title:', await page.title());

  // Click "Setup · Tham số AI Novel" in Sidebar
  const setupBtnCount = await page.locator('button:has-text("Setup · Tham số AI Novel")').count();
  console.log('setup button count:', setupBtnCount);
  if (setupBtnCount === 0) {
    throw new Error('Setup button not found');
  }
  await page.locator('button:has-text("Setup · Tham số AI Novel")').first().click({ force: true }).catch(async () => {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((x) => x.textContent?.includes('Setup · Tham số AI Novel'));
      if (b) b.click();
    });
  });
  await sleep(1500);

  // Setup modal should be open (data-setup-modal="classic")
  const modalOpen = await page.locator('[data-setup-modal="classic"]').count();
  console.log('setup modal count:', modalOpen);

  const result = await page.evaluate(async () => {
    const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {
      modalOpen: false,
      inputs: [] ,
      clampTests: [],
      errors: [],
    };

    const modal = document.querySelector('[data-setup-modal="classic"]');
    if (!modal) {
      out.errors.push('setup modal not in DOM');
      return out;
    }
    out.modalOpen = true;

    const numberInputs = Array.from(modal.querySelectorAll('input[type="number"]'));
    out.inputs = numberInputs.map((el) => {
      const rect = el.getBoundingClientRect();
      const spinners = el.matches(':hover') ? [] : [];
      return {
        id: el.id || null,
        value: el.value,
        min: el.min,
        max: el.max,
        step: el.step,
        invalidAttr: el.hasAttribute('invalid') ? el.getAttribute('invalid') : null,
        ariaInvalid: el.getAttribute('aria-invalid'),
        matchesInvalidPseudo: (() => { try { return el.matches(':invalid'); } catch { return 'err'; } })(),
        matchesValidPseudo: (() => { try { return el.matches(':valid'); } catch { return 'err'; } })(),
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        role: el.getAttribute('role'),
        // is the input's actual value beyond min/max (invalid state)?
        valNum: el.valueAsNumber,
        outOfRange: (el.max && el.valueAsNumber > Number(el.max)) || (el.min && el.valueAsNumber < Number(el.min)),
      };
    });

    // Clamp test: set so_chuong to 99999 via native setter (bypass React) → check store clamp on blur
    const chInput = numberInputs[0];
    const wordsInput = numberInputs[1];
    if (chInput) {
      const before = chInput.value;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(chInput, '99999');
      chInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep2(400);
      const afterInput = chInput.value;
      // now blur
      chInput.blur();
      await sleep2(400);
      const afterBlur = chInput.value;
      out.clampTests.push({ field: 'so_chuong', before, afterInput, afterBlur });
    }
    if (wordsInput) {
      const before = wordsInput.value;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(wordsInput, '99999');
      wordsInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep2(400);
      const afterInput = wordsInput.value;
      wordsInput.blur();
      await sleep2(400);
      const afterBlur = wordsInput.value;
      out.clampTests.push({ field: 'so_tu_chuong', before, afterInput, afterBlur });
    }

    return out;
  });

  console.log('RESULT:', JSON.stringify(result, null, 2));
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('output', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ts: Date.now(), result }, null, 2));
  console.log('saved to', OUT);
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
