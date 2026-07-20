/**
 * Cloud Seedance IP authority — runs full director/sequence formulas on Vercel.
 * Desktop packaged builds call this via pinned license API host.
 *
 * Auth: Ed25519 signature + exp + paid claims (shared cloudIpAuth — not host HWID).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  applyDirectorFormulasToPromptPair,
  compileDirectedClip,
  compileSeedancePrompt,
  compileStillImagePrompt,
} from '@/lib/integrations/seedance';
import { applySequenceToVideoPrompts } from '@/lib/integrations/seedanceAuto';
import {
  assertCloudIpFeature,
  assertCloudIpToken,
} from '@/lib/commercial/ip/cloudIpAuth';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

const ACTIONS = new Set([
  'compile_prompt',
  'compile_still',
  'apply_director_pair',
  'compile_directed_clip',
  'apply_sequence',
  'capabilities',
]);

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'cloud-ip-seedance',
    actions: [...ACTIONS],
    note: 'POST with x-ainovel-entitlement (trial|pro). HWID vs token claim only, not Vercel host.',
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

    if (action === 'apply_sequence' || action === 'compile_directed_clip') {
      const claims = assertCloudIpToken(req, body, 'pro');
      assertCloudIpFeature(claims, 'integrations_pipeline');
    } else {
      assertCloudIpToken(req, body, 'trial');
    }

    const input = body.input ?? body.payload ?? body;

    if (action === 'compile_prompt') {
      const result = compileSeedancePrompt(input);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }
    if (action === 'compile_still') {
      const result = compileStillImagePrompt(input);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }
    if (action === 'apply_director_pair') {
      const result = applyDirectorFormulasToPromptPair(input);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }
    if (action === 'compile_directed_clip') {
      const result = compileDirectedClip(input);
      return NextResponse.json({ success: true, result, source: 'cloud' });
    }
    if (action === 'apply_sequence') {
      const result = applySequenceToVideoPrompts(input);
      return NextResponse.json({
        success: true,
        result: { ...result, source: 'cloud' },
        source: 'cloud',
      });
    }

    return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, ...toErrorJson(err) },
      { status: httpStatusFromError(err) },
    );
  }
}
