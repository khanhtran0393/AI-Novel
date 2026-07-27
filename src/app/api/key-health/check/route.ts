import { NextRequest, NextResponse } from 'next/server';
import { checkAllKeysHealth } from '@/lib/keyHealthTracker';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { keys?: string[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];

    const statuses = await checkAllKeysHealth(keys);

    return NextResponse.json({
      success: true,
      keys: statuses,
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Key health check failed.',
      },
      { status: 500 },
    );
  }
}
