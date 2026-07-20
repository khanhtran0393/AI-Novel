import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const { videoPath, targetDuration, outputDir } = body;

    if (!videoPath || typeof videoPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "videoPath" parameter' }, { status: 400 });
    }
    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: `Video file not found: ${videoPath}` }, { status: 400 });
    }

    const resolvedTargetDuration = Number(targetDuration);
    if (!Number.isFinite(resolvedTargetDuration) || resolvedTargetDuration <= 0) {
      return NextResponse.json({ error: 'Missing or invalid "targetDuration" parameter' }, { status: 400 });
    }

    const resolvedOutputDir = outputDir || path.join(process.cwd(), 'public', 'splits');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const gateway = await callNavGateway({
      action: 'split_video',
      payload: {
        video_path: videoPath,
        target_duration: resolvedTargetDuration,
        output_dir: resolvedOutputDir,
      },
      timeoutMs: 300_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'split_video failed', stderr: gateway.stderr || null },
        { status: 500 },
      );
    }

    const result = gateway.result ?? gateway;
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 },
    );
  }
}