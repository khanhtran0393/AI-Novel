/**
 * Empirical live check against running AI Novel (port 3000) + bridge 8101.
 * Logs every step to stdout + scratch/emp-flow-live-report.json
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'scratch', 'emp-flow-live-report.json');
const BASE = process.env.AINOVEL_URL || 'http://127.0.0.1:3000';
const BRIDGE = process.env.AINOVEL_FLOW_HTTP || 'http://127.0.0.1:8101';

type Step = { t: string; name: string; ok: boolean; detail: unknown };

const steps: Step[] = [];

function log(name: string, ok: boolean, detail: unknown) {
  const row = { t: new Date().toISOString(), name, ok, detail };
  steps.push(row);
  console.log(
    `\n[${ok ? 'OK' : 'FAIL'}] ${name}\n`,
    typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
  );
}

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, json, text: text.slice(0, 2000) };
}

async function main() {
  console.log('=== EMPIRICAL FLOW LIVE CHECK ===');
  console.log('BASE=', BASE, 'BRIDGE=', BRIDGE);
  console.log('cwd=', ROOT);

  // 1) Next status
  try {
    const r = await getJson(`${BASE}/api/flow/status`);
    log('GET /api/flow/status', r.status === 200, r.json);
  } catch (e) {
    log('GET /api/flow/status', false, String(e));
  }

  // 2) Bridge direct
  try {
    const r = await getJson(`${BRIDGE}/api/status`);
    log('GET bridge :8101/api/status', r.status === 200, r.json);
  } catch (e) {
    log('GET bridge :8101/api/status', false, String(e));
  }

  // 3) Extension files
  const ext = path.join(ROOT, 'extensions', 'ainovel-flow');
  const manifest = path.join(ext, 'manifest.json');
  const bg = path.join(ext, 'background.js');
  log('extension files', fs.existsSync(manifest) && fs.existsSync(bg), {
    ext,
    manifest: fs.existsSync(manifest),
    background: fs.existsSync(bg),
    bgHas9223: fs.existsSync(bg)
      ? fs.readFileSync(bg, 'utf8').includes('9223')
      : false,
  });

  // 4) Force bootstrap
  let boot: unknown = null;
  try {
    console.log('\n… POST bootstrap forceChrome (may take up to ~45s) …');
    const r = await getJson(`${BASE}/api/flow/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forceChrome: true,
        waitExtensionMs: 35000,
        waitLoginMs: 40000,
      }),
    });
    boot = r.json;
    log('POST /api/flow/bootstrap forceChrome', r.status === 200 || r.status === 503, r.json);
  } catch (e) {
    log('POST /api/flow/bootstrap forceChrome', false, String(e));
  }

  // 5) Wait 10s and recheck (extension reconnect / token harvest)
  console.log('\n… wait 12s for extension harvest …');
  await new Promise((r) => setTimeout(r, 12000));

  let after: Record<string, unknown> | null = null;
  try {
    const r = await getJson(`${BASE}/api/flow/status`);
    after = r.json as Record<string, unknown>;
    log('GET /api/flow/status after wait', r.status === 200, r.json);
  } catch (e) {
    log('GET /api/flow/status after wait', false, String(e));
  }

  // 6) Chrome processes with flow-profiles
  try {
    const { execSync } = await import('child_process');
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*flow-profiles*' } | Measure-Object | Select-Object -ExpandProperty Count"`,
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    );
    log('chrome flow-profiles process count', true, { count: out.trim() });
  } catch (e) {
    log('chrome flow-profiles process count', false, String(e));
  }

  // 7) Verdict
  const extOk = Boolean(after?.extensionConnected);
  const tokenOk = Boolean(after?.flowKeyPresent);
  const bridgeOk = Boolean(after?.running);
  const verdict = {
    bridgeRunning: bridgeOk,
    extensionConnected: extOk,
    flowKeyPresent: tokenOk,
    loginSessionOpen: after?.loginSessionOpen,
    readyToGen: bridgeOk && extOk && tokenOk,
    diagnosis: !bridgeOk
      ? 'Bridge down — start app (npm run dev / desktop)'
      : !extOk
        ? 'Extension NOT connected — Chrome opened without load-extension or user on normal Chrome'
        : !tokenOk
          ? 'Extension connected but NO ya29 token yet — login Google on Flow tab / wait harvest reload'
          : 'READY — can gen image/video via flow provider',
  };
  log('VERDICT', Boolean(verdict.readyToGen), verdict);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    steps,
    bootstrap: boot,
    finalStatus: after,
    verdict,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== REPORT WRITTEN ===', OUT);
  process.exit(verdict.readyToGen ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
