/**
 * Empirical smoke: start Flow bridge + HTTP status.
 * Does not require Chrome extension (token will be false).
 */
import {
  ensureBridgeStarted,
  FLOW_HTTP_PORT,
  FLOW_WS_PORT,
} from '../src/lib/flow-bridge';

async function main() {
  const snap = await ensureBridgeStarted();
  console.log(
    '[smoke-flow] snapshot',
    JSON.stringify(
      {
        running: snap.running,
        wsPort: snap.wsPort,
        httpPort: snap.httpPort,
        extensionConnected: snap.extensionConnected,
        flowKeyPresent: snap.flowKeyPresent,
      },
      null,
      2,
    ),
  );

  const res = await fetch(`http://127.0.0.1:${FLOW_HTTP_PORT}/api/status`);
  const json = (await res.json()) as { running?: boolean };
  console.log('[smoke-flow] HTTP', res.status, 'running=', json.running, 'WS', FLOW_WS_PORT);

  if (!json.running && !snap.running) {
    console.error('[smoke-flow] FAIL');
    process.exit(1);
  }
  console.log('[smoke-flow] PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke-flow] ERROR', e);
  process.exit(1);
});
