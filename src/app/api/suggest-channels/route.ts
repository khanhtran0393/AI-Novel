import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'multi_channel', body);
    if (denied) return denied;
    const { keyword, platform } = body;

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "keyword" parameter' }, { status: 400 });
    }

    if (platform && platform !== 'youtube') {
      return NextResponse.json({ error: 'Only "youtube" platform is supported currently' }, { status: 400 });
    }

    const gateway = await callNavGateway({
      action: 'suggest_channels',
      payload: { keyword },
      timeoutMs: 300_000,
    });

    if (!gateway.success) {
      return NextResponse.json(
        { error: gateway.error || 'suggest_channels failed', stderr: gateway.stderr || null },
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
