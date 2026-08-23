// Diag Bug B: does the trial-error banner appear when trial API returns 401?
// Uses Playwright connectOverCDP to drive the packaged app's Chrome instance.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const OUT = 'output/diag-bug-b-result.json';

function log(...a) { console.log(new Date().toISOString().slice(11, 23), ...a); }

const browser = await chromium.connectOverCDP(CDP);
log('connected. contexts:', browser.contexts().length);

let ctx = browser.contexts()[0] || await browser.newContext();
let pages = ctx.pages();
log('pages:', pages.map(p => p.url()));

// Find or create workspace page
let page = pages.find(p => p.url().includes('127.0.0.1:3000')) || pages[0];
if (!page.url().includes('127.0.0.1:3000')) {
  page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/workspace', { waitUntil: 'domcontentloaded', timeout: 45000 });
}
await page.bringToFront();

// Wait for app shell
log('waiting for workspace shell...');
await page.waitForSelector('text=AI Novel', { timeout: 60000 }).catch(() => log('WARN no AI Novel text'));
await page.waitForTimeout(3000);
log('title:', await page.title());

// Capture trial API responses
const trialResponses = [];
page.on('response', (res) => {
  const u = res.url();
  if (u.includes('/api/entitlement/trial') || u.includes('/api/cloud/license/trial')) {
    res.text().then(t => trialResponses.push({ status: res.status(), url: u, body: t.slice(0, 300) })).catch(() => {});
  }
});

// Try to open License modal: click logo button (aria-label "Mở Bản quyền License")
const logoBtn = await page.getByLabel('Mở Bản quyền License').count();
log('logo button count:', logoBtn);
if (logoBtn > 0) {
  // Use DOM click to bypass the CSS pulse animation stability check
  await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Mở Bản quyền License"]');
    if (b) b.click();
  });
  log('logo clicked via evaluate');
} else {
  // Fallback: find a button containing "Bản quyền"
  const bc = await page.getByText('Bản quyền', { exact: false }).count();
  log('fallback "Bản quyền" count:', bc);
  if (bc > 0) await page.getByText('Bản quyền', { exact: false }).first().click();
}
await page.waitForTimeout(5000);

// Look for HWID text
const hwidVisible = await page.getByText(/F925B0FF900599A0/i).count();
log('HWID visible count:', hwidVisible);

// Check the modal presence
const modalCount = await page.locator('[data-testid="trial-error"]').count();
log('initial trial-error count:', modalCount);

// Install MutationObserver + click trial button via evaluate
const result = await page.evaluate(async () => {
  const events = [];
  const now = () => Date.now();
  const t0 = now();

  const target = document.body;
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.querySelector && (n.matches && n.matches('[data-testid="trial-error"]') || (n.querySelector && n.querySelector('[data-testid="trial-error"]')))) {
          events.push({ t: now() - t0, type: 'ADDED' });
        }
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && n.querySelector && (n.matches && n.matches('[data-testid="trial-error"]') || (n.querySelector && n.querySelector('[data-testid="trial-error"]')))) {
          events.push({ t: now() - t0, type: 'REMOVED' });
        }
      }
    }
  });
  obs.observe(target, { childList: true, subtree: true });

  // Find trial button case-insensitively
  const buttons = [...document.querySelectorAll('button')];
  const trialBtn = buttons.find(b => /dùng thử\s*trial/i.test(b.textContent || ''));
  if (!trialBtn) return { error: 'NO TRIAL BUTTON FOUND', buttons: buttons.map(b => (b.textContent || '').trim().slice(0, 60)).slice(0, 30), events };

  // Pre-existing banner check
  const pre = document.querySelector('[data-testid="trial-error"]');
  if (pre) events.push({ t: now() - t0, type: 'PRE_EXISTING' });

  trialBtn.click();
  events.push({ t: now() - t0, type: 'CLICKED' });

  // Poll up to 25s
  const deadline = t0 + 25000;
  let lastPresent = !!document.querySelector('[data-testid="trial-error"]');
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
    const present = !!document.querySelector('[data-testid="trial-error"]');
    if (present && !lastPresent) events.push({ t: Date.now() - t0, type: 'BANNER_PRESENT' });
    if (!present && lastPresent) events.push({ t: Date.now() - t0, type: 'BANNER_GONE' });
    lastPresent = present;
  }

  obs.disconnect();
  const final = document.querySelector('[data-testid="trial-error"]');
  return {
    error: null,
    events,
    finalPresent: !!final,
    finalText: final ? final.textContent.trim().slice(0, 200) : null,
    buttonDisabled: trialBtn.disabled,
    buttonText: (trialBtn.textContent || '').trim().slice(0, 80),
  };
}, { timeout: 40000 });

log('RESULT:', JSON.stringify(result, null, 2));
writeFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), result, trialResponses }, null, 2));
log('trialResponses:', JSON.stringify(trialResponses, null, 2));
log('saved to', OUT);

await browser.close();
