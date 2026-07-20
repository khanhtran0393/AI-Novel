/**
 * Cloud YouTube psych IP authority — formulas on Vercel.
 * Desktop packaged clients call via pinned license API host.
 *
 * Auth: shared cloudIpAuth (signature + claim; not Vercel host HWID).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  assertCloudIpFeature,
  assertCloudIpToken,
} from '@/lib/commercial/ip/cloudIpAuth';
import { runPsychLocal } from '@/lib/commercial/ip/psychCloudBridge';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

const ACTIONS = new Set([
  'list_laws',
  'score_title',
  'detect_law',
  'law_order',
  'pick_seo_title',
  'generate_youtube_meta',
  'capabilities',
]);

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'cloud-ip-psych',
    actions: [...ACTIONS],
    note: 'POST with x-ainovel-entitlement (trial|pro). HWID vs token claim only.',
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
          actions: [...ACTIONS].filter((a) => a !== 'capabilities'),
          host: 'cloud',
        },
      });
    }

    // Full law list is multi_channel Pro IP; other SEO pack = trial+
    if (action === 'list_laws' || action === 'law_order') {
      const claims = assertCloudIpToken(req, body, 'pro');
      assertCloudIpFeature(claims, 'multi_channel');
    } else {
      assertCloudIpToken(req, body, 'trial');
    }

    const input =
      body.input && typeof body.input === 'object'
        ? (body.input as Record<string, unknown>)
        : (body as Record<string, unknown>);

    const result = runPsychLocal(
      action as
        | 'list_laws'
        | 'score_title'
        | 'detect_law'
        | 'law_order'
        | 'pick_seo_title'
        | 'generate_youtube_meta',
      input,
    );
    return NextResponse.json({ success: true, result, source: 'cloud' });
  } catch (err) {
    return NextResponse.json(
      { success: false, ok: false, ...toErrorJson(err) },
      { status: httpStatusFromError(err) },
    );
  }
}
