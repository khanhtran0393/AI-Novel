/**
 * Empirical: bootstrap with clean Chromium (Playwright/GPM), not stock Chrome.
 * Writes scratch/emp-flow-chromium-report.json
 */
import fs from 'fs';
import path from 'path';
import { resolveBrowser } from '../src/lib/flow-bridge/browserResolver';
import { bootstrapFlow } from '../src/lib/flow-bridge/bootstrap';
import { getBridgeSnapshot, ensureBridgeStarted } from '../src/lib/flow-bridge/bridgeServer';

const OUT = path.join(process.cwd(), 'scratch', 'emp-flow-chromium-report.json');

async function main() {
  const browser = resolveBrowser({ engine: 'auto' });
  console.log('=== EMP FLOW CLEAN CHROMIUM ===');
  console.log('browser:', browser.label);
  console.log('exe:', browser.exe);
  console.log('stock:', browser.isStockChrome);

  if (browser.isStockChrome) {
    console.error('FAIL: still resolved to stock Chrome');
    process.exit(2);
  }

  await ensureBridgeStarted();
  console.log('\n… bootstrap force (login window may open) …');
  const result = await bootstrapFlow({
    forceChrome: true,
    browserExe: browser.exe,
    engine: 'chromium',
    waitExtensionMs: 40000,
    waitLoginMs: 45000,
  });

  console.log('\n--- BOOTSTRAP STEPS ---');
  for (const s of result.steps) console.log(' ›', s);

  console.log('\n--- RESULT ---');
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        browserLabel: result.browserLabel,
        isStockChrome: result.isStockChrome,
        extensionConnected: result.extensionConnected,
        flowKeyPresent: result.flowKeyPresent,
        chromeLaunched: result.chromeLaunched,
        message: result.message,
      },
      null,
      2,
    ),
  );

  console.log('\n… wait 15s for harvest …');
  await new Promise((r) => setTimeout(r, 15000));
  const after = getBridgeSnapshot();
  console.log(
    '\n--- STATUS AFTER 15s ---',
    JSON.stringify(
      {
        running: after.running,
        extensionConnected: after.extensionConnected,
        flowKeyPresent: after.flowKeyPresent,
        loginSessionOpen: after.loginSessionOpen,
        projectId: after.projectId,
      },
      null,
      2,
    ),
  );

  // Also hit Next API if up
  let apiStatus: unknown = null;
  try {
    const r = await fetch('http://127.0.0.1:3000/api/flow/status');
    apiStatus = await r.json();
    console.log(
      '\n--- NEXT API STATUS ---',
      JSON.stringify(
        {
          extensionConnected: (apiStatus as { extensionConnected?: boolean })
            .extensionConnected,
          flowKeyPresent: (apiStatus as { flowKeyPresent?: boolean })
            .flowKeyPresent,
        },
        null,
        2,
      ),
    );
  } catch {
    console.log('\n--- NEXT API STATUS --- offline');
  }

  const verdict = {
    cleanBrowser: !browser.isStockChrome,
    extensionConnected: after.extensionConnected,
    flowKeyPresent: after.flowKeyPresent,
    readyToGen: after.extensionConnected && after.flowKeyPresent,
    diagnosis: !after.extensionConnected
      ? 'Extension still not connected — inspect chrome://extensions on spawned window'
      : !after.flowKeyPresent
        ? 'Extension OK — need Google login / Flow tab to emit ya29 token'
        : 'READY',
  };
  console.log('\n=== VERDICT ===', JSON.stringify(verdict, null, 2));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser,
        bootstrap: result,
        after,
        apiStatus,
        verdict,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('Report:', OUT);

  // Pass if clean browser used AND (extension connected OR launched with steps showing attempt)
  // Soft pass: clean browser + extension connected is ideal
  if (verdict.readyToGen) process.exit(0);
  if (verdict.extensionConnected) process.exit(0); // login may still be needed for token
  if (verdict.cleanBrowser && result.chromeLaunched) process.exit(3); // partial
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
