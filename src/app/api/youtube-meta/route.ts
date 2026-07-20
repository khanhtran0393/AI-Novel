/**
 * YouTube meta (psych SEO) — Free local; packaged+token → cloud IP.
 * Client write-finish / checklist should call this instead of importing formulas only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { extractEntitlementToken } from '@/lib/entitlement';
import { resolveYoutubeMetaIp } from '@/lib/commercial/ip/psychCloudBridge';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const script = String(body.script || body.noi_dung || '').trim();
    if (!script) {
      return NextResponse.json(
        { success: false, error: 'Thiếu script / noi_dung.' },
        { status: 400 },
      );
    }
    const visualDna = String(
      body.visualDna || body.visualDnaPrompt || body.mediaStylePreset || '',
    ).trim();
    if (!visualDna) {
      return NextResponse.json(
        {
          success: false,
          error: 'Thiếu visualDna (Visual DNA / Media Style).',
        },
        { status: 400 },
      );
    }

    const token = extractEntitlementToken(req, body);
    const { pack, source } = await resolveYoutubeMetaIp(
      {
        script,
        novelTitle:
          typeof body.novelTitle === 'string'
            ? body.novelTitle
            : typeof body.ten_tac_pham === 'string'
              ? body.ten_tac_pham
              : undefined,
        chaptersText:
          typeof body.chaptersText === 'string' ? body.chaptersText : undefined,
        maxRounds:
          typeof body.maxRounds === 'number' ? body.maxRounds : undefined,
        usedTitles: Array.isArray(body.usedTitles)
          ? body.usedTitles.map(String)
          : undefined,
        usedThumbLines: Array.isArray(body.usedThumbLines)
          ? body.usedThumbLines.map(String)
          : undefined,
        chapter:
          typeof body.chapter === 'number'
            ? body.chapter
            : typeof body.chapterNumber === 'number'
              ? body.chapterNumber
              : undefined,
        visualDna,
        characterHint:
          typeof body.characterHint === 'string'
            ? body.characterHint
            : undefined,
      },
      {
        entitlementToken: token,
        // Free (no token): local OK. Paid packaged: cloud preferred, soft local if cloud down only when AINOVEL_PSYCH_CLOUD=0
        allowLocalFreeFallback: !token,
      },
    );

    return NextResponse.json({
      success: true,
      source,
      ...pack,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, ok: false, ...toErrorJson(err) },
      { status: httpStatusFromError(err) },
    );
  }
}
