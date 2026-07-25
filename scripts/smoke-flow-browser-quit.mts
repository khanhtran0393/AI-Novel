/**
 * Smoke: Flow browsers must be killable on app quit (detached spawn otherwise orphans).
 * No live Chrome required — contracts + optional live kill under accounts_data needle.
 */
import fs from 'fs';
import path from 'path';
import {
  killAllFlowBrowsers,
  killChromeByPathNeedles,
  killChromeForProfile,
  listSessions,
  registerFlowBrowserShutdownHooks,
} from '../src/lib/flow-bridge/chromeSession.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function main() {
  console.log('[smoke-flow-browser-quit] start');

  assert(typeof killAllFlowBrowsers === 'function', 'killAllFlowBrowsers export');
  assert(typeof killChromeByPathNeedles === 'function', 'killChromeByPathNeedles export');
  assert(typeof killChromeForProfile === 'function', 'killChromeForProfile export');
  assert(
    typeof registerFlowBrowserShutdownHooks === 'function',
    'registerFlowBrowserShutdownHooks export',
  );

  // Safe no-op path (non-existent dir)
  const ghost = path.join(process.cwd(), 'accounts_data', '__smoke_no_such_profile__');
  const n1 = killChromeForProfile(ghost);
  assert(n1 === 0, `ghost profile kill should be 0, got ${n1}`);

  const n2 = killChromeByPathNeedles([]);
  assert(n2 === 0, 'empty needles → 0');

  registerFlowBrowserShutdownHooks();
  registerFlowBrowserShutdownHooks(); // idempotent

  const before = listSessions().length;
  const r = killAllFlowBrowsers({ reason: 'smoke-flow-browser-quit' });
  assert(typeof r.killed === 'number', 'result.killed number');
  assert(Array.isArray(r.needles) && r.needles.length >= 2, 'needles include profile roots');
  assert(
    r.needles.some((n) => /accounts_data$/i.test(n) || n.includes(`${path.sep}accounts_data`)),
    `needles should include accounts_data, got ${JSON.stringify(r.needles.slice(0, 5))}`,
  );
  assert(listSessions().length === 0, 'sessions cleared after killAll');
  console.log(
    `  killAll → killed=${r.killed} needles=${r.needles.length} sessionsBefore=${before}`,
  );

  // Source contract: main.js must call kill on quit
  const mainJs = fs.readFileSync(path.join(process.cwd(), 'main.js'), 'utf8');
  assert(
    /function killFlowBrowsersOnAppQuit/.test(mainJs),
    'main.js defines killFlowBrowsersOnAppQuit',
  );
  assert(
    /killFlowBrowsersOnAppQuit\(['"]before-quit['"]\)/.test(mainJs),
    'before-quit calls killFlowBrowsersOnAppQuit',
  );
  assert(
    /killFlowBrowsersOnAppQuit\(reason/.test(mainJs) ||
      /killFlowBrowsersOnAppQuit\(reason \|\|/.test(mainJs),
    'quitAppFully calls killFlowBrowsersOnAppQuit',
  );
  assert(
    /accounts_data/.test(mainJs) && /flow-profiles/.test(mainJs),
    'main.js needles cover accounts_data + flow-profiles',
  );

  // Source contract: chromeSession detached is still true (we kill on quit, not attach)
  const chromeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/flow-bridge/chromeSession.ts'),
    'utf8',
  );
  assert(/detached:\s*true/.test(chromeSrc), 'launch still detached (gen needs independent life)');
  assert(/killAllFlowBrowsers/.test(chromeSrc), 'killAllFlowBrowsers defined');
  assert(/registerFlowBrowserShutdownHooks/.test(chromeSrc), 'hooks defined');

  console.log('[smoke-flow-browser-quit] PASS');
}

main();
