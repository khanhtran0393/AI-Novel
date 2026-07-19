/**
 * Full pipeline orchestration:
 * Seedance compile → (optional) FableCut pack from images → status snapshot
 */
import { NextRequest, NextResponse } from 'next/server';
import { compileSeedanceBatch, persistSeedanceCompile } from '@/lib/integrations/seedance';
import { buildFromChapterAssets, startFableCutServer } from '@/lib/integrations/fablecut';
import { getIntegrationsStatus } from '@/lib/integrations';
import { assertFeatureAccess } from '@/lib/entitlement';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const correlationId = correlationIdFromRequest(req);
  try {
    const body = await req.json();
    await assertFeatureAccess(req, 'integrations_pipeline', body);
    slog({
      level: 'info',
      msg: 'pipeline_start',
      correlationId,
      route: '/api/integrations/pipeline',
    });
    const steps: string[] = [];
    const out: Record<string, unknown> = {};

    // 1) Seedance
    if (Array.isArray(body.scenes) && body.scenes.length > 0) {
      const batch = compileSeedanceBatch(
        body.scenes.map(
          (
            s: { id?: string; text?: string; characters?: string[]; hasStartImage?: boolean; durationSec?: number },
            i: number,
          ) => ({
            id: s.id || `s${i + 1}`,
            text: s.text || '',
            characters: s.characters,
            hasStartImage: s.hasStartImage,
            durationSec: s.durationSec,
          }),
        ),
        { styleHint: body.styleHint, genre: body.genre },
      );
      const savedPath = persistSeedanceCompile(batch, 'pipeline');
      out.seedance = { count: batch.length, savedPath, sample: batch[0] };
      steps.push(`seedance:compiled:${batch.length}`);
    }

    // 2) FableCut from images
    if (Array.isArray(body.imagePaths) && body.imagePaths.length > 0) {
      const fc = buildFromChapterAssets({
        name: body.name || body.title || 'AI-Novel-Pipeline',
        imagePaths: body.imagePaths,
        audioPath: body.audioPath,
        secondsPerImage: body.secondsPerImage,
        aspect: body.aspect || '9:16',
        liveEditor: body.liveEditor !== false,
        title: body.title,
      });
      out.fablecut = fc;
      steps.push(fc.success ? `fablecut:ok:${fc.clipCount}` : `fablecut:fail:${fc.error}`);

      if (body.autoStartFableCut && fc.success) {
        const started = startFableCutServer();
        out.fablecutServer = started;
        steps.push(started.success ? 'fablecut:server:started' : `fablecut:server:fail`);
      }
    }

    const status = await getIntegrationsStatus();
    out.status = status;
    steps.push('status:ok');

    return NextResponse.json(
      {
        success: true,
        steps,
        correlationId,
        ...out,
      },
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, ...toErrorJson(err, correlationId) },
      {
        status: httpStatusFromError(err),
        headers: { 'x-correlation-id': correlationId },
      },
    );
  }
}
