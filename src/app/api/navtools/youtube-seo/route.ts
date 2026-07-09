import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Missing "text"' }, { status: 400 });
    }

    const result = await callNavGateway({
      action: 'youtube_seo',
      payload: {
        text,
        novel_title: body.novelTitle ?? body.novel_title ?? '',
        gemini_api_key: body.gemini_api_key ?? body.apiKey,
      },
      timeoutMs: 120_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}