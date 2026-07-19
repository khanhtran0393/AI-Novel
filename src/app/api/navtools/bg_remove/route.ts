import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const { imagePath, outPath, color } = body;

    if (!imagePath || !outPath) {
      return NextResponse.json(
        { success: false, error: 'Missing imagePath or outPath' },
        { status: 400 },
      );
    }

    const result = await callNavGateway({
      action: 'bg_remove',
      payload: {
        image_path: imagePath,
        out_path: outPath,
        color: color ?? '',
      },
      timeoutMs: 300_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json({ ...result, outPath }, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}