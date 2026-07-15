import { NextRequest, NextResponse } from 'next/server';
import {
  buildWatchQcBrief,
  runWatch,
  runWatchSetupCheck,
  watchRepoReady,
  type WatchDetail,
} from '@/lib/integrations/watchVideo';

export const runtime = 'nodejs';

export async function GET() {
  const ready = watchRepoReady();
  const setup = ready ? await runWatchSetupCheck() : { ok: false, output: 'watch repo missing' };
  return NextResponse.json({ success: true, ready, setup });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source = String(body.source || body.url || body.path || '').trim();
    if (!source) {
      return NextResponse.json({ success: false, error: 'Missing source (url or path)' }, { status: 400 });
    }

    const detail = (body.detail || 'efficient') as WatchDetail;
    const result = await runWatch({
      source,
      detail,
      start: body.start,
      end: body.end,
      maxFrames: body.maxFrames ?? (detail === 'efficient' ? 24 : 40),
      noWhisper: body.noWhisper !== false,
      outDir: body.outDir,
      timeoutMs: body.timeoutMs ?? 300_000,
    });

    const qcBrief = buildWatchQcBrief({
      report: result.report,
      question: body.question,
      chapterTitle: body.chapterTitle,
    });

    return NextResponse.json({
      ...result,
      qcBrief,
    });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
