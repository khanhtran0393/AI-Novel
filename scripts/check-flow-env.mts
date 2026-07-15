/**
 * Validate Flow RPA environment (map environment_setup_guide.md → AI Novel).
 * Exit 0 = minimum OK (bridge files + extension). Exit 2 = missing critical pieces.
 */
import fs from 'fs';
import path from 'path';
import {
  listDetectedBrowsers,
  portableChromiumInstallHint,
  resolveBrowser,
} from '../src/lib/flow-bridge/browserResolver';

const ROOT = process.cwd();
const lines: string[] = [];
let fails = 0;

function ok(name: string, pass: boolean, detail = '') {
  const mark = pass ? 'OK  ' : 'FAIL';
  if (!pass) fails++;
  const msg = `[${mark}] ${name}${detail ? ' — ' + detail : ''}`;
  lines.push(msg);
  console.log(msg);
}

async function probe(url: string): Promise<{ ok: boolean; body?: unknown }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, body: j };
  } catch {
    return { ok: false };
  }
}

async function main() {
  console.log('=== FLOW ENVIRONMENT CHECK (AI Novel) ===\n');
  console.log('cwd:', ROOT, '\n');

  // 1 Extension zone
  const ext = path.join(ROOT, 'extensions', 'ainovel-flow');
  const need = ['manifest.json', 'background.js', 'content.js', 'injected.js'];
  for (const f of need) {
    ok(`extension/${f}`, fs.existsSync(path.join(ext, f)));
  }
  const bg = fs.existsSync(path.join(ext, 'background.js'))
    ? fs.readFileSync(path.join(ext, 'background.js'), 'utf8')
    : '';
  ok('background.js → ws 9223', bg.includes('9223'));
  ok('background.js → forceTokenHarvest', bg.includes('forceTokenHarvest'));

  // 2 Backend zone
  const core = [
    'src/lib/flow-bridge/bridgeServer.ts',
    'src/lib/flow-bridge/queueEngine.ts',
    'src/lib/flow-bridge/chromeSession.ts',
    'src/lib/flow-bridge/browserResolver.ts',
    'src/lib/flow-bridge/bootstrap.ts',
    'src/app/api/flow/status/route.ts',
    'src/app/api/flow/bootstrap/route.ts',
  ];
  for (const f of core) {
    ok(f, fs.existsSync(path.join(ROOT, f)));
  }

  // 3 Accounts / profiles zone
  const profiles = path.join(ROOT, 'scratch', 'flow-profiles');
  const accountsMeta = path.join(ROOT, 'data', 'flow-bridge', 'accounts.json');
  ok('scratch/flow-profiles (accounts_data)', fs.existsSync(profiles) || true, profiles);
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'data', 'flow-bridge'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'image_output'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'veo_output'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public', 'images'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public', 'video'), { recursive: true });
  ok('output dirs (images/video/image_output/veo_output)', true);
  ok(
    'data/flow-bridge/accounts.json',
    fs.existsSync(accountsMeta),
    fs.existsSync(accountsMeta) ? 'exists' : 'will create on first bootstrap',
  );

  // 4 Browsers
  const detected = listDetectedBrowsers();
  ok(
    'ít nhất 1 browser',
    detected.length > 0,
    detected.map((b) => b.label).join(' | ') || 'none',
  );
  const clean = detected.filter((b) => b.family === 'chromium' && !b.isStockChrome);
  ok(
    'Chromium sạch (Ungoogled/Brave/portable)',
    clean.length > 0,
    clean.length
      ? clean.map((b) => b.exe).join(' | ')
      : 'THIẾU — xem tools/browsers/README.md',
  );
  try {
    const r = resolveBrowser({ engine: 'auto' });
    ok(
      `resolve auto → ${r.label}`,
      true,
      `${r.exe}${r.isStockChrome ? ' [STOCK ⚠]' : ' [CLEAN]'}`,
    );
  } catch (e) {
    ok('resolve auto', false, String(e));
  }

  // 5 Live bridge / Next
  const st8101 = await probe('http://127.0.0.1:8101/api/status');
  ok(
    'Bridge :8101',
    st8101.ok,
    st8101.ok
      ? JSON.stringify({
          running: (st8101.body as { running?: boolean })?.running,
          extensionConnected: (st8101.body as { extensionConnected?: boolean })
            ?.extensionConnected,
          flowKeyPresent: (st8101.body as { flowKeyPresent?: boolean })
            ?.flowKeyPresent,
        })
      : 'offline (start app: npm run dev)',
  );
  const st3000 = await probe('http://127.0.0.1:3000/api/flow/status');
  ok(
    'Next /api/flow/status :3000',
    st3000.ok,
    st3000.ok
      ? JSON.stringify({
          extensionConnected: (st3000.body as { extensionConnected?: boolean })
            ?.extensionConnected,
          flowKeyPresent: (st3000.body as { flowKeyPresent?: boolean })
            ?.flowKeyPresent,
        })
      : 'offline',
  );

  console.log('\n--- INIT ORDER (guide) ---');
  console.log('1) npm run dev  → bridge WS 9223 + HTTP 8101');
  console.log('2) Engine Auto/Ungoogled → Đăng nhập Google (spawn browser)');
  console.log('3) chrome://extensions → Inspect service worker (debug)');
  console.log('4) token → auto-close login → gen flow');

  if (clean.length === 0) {
    console.log('\n--- INSTALL HINT ---');
    console.log(portableChromiumInstallHint());
  }

  const reportPath = path.join(ROOT, 'scratch', 'flow-env-check-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        fails,
        lines,
        detected,
        bridge: st8101.body ?? null,
        next: st3000.body ?? null,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nReport:', reportPath);
  console.log(fails === 0 ? '\n=== ENV CHECK PASS ===' : `\n=== ENV CHECK: ${fails} issue(s) ===`);
  process.exit(fails > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
