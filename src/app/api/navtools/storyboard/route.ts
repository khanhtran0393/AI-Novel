import { NextRequest, NextResponse } from 'next/server';
import { callNavGateway } from '@/lib/nav/navPythonBridge';
import { requireFeature } from '@/lib/commercial/apiGate';
import { resolveStoryboard } from '@/lib/commercial/ip/navAnalyzerCloudBridge';
import { extractEntitlementToken } from '@/lib/entitlement';
import { isCustomerPackagedRuntime } from '@/lib/commercial/licenseTrust';
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
    const idea = typeof body.idea === 'string' ? body.idea : body.text;
    if (!idea || !String(idea).trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing "idea" or "text"' },
        { status: 400 },
      );
    }

    const model =
      typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
    const keys = collectKeys(body);
    const token = extractEntitlementToken(req, body);
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
        if (!keys.length) {
          return NextResponse.json(
            {
              success: false,
              error: 'Storyboard: thiếu Gemini API key (cloud IP vẫn dùng key user BYOK).',
            },
            { status: 400 },
          );
        }
        const out = await resolveStoryboard(
          {
            idea: String(idea),
            model,
            apiKeys: keys,
            numScenes: Number(body.num_scenes ?? body.numScenes ?? 6) || 6,
            style: body.style ? String(body.style) : undefined,
          },
          { entitlementToken: token },
        );
        return NextResponse.json({
          success: true,
          scenes: out.scenes,
          source: out.source,
        });
      } catch (e) {
        if (preferCloud && isCustomerPackagedRuntime()) {
          return NextResponse.json(toErrorJson(e), {
            status: httpStatusFromError(e),
          });
        }
        if (process.env.AINOVEL_NAV_ANALYZER_CLOUD === '1') {
          return NextResponse.json(toErrorJson(e), {
            status: httpStatusFromError(e),
          });
        }
      }
    }

    const result = await callNavGateway({
      action: 'storyboard',
      payload: {
        idea,
        num_scenes: body.num_scenes ?? body.numScenes ?? 6,
        style: body.style,
        gemini_api_key: keys[0],
        model: model || undefined,
      },
      timeoutMs: 300_000,
    });

    const status = result.success ? 200 : 500;
    return NextResponse.json({ ...result, source: 'python_local' }, { status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
