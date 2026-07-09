import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json({ success: false, error: 'Missing "url"' }, { status: 400 });
    }

    const result = await callNavGateway({
      action: 'youtube_analyze',
      payload: {
        url,
        gemini_api_key: body.gemini_api_key ?? body.apiKey,
      },
      timeoutMs: 900_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}