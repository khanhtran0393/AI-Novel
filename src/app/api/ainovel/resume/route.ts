import { NextResponse } from 'next/server';
import { startEngine } from '@/lib/novel-engine/runner';
import { logEngine } from '@/lib/novel-engine/bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Resume = start from progress/checkpoints (native, không 8080). */
export async function POST() {
  try {
    logEngine('⏯ RESUME requested — tiếp tục từ progress disk', 'info');
    const result = await startEngine();
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Resume failed' }, { status: 400 });
    }
    return NextResponse.json({ success: true, status: 'running', mode: 'resume', engine: 'native-ts' });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
