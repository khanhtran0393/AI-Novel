/**
 * Cloud Dịch SRT crown — rule descriptions + Cap-style Gemini prompt kernel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildTranslatePromptLocal } from '@/lib/commercial/ip/translateCloudBridge';
import {
  assertCloudIpFeature,
  assertCloudIpToken,
} from '@/lib/commercial/ip/cloudIpAuth';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

const ACTIONS = new Set(['build_prompt', 'capabilities']);

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'cloud-ip-translate',
    actions: [...ACTIONS],
    note: 'POST build_prompt — toolbox_labs + trial|pro. Gemini BYOK still on desktop.',
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { success: false, error: `Unknown action «${action}»` },
        { status: 400 },
      );
    }
    if (action === 'capabilities') {
      assertCloudIpToken(req, body, 'trial');
      return NextResponse.json({
        success: true,
        result: { actions: ['build_prompt'], host: 'cloud' },
      });
    }
    const claims = assertCloudIpToken(req, body, 'trial');
    assertCloudIpFeature(claims, 'toolbox_labs');
    const input = body.input ?? body.payload ?? body;
    const result = buildTranslatePromptLocal(input);
    return NextResponse.json({
      success: true,
      result: { ...result, source: 'cloud' },
      source: 'cloud',
    });
  } catch (error: unknown) {
    return NextResponse.json(toErrorJson(error), {
      status: httpStatusFromError(error),
    });
  }
}
