import { NextResponse } from 'next/server';
import { probeRuntimeHealth } from '@/lib/runtimeHealth';
import {
  correlationIdFromRequest,
  slog,
  withCorrelationHeaders,
} from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const health = probeRuntimeHealth(process.cwd());
    slog({
      level: 'info',
      msg: 'runtime_health',
      correlationId,
      route: '/api/health/runtime',
      durationMs: Date.now() - started,
      fail: health.fail,
      warn: health.warn,
    });
    return NextResponse.json(
      { ...health, healthy: health.fail === 0, correlationId },
      withCorrelationHeaders({ status: 200 }, correlationId),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    slog({
      level: 'error',
      msg: 'runtime_health_failed',
      correlationId,
      route: '/api/health/runtime',
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message, correlationId },
      withCorrelationHeaders({ status: 500 }, correlationId),
    );
  }
}
