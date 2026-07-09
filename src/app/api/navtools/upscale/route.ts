import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { imagePath, outPath, targetHeight } = await req.json();

    if (!imagePath || !outPath) {
      return NextResponse.json(
        { success: false, error: 'Missing imagePath or outPath' },
        { status: 400 },
      );
    }

    const result = await callNavGateway({
      action: 'upscale',
      payload: {
        image_path: imagePath,
        out_path: outPath,
        target_height: targetHeight ?? 0,
      },
      timeoutMs: 300_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json(
      {
        ...result,
        outPath,
      },
      { status },
    );
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}