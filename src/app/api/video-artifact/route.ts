import { NextResponse } from 'next/server';
import { recoverLocalVideoArtifact } from '@/lib/flow-bridge/flowVideoFinalize';
import { correlationIdFromRequest } from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recover / probe local video for chapter+scene after HTTP timeout.
 * GET ?chapterNum=&sceneIndex=&promptIndex=
 */
export async function GET(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  try {
    const url = new URL(req.url);
    const chapterNum = Number(url.searchParams.get('chapterNum'));
    const sceneIndex = Number(url.searchParams.get('sceneIndex'));
    const promptIndex = Number(url.searchParams.get('promptIndex') || 0);
    if (!Number.isFinite(chapterNum) || !Number.isFinite(sceneIndex)) {
      return NextResponse.json(
        { ok: false, error: 'missing chapterNum/sceneIndex', correlationId },
        { status: 400 },
      );
    }
    const rec = recoverLocalVideoArtifact({
      chapterNum,
      sceneIndex,
      promptIndex,
    });
    return NextResponse.json(
      { ...rec, correlationId },
      { status: rec.ok ? 200 : 404 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        correlationId,
      },
      { status: 500 },
    );
  }
}
