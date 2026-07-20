import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!url) {
      return NextResponse.json({ success: false, error: 'Missing "url"' }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ success: false, error: 'Missing "model"' }, { status: 400 });
    }

    const result = await callNavGateway({
      action: 'youtube_analyze',
      payload: {
        url,
        model,
        gemini_api_key: body.gemini_api_key ?? body.apiKey,
      },
      timeoutMs: 900_000,
    });

    // Optional visual watch layer (claude-video) — non-blocking enrichment
    let watch: { success?: boolean; frameCount?: number; reportPreview?: string } | undefined;
    try {
      const { watchRepoReady, runWatch } = await import('@/lib/integrations/watchVideo');
      if (watchRepoReady() && (body.includeWatch !== false)) {
        const w = await runWatch({
          source: url,
          detail: 'efficient',
          maxFrames: 16,
          noWhisper: true,
          timeoutMs: 120_000,
        });
        watch = {
          success: w.success,
          frameCount: w.framePaths?.length ?? 0,
          reportPreview: (w.report || '').slice(0, 2500),
        };
      }
    } catch (e) {
      watch = { success: false, reportPreview: (e as Error).message };
    }

    const status = result.success ? 200 : 500;
    return NextResponse.json({ ...result, watch }, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
