import { NextResponse } from 'next/server';
import {
  ensureBridgeStarted,
  getBridgeSnapshot,
  getBridgeSnapshotAsync,
  isBridgeRunning,
} from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Status poll (UI). Bridge đã chạy → chỉ đọc snapshot (không re-init).
 * Lần đầu / chưa chạy → ensureBridgeStarted một lần.
 */
export async function GET() {
  try {
    if (!isBridgeRunning()) {
      await ensureBridgeStarted();
    }
    // Prefer async snapshot when adopted remote daemon
    const snap = isBridgeRunning()
      ? await getBridgeSnapshotAsync()
      : getBridgeSnapshot();
    return NextResponse.json(snap);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        running: false,
      },
      { status: 500 },
    );
  }
}
