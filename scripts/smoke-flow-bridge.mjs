/**
 * Smoke: start bridge, hit /api/status on local HTTP port.
 * Does not require extension/token (those show as false).
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.chdir(root);

const require = createRequire(import.meta.url);

async function main() {
  // Dynamic import compiled path via tsx-less: call HTTP after ensuring server
  // We import the bridge through next is hard; call ports after spawning inline.

  const { ensureBridgeStarted, getBridgeSnapshot, FLOW_HTTP_PORT, FLOW_WS_PORT } =
    await import('../src/lib/flow-bridge/index.ts').catch(async () => {
      // fallback: register ts via jiti-less — use compiled require if needed
      console.log('[smoke-flow] Trying tsx loader path...');
      throw new Error(
        'Import TS failed. Run: npx tsx scripts/smoke-flow-bridge.mjs or start next and GET /api/flow/status',
      );
    });

  const snap = await ensureBridgeStarted();
  console.log('[smoke-flow] snapshot:', JSON.stringify(snap, null, 2));

  const res = await fetch(`http://127.0.0.1:${FLOW_HTTP_PORT}/api/status`);
  const json = await res.json();
  console.log('[smoke-flow] HTTP status', res.status, json.running, 'ws', FLOW_WS_PORT);

  if (!json.running && !snap.running) {
    console.error('[smoke-flow] FAIL: bridge not running');
    process.exit(1);
  }
  console.log('[smoke-flow] PASS: bridge listening');
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke-flow] ERROR', e);
  process.exit(1);
});
