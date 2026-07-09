import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

function resolveWatermarkOutputPath(audioPath: string, outputPath?: unknown): string {
  const defaultName = `watermarked_${path.basename(audioPath)}`;
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    return path.join(process.cwd(), 'public', 'watermarked', defaultName);
  }

  const trimmed = outputPath.trim();
  const looksLikeDirectory =
    trimmed.endsWith('/') ||
    trimmed.endsWith('\\') ||
    (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) ||
    path.extname(trimmed) === '';

  return looksLikeDirectory ? path.join(trimmed, defaultName) : trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioPath, mode, outputPath } = body;

    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "audioPath" parameter' }, { status: 400 });
    }
    if (!mode || !['embed', 'detect'].includes(mode)) {
      return NextResponse.json(
        { error: 'Missing or invalid "mode" parameter. Must be "embed" or "detect"' },
        { status: 400 },
      );
    }
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioPath}` }, { status: 400 });
    }

    const resolvedOutputPath = mode === 'embed' ? resolveWatermarkOutputPath(audioPath, outputPath) : '';
    if (mode === 'embed') {
      fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    }

    const gateway = await callNavGateway({
      action: 'watermark_audio',
      payload: {
        audio_path: audioPath,
        mode,
        output_path: resolvedOutputPath || undefined,
      },
      timeoutMs: 300_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'watermark_audio failed', stderr: gateway.stderr || null },
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