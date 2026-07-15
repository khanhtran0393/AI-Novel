/**
 * Trạng thái full stack Universal Zero-Shot (ONNX brain + profiles + optional :8765).
 */
import { NextRequest, NextResponse } from 'next/server';
import { engineStatus, probeVinaEngine } from '@/lib/vinaVoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const engineUrl =
    req.nextUrl.searchParams.get('url') ||
    process.env.VINA_ENGINE_URL ||
    'http://127.0.0.1:8765';
  const local = engineStatus();
  const remote = await probeVinaEngine(engineUrl);
  const brain = local.onnxBrain;
  const brainReady = !!brain?.ready;
  return NextResponse.json({
    ok: true,
    ...local,
    engine: remote,
    /** Primary mode: local ONNX zero-shot when brain ready */
    cloneMode: brainReady
      ? 'universal_onnx_zero_shot'
      : remote.online
        ? remote.xtts_available
          ? 'xtts_zero_shot'
          : 'engine_edge_match'
        : 'brain_missing',
    readyForClone: brainReady || local.ffmpeg === true,
    readyForTrueTimbre: brainReady || (remote.online && !!remote.xtts_available),
    universalZeroShot: brainReady,
    onnxBrain: brain,
  });
}
