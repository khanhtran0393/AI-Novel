import { NextResponse } from 'next/server';
import {
  ensureBridgeStarted,
  getBridgeSnapshot,
  getQueue,
  isBridgeRunning,
} from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Instant health for UI / hang probes (does not call extension).
 * Prefer this over long /api/flow/status when only need liveness.
 */
export async function GET() {
  try {
    if (!isBridgeRunning()) {
      await ensureBridgeStarted();
    }
    const snap = getBridgeSnapshot();
    const queue = getQueue().snapshot();
    return NextResponse.json({
      ok: true,
      ts: Date.now(),
      running: snap.running,
      extensionConnected: snap.extensionConnected,
      flowKeyPresent: snap.flowKeyPresent,
      tokenAgeMs: snap.tokenAgeMs ?? null,
      credits: snap.identity?.credits ?? null,
      queuePending: queue.pending,
      queueRunning: queue.running,
      lastError: snap.metrics?.lastError ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        ts: Date.now(),
      },
      { status: 500 },
    );
  }
}
