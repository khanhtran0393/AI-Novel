/**
 * Cloud NAV analyzer IP — script2prompt + storyboard crown planners.
 * Desktop packaged builds call this via pinned license API host.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  runScript2PromptLocal,
  runStoryboardLocal,
  type Script2PromptInput,
  type StoryboardInput,
} from '@/lib/commercial/ip/navAnalyzerCrown';
import {
  assertCloudIpFeature,
  assertCloudIpToken,
} from '@/lib/commercial/ip/cloudIpAuth';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 180;

const ACTIONS = new Set(['script2prompt', 'storyboard', 'capabilities']);

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'cloud-ip-nav-analyzer',
    actions: [...ACTIONS],
    note: 'POST with x-ainovel-entitlement (trial|pro). toolbox_labs.',
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
        result: {
          actions: ['script2prompt', 'storyboard'],
          host: 'cloud',
        },
      });
    }

    const claims = assertCloudIpToken(req, body, 'trial');
    assertCloudIpFeature(claims, 'toolbox_labs');

    const input = (body.input ?? body.payload ?? body) as Record<string, unknown>;

    if (action === 'script2prompt') {
      const result = await runScript2PromptLocal(input as Script2PromptInput);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }
    if (action === 'storyboard') {
      const result = await runStoryboardLocal(input as StoryboardInput);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }

    return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 400 });
  } catch (error: unknown) {
    const status = httpStatusFromError(error);
    return NextResponse.json(toErrorJson(error), { status });
  }
}
