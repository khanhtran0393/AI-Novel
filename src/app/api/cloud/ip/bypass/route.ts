/**
 * Cloud Phantom-X filter-graph compile (crown IP).
 * Desktop packaged builds call this; FFmpeg still runs on customer machine.
 */
import { NextRequest, NextResponse } from 'next/server';
import { compileBypassCrownLocal } from '@/lib/commercial/ip/bypassCloudBridge';
import {
  assertCloudIpFeature,
  assertCloudIpToken,
} from '@/lib/commercial/ip/cloudIpAuth';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ACTIONS = new Set(['compile_graph', 'capabilities']);

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'cloud-ip-bypass',
    actions: [...ACTIONS],
    note: 'POST compile_graph with probe meta + filters. toolbox_labs + trial|pro.',
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
        result: { actions: ['compile_graph'], host: 'cloud' },
      });
    }

    const claims = assertCloudIpToken(req, body, 'trial');
    assertCloudIpFeature(claims, 'toolbox_labs');

    const input = body.input ?? body.payload ?? body;
    const result = compileBypassCrownLocal(input);
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
