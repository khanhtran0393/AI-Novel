import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OUT = path.join(os.tmpdir(), "ainovel-audit", "ui-report.json");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const log = [];
let step = 0;

function add(m) {
  step++;
  const entry = { step, ...m };
  log.push(entry);
  process.stdout.write(`[${step}] ${m.type ?? "INFO"}: ${m.summary}\n`);
  fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
}

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // --- Errors ---
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`page: ${err.message}`));

  // 1. Navigate home
  add({ type: "NAV", summary: "Navigating to /" });
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(path.dirname(OUT), "step1_home.png") });
  add({ type: "OK", summary: `Homepage loaded, title=${await page.title()}` });

  // 2. Navigate workspace
  add({ type: "NAV", summary: "Navigating to /workspace" });
  await page.goto("http://127.0.0.1:3000/workspace", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(path.dirname(OUT), "step2_workspace.png") });
  add({ type: "OK", summary: "Workspace loaded" });

  // 3. Check for hydration errors
  const bodyText = await page.textContent("body");
  add({ type: "INFO", summary: `Body text length=${bodyText?.length ?? 0}` });

  if ((bodyText ?? "").includes("Đang nạp") || (bodyText ?? "").includes("Loading")) {
    const loadingText = (bodyText ?? "").match(/Đang nạp[^.]*/)?.[0] || (bodyText ?? "").match(/Loading[^.]*/)?.[0];
    add({ type: "ERROR", summary: `Hydration stuck: "${loadingText}"` });
  }

  // 4. Check localStorage
  const ls = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      out.push({ k, size: (v ?? "").length });
    }
    return out;
  });
  add({ type: "INFO", summary: `localStorage keys=${ls.length}`, detail: ls });

  // 5. Find setup elements
  const hasSetup = await page.$('text=Chủ đề');
  const hasStyle = await page.$('text=Phong cách');
  const hasTitle = await page.$('text=Tên tác phẩm');
  add({ type: "CHECK", summary: `Setup elements: chu_de=${!!hasSetup} phong_cach=${!!hasStyle} ten_tac_pham=${!!hasTitle}` });

  // 6. Find sidebar navigation
  const sidebar = await page.$('nav, aside, [data-testid=sidebar]');
  const sidebarText = sidebar ? (await sidebar.textContent())?.trim().slice(0, 300) : "NONE";
  add({ type: "INFO", summary: `Sidebar: ${sidebarText}` });

  // 7. Try clicking Setup label
  const setupLabel = page.locator('text=Setup').first();
  if (await setupLabel.isVisible()) {
    add({ type: "CLICK", summary: "Clicking Setup" });
    await setupLabel.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(path.dirname(OUT), "step3_setup.png") });
  }

  // 8. Check for mobile menu / sidebar toggle button
  const menuBtn = page.locator('button[aria-label*="menu"], button[aria-label*="Menu"], [data-testid="sidebar-toggle"]').first();
  if (await menuBtn.isVisible()) {
    add({ type: "CLICK", summary: "Opening sidebar toggle" });
    await menuBtn.click();
    await page.waitForTimeout(2000);
  }

  // 9. Check brand logo
  const logo = await page.$('img[alt*=logo], img[alt*=Logo], [data-testid=brand]');
  add({ type: "CHECK", summary: `Brand logo: ${!!logo}` });

  // 10. Check commercial badge
  const badge = await page.$('text=FREE, text=TRIAL, text=PRO');
  add({ type: "CHECK", summary: `Tier badge found: ${!!badge}` });

  // 11. All errors
  add({ type: "ERRORS", summary: `Total errors: ${errors.length}`, detail: errors });

  // 12. Take final screenshot
  await page.screenshot({ path: path.join(path.dirname(OUT), "step4_final.png"), fullPage: true });

  add({ type: "DONE", summary: "UI audit complete", outFile: OUT });

  await ctx.close();
} finally {
  await browser.close();
}

process.exit(0);