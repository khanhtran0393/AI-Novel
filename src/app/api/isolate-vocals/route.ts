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
    const { audioPath, outputDir } = body;

    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "audioPath" parameter' }, { status: 400 });
    }
    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioPath}` }, { status: 400 });
    }

    const resolvedOutputDir = outputDir || path.join(process.cwd(), 'public', 'isolated');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const gateway = await callNavGateway({
      action: 'isolate_vocals',
      payload: { audio_path: audioPath, output_dir: resolvedOutputDir },
      timeoutMs: 600_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'isolate_vocals failed', stderr: gateway.stderr || null },
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