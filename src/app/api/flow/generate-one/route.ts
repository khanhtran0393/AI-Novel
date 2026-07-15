import { NextResponse } from 'next/server';
import { ensureBridgeStarted, runGenerateOne } from '@/lib/flow-bridge';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    await ensureBridgeStarted();
    const body = await req.json();
    const result = await runGenerateOne(body);
    slog({
      level: result.ok ? 'info' : 'warn',
      msg: result.ok ? 'flow_generate_ok' : 'flow_generate_fail',
      correlationId,
      route: '/api/flow/generate-one',
      durationMs: Date.now() - started,
      error: result.error,
    });
    return NextResponse.json(
      { ...result, correlationId },
      {
        status: result.ok ? 200 : 500,
        headers: { 'x-correlation-id': correlationId },
      },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    slog({
      level: 'error',
      msg: 'flow_generate_error',
      correlationId,
      route: '/api/flow/generate-one',
      durationMs: Date.now() - started,
      error,
    });
    return NextResponse.json(
      { ok: false, error, correlationId },
      { status: 500, headers: { 'x-correlation-id': correlationId } },
    );
  }
}
