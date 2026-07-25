/**
 * Smoke: extension must not open extra Flow tabs mid Google login.
 * Static contracts on background.js + bootstrap harvest params.
 */
import fs from 'fs';
import path from 'path';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();
const bgPath = path.join(root, 'extensions', 'ainovel-flow', 'background.js');
const bootPath = path.join(root, 'src', 'lib', 'flow-bridge', 'bootstrap.ts');

const bg = fs.readFileSync(bgPath, 'utf8');
const boot = fs.readFileSync(bootPath, 'utf8');

console.log('[smoke-flow-no-extra-login-tab] start');

assert(
  bg.includes('function isGoogleAuthUrl'),
  'isGoogleAuthUrl helper present',
);
assert(
  bg.includes('function queryGoogleAuthTabs'),
  'queryGoogleAuthTabs present',
);
assert(
  bg.includes('accounts.google.com'),
  'detect accounts.google.com',
);
assert(
  bg.includes('Google login in progress'),
  'log when login blocks open',
);
assert(
  /allowCreate\s*=\s*true/.test(bg) || bg.includes('allowCreate = true'),
  'allowCreate option on ensureSingleFlowTab',
);
assert(
  bg.includes('allowCreate: false'),
  'init uses allowCreate:false',
);
assert(
  bg.includes('allowOpenTab: false'),
  'token-harvest alarm does not open tab',
);
assert(
  bg.includes('Status must NEVER create tabs') ||
    bg.includes('queryFlowTabs()') && bg.includes('loginInProgress'),
  'get_status does not ensureSingle create',
);
// get_status path uses query + dedupe only
assert(
  /const currentFlowTabs = await dedupeFlowTabs\(await queryFlowTabs\(\)\)/.test(
    bg,
  ),
  'get_status queries only (no ensure create)',
);
assert(
  bg.includes('loginInProgress: true'),
  'forceTokenHarvest returns loginInProgress when auth tabs open',
);

assert(
  boot.includes("allowOpenTab: false"),
  'bootstrap force_token_harvest allowOpenTab:false',
);
assert(
  boot.includes('reloadIfMissing: false'),
  'bootstrap does not reload mid-login',
);

// count force_token_harvest in bootstrap — all should pass allowOpenTab false
const harvestCalls = boot.match(
  /force_token_harvest[\s\S]{0,120}allowOpenTab:\s*false/g,
);
assert(
  harvestCalls && harvestCalls.length >= 2,
  `bootstrap harvest calls with allowOpenTab:false (got ${harvestCalls?.length || 0})`,
);

// Guard: extension-slow path must NOT kill+relaunch a 2nd login window
assert(
  boot.includes('không kill/relaunch') ||
    boot.includes('không mở browser thứ 2') ||
    boot.includes('KEEP the same window'),
  'bootstrap documents no 2nd login window when browser still open',
);
// Bad legacy pattern: "thử lại 1 lần (browser vẫn mở)" + immediate forceClean launch
assert(
  !/Extension chưa nối — thử lại 1 lần \(browser vẫn mở\)[\s\S]{0,200}forceClean:\s*true/.test(
    boot,
  ),
  'must not forceClean relaunch while browser still open (double window bug)',
);

const chromeSessionPath = path.join(
  root,
  'src',
  'lib',
  'flow-bridge',
  'chromeSession.ts',
);
const chromeSess = fs.readFileSync(chromeSessionPath, 'utf8');
assert(
  !/mode === 'login'[\s\S]{0,80}--new-window/.test(chromeSess),
  'login launch must not use --new-window (extra blank window)',
);

const bridgePath = path.join(root, 'src', 'lib', 'flow-bridge', 'bridgeServer.ts');
const bridge = fs.readFileSync(bridgePath, 'utf8');
// token_captured must not double-spawn background after closeLoginSessionAfterCapture
assert(
  bridge.includes('Background relaunch is owned by closeLoginSessionAfterCapture') ||
    bridge.includes('Single owner: minimize + kill login + background relaunch'),
  'token_captured documents single-owner background relaunch',
);

console.log('[smoke-flow-no-extra-login-tab] PASS');
console.log('  auth helpers + allowCreate/allowOpenTab + bootstrap harvest OK');
console.log('  no double-login relaunch + no --new-window + single bg owner OK');
