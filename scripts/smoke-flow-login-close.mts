/**
 * Smoke: closeLoginSessionAfterCapture contracts (no real Chrome required).
 * - No session → closed:false
 * - Kill path logic exported & force option typed
 */
import {
  closeLoginSessionAfterCapture,
  getChromeSessionInfo,
  listSessions,
} from '../src/lib/flow-bridge/chromeSession.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  console.log('[smoke-flow-login-close] start');

  const empty = await closeLoginSessionAfterCapture({
    accountId: '__no_such_profile_smoke__',
    keepBackground: true,
  });
  console.log('  no-session →', empty);
  assert(empty.closed === false, 'missing account should not claim closed');
  assert(
    /No session|No tracked/i.test(empty.message),
    `message should mention missing session, got: ${empty.message}`,
  );

  const info = getChromeSessionInfo('__no_such_profile_smoke__');
  console.log('  session info missing →', info);
  assert(info.loginOpen === false, 'loginOpen false for missing');
  assert(info.loginPidAlive === false, 'loginPidAlive false');

  const sessions = listSessions();
  console.log(`  tracked sessions: ${sessions.length}`);

  // force + no meta should still be safe
  const forced = await closeLoginSessionAfterCapture({
    accountId: '__no_such_profile_smoke__',
    force: true,
    keepBackground: false,
  });
  console.log('  force no-session →', forced);
  assert(forced.closed === false, 'force still false without session');

  console.log('[smoke-flow-login-close] PASS');
}

main().catch((e) => {
  console.error('[smoke-flow-login-close] FAIL', e);
  process.exit(1);
});
