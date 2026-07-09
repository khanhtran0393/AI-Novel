import { NextResponse } from 'next/server';
import { stopEngine } from '@/lib/novel-engine/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  await stopEngine();
  return NextResponse.json({ success: true, status: 'stopped', engine: 'native-ts' });
}
