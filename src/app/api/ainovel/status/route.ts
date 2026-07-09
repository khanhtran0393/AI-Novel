import { NextResponse } from 'next/server';
import { getRunnerMeta } from '@/lib/novel-engine/runner';
import { listChapters, getEngineRoot } from '@/lib/novel-engine/store/diskStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const meta = getRunnerMeta();
  return NextResponse.json({
    status: meta.status,
    lastAction: meta.lastAction,
    lastError: meta.lastError,
    progress: meta.progress,
    engine: meta.engine,
    independent: true,
    root: getEngineRoot(),
    chapterCount: listChapters().length,
  });
}
