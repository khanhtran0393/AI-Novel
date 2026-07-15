import { NextResponse } from 'next/server';
import {
  ensureBridgeStarted,
  getBridgeSnapshotAsync,
} from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureBridgeStarted();
    return NextResponse.json(await getBridgeSnapshotAsync());
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
