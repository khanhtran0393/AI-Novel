import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, type, input, count, outputDir } = body;

    if (!platform || typeof platform !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "platform" parameter' }, { status: 400 });
    }
    if (!type || !['search', 'creator', 'detail'].includes(type)) {
      return NextResponse.json(
        { error: 'Missing or invalid "type" parameter. Must be "search", "creator", or "detail"' },
        { status: 400 },
      );
    }
    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "input" parameter' }, { status: 400 });
    }

    const resolvedOutputDir = outputDir || path.join(process.cwd(), 'public', 'downloads');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const gateway = await callNavGateway({
      action: 'download_video',
      payload: {
        platform,
        type,
        input,
        count,
        output_dir: resolvedOutputDir,
      },
      timeoutMs: 600_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'download_video failed', stderr: gateway.stderr || null },
        { status: 500 },
      );
    }

    return NextResponse.json(gateway.result ?? gateway);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 },
    );
  }
}