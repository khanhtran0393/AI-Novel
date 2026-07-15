/**
 * Standalone Flow bridge daemon (WS :9223 + HTTP :8101).
 * Run separately from Next so kill-Chrome / extension churn cannot take down the app.
 *
 *   npx tsx scripts/flow-bridge-daemon.mts
 */
import { ensureBridgeStarted, getBridgeSnapshot } from '../src/lib/flow-bridge/bridgeServer';
import { FLOW_HTTP_PORT, FLOW_WS_PORT } from '../src/lib/flow-bridge/config';

async function main() {
  const snap = await ensureBridgeStarted();
  console.log(
    `[FlowDaemon] up HTTP :${FLOW_HTTP_PORT} WS :${FLOW_WS_PORT}`,
    JSON.stringify({
      running: snap.running,
      ext: snap.extensionConnected,
      token: snap.flowKeyPresent,
    }),
  );
  setInterval(() => {
    const s = getBridgeSnapshot();
    console.log(
      `[FlowDaemon] heartbeat ext=${s.extensionConnected} token=${s.flowKeyPresent} queue=${s.queue.pending}`,
    );
  }, 60_000);
  // keep process alive
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('[FlowDaemon] fatal', e);
  process.exit(1);
});
