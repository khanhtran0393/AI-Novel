import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const idea = typeof body.idea === 'string' ? body.idea : body.text;
    if (!idea?.trim()) {
      return NextResponse.json({ success: false, error: 'Missing "idea" or "text"' }, { status: 400 });
    }

    const result = await callNavGateway({
      action: 'storyboard',
      payload: {
        idea,
        num_scenes: body.num_scenes ?? body.numScenes ?? 6,
        style: body.style,
        gemini_api_key: body.gemini_api_key ?? body.apiKey,
      },
      timeoutMs: 300_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}