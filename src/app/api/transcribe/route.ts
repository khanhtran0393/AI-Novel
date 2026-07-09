import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioPath, language, outputDir } = body;

    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "audioPath" parameter' }, { status: 400 });
    }
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioPath}` }, { status: 400 });
    }

    const resolvedLanguage = language || 'vi';
    const resolvedOutputDir =
      typeof outputDir === 'string' && outputDir.trim()
        ? outputDir.trim()
        : path.join(process.cwd(), 'public', 'transcripts');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const gateway = await callNavGateway({
      action: 'transcribe',
      payload: {
        audio_path: audioPath,
        language: resolvedLanguage,
        output_dir: resolvedOutputDir,
      },
      timeoutMs: 600_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'transcribe failed', stderr: gateway.stderr || null },
        { status: 500 },
      );
    }

    const result = (gateway.result as Record<string, unknown>) || {};
    if (gateway.srt_path) result.srtPath = gateway.srt_path;
    if (gateway.srt) result.srt = gateway.srt;

    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 },
    );
  }
}