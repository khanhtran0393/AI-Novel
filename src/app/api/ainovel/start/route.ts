import { NextResponse } from 'next/server';
import { startEngine } from '@/lib/novel-engine/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await startEngine();
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Start failed' }, { status: 400 });
    }
    return NextResponse.json({ success: true, status: 'running', engine: 'native-ts' });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
