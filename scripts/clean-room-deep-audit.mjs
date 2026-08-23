// Deep "turn everything upside down" audit — clicks every button, tries every tab, sends bad payloads
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";

const OUT = path.join(os.tmpdir(), "ainovel-audit", "deep-report.json");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const log = [];
let step = 0;
function add(m) { step++; const e = { step, ts: new Date().toISOString(), ...m }; log.push(e); process.stdout.write(`[${step}] ${m.type ?? "INFO"}: ${m.summary}\n`); fs.writeFileSync(OUT, JSON.stringify(log, null, 2)); }

// ====== PART 1: HTTP edge-case audit ======
add({ type: "SECTION", summary: "=== HTTP EDGE CASE AUDIT ===" });

function httpReq(method, urlPath, body) {
  return new Promise((resolve) => {
    const u = new URL(urlPath, "http://127.0.0.1:3000");
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body ? { "Content-Type": "application/json" } : {}, timeout: 10000 };
    const req = http.request(opts, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d.slice(0, 300) }));
    });
    req.on("error", (e) => resolve({ error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ error: "timeout" }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const edgeCases = [
  { label: "GET /api/generate-image (was 500)", method: "GET", url: "/api/generate-image" },
  { label: "GET /api/generate-video (was 405)", method: "GET", url: "/api/generate-video" },
  { label: "POST /api/generate empty body", method: "POST", url: "/api/generate", body: {} },
  { label: "POST /api/generate null requestType", method: "POST", url: "/api/generate", body: { requestType: null } },
  { label: "POST /api/generate unknown type", method: "POST", url: "/api/generate", body: { requestType: "MAKE_COFFEE" } },
  { label: "POST /api/generate-image no body", method: "POST", url: "/api/generate-image", body: {} },
  { label: "POST /api/generate-image missing provider", method: "POST", url: "/api/generate-image", body: { prompt: "test" } },
  { label: "POST /api/generate-video no body", method: "POST", url: "/api/generate-video", body: {} },
  { label: "POST /api/generate-tts empty", method: "POST", url: "/api/generate-tts", body: { platform: "edge_tts" } },
  { label: "GET /api/ainovel/status", method: "GET", url: "/api/ainovel/status" },
  { label: "GET /api/ainovel/config", method: "GET", url: "/api/ainovel/config" },
  { label: "GET /api/ainovel/chapters", method: "GET", url: "/api/ainovel/chapters" },
  { label: "GET /api/ainovel/diag", method: "GET", url: "/api/ainovel/diag" },
  { label: "GET /api/ainovel/capabilities", method: "GET", url: "/api/ainovel/capabilities" },
  { label: "GET /api/health/runtime", method: "GET", url: "/api/health/runtime" },
  { label: "GET /api/entitlement/verify", method: "GET", url: "/api/entitlement/verify" },
  { label: "GET /api/entitlement/trial", method: "GET", url: "/api/entitlement/trial" },
  { label: "POST /api/entitlement/trial", method: "POST", url: "/api/entitlement/trial", body: {} },
  { label: "GET /api/flow/accounts", method: "GET", url: "/api/flow/accounts" },
  { label: "GET /api/flow/projects", method: "GET", url: "/api/flow/projects" },
  { label: "POST /api/flow/bootstrap empty", method: "POST", url: "/api/flow/bootstrap", body: {} },
  { label: "GET /api/navtools/gateway", method: "GET", url: "/api/navtools/gateway" },
  { label: "GET /api/navtools/upscale", method: "GET", url: "/api/navtools/upscale" },
  { label: "GET /api/navtools/subtitle", method: "GET", url: "/api/navtools/subtitle" },
  { label: "POST /api/cloud/status", method: "POST", url: "/api/cloud/status", body: {} },
  { label: "GET /api/cloud/license/verify", method: "GET", url: "/api/cloud/license/verify" },
  { label: "DELETE /api/generate", method: "DELETE", url: "/api/generate" },
  { label: "PUT /api/generate", method: "PUT", url: "/api/generate", body: {} },
  { label: "PATCH /api/generate-image", method: "PATCH", url: "/api/generate-image" },
  { label: "OPTIONS /api/generate", method: "OPTIONS", url: "/api/generate" },
  { label: "HEAD /api/commercial/status", method: "HEAD", url: "/api/commercial/status" },
];

for (const tc of edgeCases) {
  const res = await httpReq(tc.method, tc.url, tc.body);
  const is5xx = typeof res.status === "number" && res.status >= 500;
  const isErr = res.error || is5xx;
  add({ type: isErr ? "ERROR" : "OK", summary: `${tc.label} → ${res.status ?? res.error}`, detail: res.body?.slice(0, 200) });
}

// ====== PART 2: UI deep click audit ======
add({ type: "SECTION", summary: "=== UI DEEP CLICK AUDIT ===" });

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const uiErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") uiErrors.push(msg.text()); });
page.on("pageerror", (err) => uiErrors.push("PAGE: " + err.message));

try {
  await page.goto("http://127.0.0.1:3000/workspace", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);
  add({ type: "OK", summary: "Workspace loaded for deep UI audit" });

  // Click EVERYTHING clickable
  const allButtons = await page.locator('button, a, [role="button"], [role="tab"], [role="menuitem"], [onclick]').all();
  add({ type: "INFO", summary: `Total clickable elements: ${allButtons.length}` });

  const clicked = new Set();
  let clicks = 0;
  const errorsAfterClick = [];

  for (let i = 0; i < allButtons.length && clicks < 60; i++) {
    try {
      const btn = allButtons[i];
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;

      const text = (await btn.textContent().catch(() => ""))?.trim().slice(0, 60);
      const tag = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => "?");
      const href = await btn.getAttribute("href").catch(() => null);
      const aria = await btn.getAttribute("aria-label").catch(() => null);
      const id = text || aria || href || `#${i}`;

      if (clicked.has(id)) continue;
      clicked.add(id);

      add({ type: "CLICK", summary: `Clicking [${tag}] "${id}"` });
      const beforeErrors = uiErrors.length;
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Check for new errors
      const newErrors = uiErrors.slice(beforeErrors);
      if (newErrors.length) {
        errorsAfterClick.push({ clicked: id, errors: newErrors });
        add({ type: "ERROR_AFTER_CLICK", summary: `"${id}" → ${newErrors.length} new console errors`, detail: newErrors.slice(0, 3) });
      }

      // Try to close any modal/dialog that opened
      const closeBtn = page.locator('button:has-text("Đóng"), button:has-text("Close"), [aria-label="Close"], button:has-text("Hủy"), button:has-text("Cancel")').first();
      if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }

      // Press Escape to close any dialog
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      clicks++;
    } catch (e) {
      // ignore individual click failures
    }
  }

  // ====== PART 3: Try filling forms ======
  add({ type: "SECTION", summary: "=== FORM FILL AUDIT ===" });

  // Find all inputs and fill them with garbage to trigger validation
  const allInputs = await page.locator('input:not([type="hidden"]), textarea, select').all();
  add({ type: "INFO", summary: `Total form elements: ${allInputs.length}` });

  for (let i = 0; i < Math.min(allInputs.length, 20); i++) {
    try {
      const inp = allInputs[i];
      const visible = await inp.isVisible().catch(() => false);
      if (!visible) continue;
      const name = (await inp.getAttribute("name").catch(() => null)) || (await inp.getAttribute("placeholder").catch(() => null)) || `input#${i}`;
      const tagName = await inp.evaluate(el => el.tagName.toLowerCase()).catch(() => "input");
      add({ type: "FILL", summary: `Filling [${tagName}] "${name}" with garbage` });

      if (tagName === "select") {
        const opts = await inp.locator("option").all();
        if (opts.length > 1) await inp.selectOption({ index: 1 }).catch(() => {});
      } else {
        await inp.fill("X".repeat(5000)).catch(() => {});
        await page.waitForTimeout(200);
      }
    } catch {}
  }

  // ====== PART 4: Try submitting forms (click all submit buttons) ======
  add({ type: "SECTION", summary: "=== SUBMIT BUTTON AUDIT ===" });
  const submitBtns = await page.locator('button[type="submit"], input[type="submit"], button:has-text("Generate"), button:has-text("Tạo"), button:has-text("Sinh"), button:has-text("Write"), button:has-text("Viết"), button:has-text("Save"), button:has-text("Lưu")').all();
  add({ type: "INFO", summary: `Submit buttons: ${submitBtns.length}` });

  for (const btn of submitBtns.slice(0, 10)) {
    try {
      const text = (await btn.textContent().catch(() => ""))?.trim().slice(0, 60);
      const beforeErrs = uiErrors.length;
      add({ type: "SUBMIT", summary: `Clicking submit "${text}"` });
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const newErrs = uiErrors.slice(beforeErrs);
      if (newErrs.length) add({ type: "ERROR", summary: `Submit "${text}" → ${newErrs.length} errors`, detail: newErrs.slice(0, 3) });
    } catch {}
  }

  // ====== PART 5: Navigate to all pages ======
  add({ type: "SECTION", summary: "=== NAVIGATION AUDIT ===" });
  const pages = [
    "/workspace",
    "/api/commercial/status",
    "/api/health/runtime",
    "/api/ainovel/capabilities",
    "/api/flow/status",
    "/",
  ];
  for (const p of pages) {
    try {
      const beforeErrs = uiErrors.length;
      await page.goto(`http://127.0.0.1:3000${p}`, { waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForTimeout(1000);
      const newErrs = uiErrors.slice(beforeErrs);
      add({ type: newErrs.length ? "WARN" : "OK", summary: `Nav to ${p} → ${newErrs.length} errors` });
    } catch (e) {
      add({ type: "ERROR", summary: `Nav to ${p} FAILED: ${e.message}` });
    }
  }

  // ====== FINAL SUMMARY ======
  add({ type: "SECTION", summary: "=== TOTAL UI ERRORS ===" });
  add({ type: "ERRORS", summary: `Total console/page errors: ${uiErrors.length}`, detail: uiErrors.slice(0, 20) });

  await page.screenshot({ path: path.join(path.dirname(OUT), "deep_audit_final.png"), fullPage: true });
  add({ type: "DONE", summary: "Deep audit complete", outFile: OUT });

} finally {
  await ctx.close();
  await browser.close();
}

process.exit(0);