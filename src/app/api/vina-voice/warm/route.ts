/**
 * Pre-load ONNX brain into warm daemon (call before chapter TTS).
 */
import { NextResponse } from 'next/server';
import {
  ensureVinaDaemon,
  isDaemonEnabled,
  resolveDaemonWorkerCount,
} from '@/lib/vinaVoice/warmDaemon';
import { inspectVinaOnnxBrain } from '@/lib/vinaVoice/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isDaemonEnabled()) {
    return NextResponse.json({
      ok: false,
      enabled: false,
      message: 'VINA_WARM_DAEMON=0 — daemon tắt',
    });
  }
  const brain = inspectVinaOnnxBrain(process.cwd());
  if (!brain.ok) {
    return NextResponse.json({
      ok: false,
      enabled: true,
      brain,
      error: `Não ONNX thiếu: ${brain.missing.join(', ')}`,
    }, { status: 503 });
  }
  const workers = resolveDaemonWorkerCount();
  const ready = await ensureVinaDaemon(process.cwd());
  return NextResponse.json({
    ok: ready,
    enabled: true,
    workers,
    brain: { totalGB: brain.totalGB, ready: brain.ok },
    message: ready
      ? `Warm pool ×${workers} · brain ~${brain.totalGB}GB/worker — chia đoạn song song rồi ghép`
      : 'Không start được daemon — sẽ one-shot CLI',
  });
}

export async function GET() {
  return POST();
}
