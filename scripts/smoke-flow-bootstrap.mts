/**
 * Empirical: full bootstrap (bridge + default account + optional chrome).
 * forceChrome=false to avoid spamming windows in CI; still creates account.
 */
import { bootstrapFlow } from '../src/lib/flow-bridge/bootstrap';

async function main() {
  const force = process.argv.includes('--chrome');
  console.log('[smoke-bootstrap] forceChrome=', force);
  const r = await bootstrapFlow({
    forceChrome: force,
    waitExtensionMs: force ? 15000 : 3000,
  });
  console.log(
    JSON.stringify(
      {
        ok: r.ok,
        bridgeRunning: r.bridgeRunning,
        extensionConnected: r.extensionConnected,
        flowKeyPresent: r.flowKeyPresent,
        chromeLaunched: r.chromeLaunched,
        accountId: r.accountId,
        chromePath: r.chromePath,
        message: r.message,
        steps: r.steps,
      },
      null,
      2,
    ),
  );
  if (!r.accountId) {
    console.error('[smoke-bootstrap] FAIL: no account');
    process.exit(1);
  }
  if (!r.ok && !r.chromeLaunched && !r.bridgeRunning) {
    console.error('[smoke-bootstrap] FAIL: bootstrap');
    process.exit(1);
  }
  console.log('[smoke-bootstrap] PASS (auto-setup prepared)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
