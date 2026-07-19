import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const text = typeof body.text === 'string' ? body.text : '';

    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Missing "text"' }, { status: 400 });
    }

    const result = await callNavGateway({
      action: 'script2prompt',
      payload: {
        text,
        gemini_api_key: body.gemini_api_key || body.apiKey,
        num_scenes: body.num_scenes ?? body.sceneCount ?? 8,
        style_preset: body.style_preset ?? body.stylePreset,
        global_context: body.global_context ?? body.globalContext ?? '',
        character_aliases: body.character_aliases ?? body.characterAliases ?? [],
        voice_gender: body.voice_gender ?? body.voiceGender ?? '',
        narration_lang: body.narration_lang ?? body.narrationLang ?? 'Vietnamese',
        auto_detect_scenes: Boolean(body.auto_detect_scenes ?? body.autoDetectScenes),
      },
      timeoutMs: 600_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}