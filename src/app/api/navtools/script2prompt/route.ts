import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';
import { resolveScript2Prompt } from '@/lib/commercial/ip/navAnalyzerCloudBridge';
import { extractEntitlementToken } from '@/lib/entitlement';
import {
  isCustomerPackagedRuntime,
} from '@/lib/commercial/licenseTrust';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

function collectKeys(body: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (typeof body.gemini_api_key === 'string' && body.gemini_api_key.trim()) {
    keys.push(body.gemini_api_key.trim());
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) keys.push(body.apiKey.trim());
  if (Array.isArray(body.apiKeys)) {
    for (const k of body.apiKeys) {
      if (typeof k === 'string' && k.trim()) keys.push(k.trim());
    }
  }
  return [...new Set(keys)];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const text = typeof body.text === 'string' ? body.text : '';

    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Missing "text"' }, { status: 400 });
    }

    const model =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : '';
    const keys = collectKeys(body);
    const token = extractEntitlementToken(req, body);

    // Packaged Pro path: cloud crown IP (fail-closed without token)
    const preferCloud =
      isCustomerPackagedRuntime() ||
      process.env.AINOVEL_NAV_ANALYZER_CLOUD === '1' ||
      process.env.AINOVEL_NAV_ANALYZER_CLOUD === 'true';

    if (preferCloud || keys.length > 0) {
      try {
        if (!model) {
          return NextResponse.json(
            {
              success: false,
              error: 'Missing "model" (Gemini model is required; no fallback)',
            },
            { status: 400 },
          );
        }
        if (!keys.length && preferCloud) {
          // Cloud still needs user Gemini keys forwarded in body for generation
          return NextResponse.json(
            {
              success: false,
              error: 'Script2Prompt: thiếu Gemini API key (cloud IP vẫn dùng key user BYOK).',
            },
            { status: 400 },
          );
        }
        const out = await resolveScript2Prompt(
          {
            text,
            model,
            apiKeys: keys,
            numScenes: Number(body.num_scenes ?? body.sceneCount ?? 8) || 8,
            stylePreset: String(body.style_preset ?? body.stylePreset ?? ''),
            globalContext: String(body.global_context ?? body.globalContext ?? ''),
            characterAliases: Array.isArray(body.character_aliases)
              ? (body.character_aliases as unknown[]).map(String)
              : Array.isArray(body.characterAliases)
                ? (body.characterAliases as unknown[]).map(String)
                : [],
            voiceGender: String(body.voice_gender ?? body.voiceGender ?? ''),
            narrationLang: String(body.narration_lang ?? body.narrationLang ?? 'Vietnamese'),
            autoDetectScenes: Boolean(body.auto_detect_scenes ?? body.autoDetectScenes),
          },
          { entitlementToken: token },
        );
        return NextResponse.json({
          success: true,
          result: out.result,
          source: out.source,
        });
      } catch (e) {
        // Packaged: hard-fail cloud (B10) — no silent python swap for crown
        if (preferCloud && isCustomerPackagedRuntime()) {
          return NextResponse.json(toErrorJson(e), {
            status: httpStatusFromError(e),
          });
        }
        // Dev without cloud force: fall through to local Python
        if (process.env.AINOVEL_NAV_ANALYZER_CLOUD === '1') {
          return NextResponse.json(toErrorJson(e), {
            status: httpStatusFromError(e),
          });
        }
      }
    }

    const result = await callNavGateway({
      action: 'script2prompt',
      payload: {
        text,
        gemini_api_key: keys[0],
        model: model || undefined,
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
    return NextResponse.json({ ...result, source: 'python_local' }, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
