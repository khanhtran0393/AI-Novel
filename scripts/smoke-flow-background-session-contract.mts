/**
 * Smoke: Flow login is visible-only, then generation reuses/launches background.
 * No browser/network required. This guards against:
 * - hidden login bootstrap during image/video generation
 * - force-clean background bootstrap that kills/reopens profiles while switching
 * - background launch spawning another Chrome when a managed profile is alive
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

console.log('[smoke-flow-background-session-contract] start');

const bootstrap = read('src/lib/flow-bridge/bootstrap.ts');
const chromeSession = read('src/lib/flow-bridge/chromeSession.ts');
const extensionBackground = read('extensions/ainovel-flow/background.js');
const imageProvider = read('src/app/api/generate-image/providers/flow.ts');
const videoRoute = read('src/app/api/generate-video/route.ts');
const queue = read('src/lib/flow-bridge/queueEngine.ts');
const bootstrapRoute = read('src/app/api/flow/bootstrap/route.ts');
const preflight = read('src/app/workspace/modules/flowSessionPreflight.ts');
const mediaToolbar = read('src/app/workspace/features/media/MediaToolbarButton.tsx');
const flowAccountsPanel = read('src/app/workspace/features/media/FlowAccountsPanel.tsx');

assert(
  bootstrap.includes("forceClean: launchMode === 'login' || freshSession"),
  'bootstrap force-cleans only visible login/fresh sessions',
);
assert(
  bootstrap.includes('forceVisibleLogin') &&
    bootstrap.includes("opts?.mode !== 'background'"),
  'forceChrome cannot turn background bootstrap into visible-login semantics',
);
assert(
  chromeSession.includes('Reuse existing background browser') &&
    chromeSession.includes("opts.mode === 'background'") &&
    chromeSession.includes('opts.forceClean === false'),
  'launchChrome reuses an alive managed background profile',
);
assert(
  chromeSession.includes('--window-position=-32000,-32000') &&
    chromeSession.includes('--disable-renderer-backgrounding') &&
    !chromeSession.includes('--window-size=10,10'),
  'background Chromium launches runnable off-screen, not tiny/minimized on-screen-prone',
);
assert(
  extensionBackground.includes('HIDDEN_FLOW_WINDOW_BOUNDS') &&
    extensionBackground.includes('...HIDDEN_FLOW_WINDOW_BOUNDS') &&
    extensionBackground.includes('Human captcha path only.') &&
    extensionBackground.includes('Keep the Flow tab active inside its hidden window'),
  'extension parks non-focus generation windows off-screen',
);
assert(
  !/else if \(win\)[\s\S]{0,260}left:\s*80/.test(extensionBackground),
  'non-focus wake path never moves Chromium to visible coordinates',
);
assert(
  !/syncAccountIdentity[\s\S]{0,900}active:\s*true/.test(extensionBackground),
  'sync_account does not create an active visible Flow tab',
);

for (const [name, src] of [
  ['image provider', imageProvider],
  ['video route', videoRoute],
] as const) {
  assert(
    !/forceChrome:\s*!sessionReady[\s\S]{0,180}mode:\s*['"]background['"]/.test(src),
    `${name} does not request forceChrome for hidden background generation`,
  );
  assert(
    src.includes('isVerifiedFlowAccountSession') &&
      src.includes('isLiveFlowGenerationSession'),
    `${name} separates stored login from live background readiness`,
  );
}

assert(
  !/forceChrome:\s*true[\s\S]{0,180}mode:\s*['"]background['"]/.test(queue),
  'queue recovery never force-cleans a background bootstrap',
);
assert(
  bootstrapRoute.includes("body.mode === 'background'") &&
    bootstrapRoute.includes("body.mode === 'login'") &&
    bootstrapRoute.includes('mode: requestedMode'),
  'bootstrap API accepts explicit login/background mode',
);
assert(
  preflight.includes('needsVisibleLogin') &&
    preflight.includes("mode: needsVisibleLogin ? 'login' : 'background'"),
  'client preflight opens visible login only when login is actually needed',
);
for (const [name, src] of [
  ['media toolbar', mediaToolbar],
  ['Flow accounts panel', flowAccountsPanel],
] as const) {
  assert(
    src.includes('capabilities?.canGenerateImage') &&
      src.includes('capabilities?.canGenerateVideo') &&
      src.includes('projectReady'),
    `${name} ready badge requires generation capability/project`,
  );
}

console.log('[smoke-flow-background-session-contract] PASS');
