import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { videoPath, outPath, model = 'small', language = 'auto' } = await req.json();

    if (!videoPath || typeof videoPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "videoPath" parameter' }, { status: 400 });
    }

    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: `Video file not found: ${videoPath}` }, { status: 400 });
    }

    const outputPath =
      typeof outPath === 'string' && outPath.trim()
        ? outPath.trim()
        : videoPath.replace(/\.[^.\\/]+$/, '.srt');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const result = await callNavGateway({
      action: 'subtitle',
      payload: {
        video_path: videoPath,
        out_path: outputPath,
        model: String(model),
        language: String(language),
      },
      timeoutMs: 600_000,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ...result,
      outPath: outputPath,
    });
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return NextResponse.json(
      { success: false, error: err.message, stderr: err.stderr || null },
      { status: 500 },
    );
  }
}