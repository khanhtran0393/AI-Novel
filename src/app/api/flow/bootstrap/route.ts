import { NextResponse } from 'next/server';
import { bootstrapFlow } from '@/lib/flow-bridge/bootstrap';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Có thể tự tải Chromium ~150MB lần đầu — cho phép tới 10 phút */
export const maxDuration = 300;

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const requestedMode =
      body.mode === 'background' || body.mode === 'login'
        ? body.mode
        : undefined;
    const result = await bootstrapFlow({
      forceChrome: Boolean(body.forceChrome),
      browserExe: body.browserExe ? String(body.browserExe) : undefined,
      accountId: body.accountId ? String(body.accountId) : undefined,
      engine: body.engine ? String(body.engine) : 'auto',
      waitExtensionMs:
        body.waitExtensionMs != null ? Number(body.waitExtensionMs) : 25_000,
      waitLoginMs:
        body.waitLoginMs != null ? Number(body.waitLoginMs) : undefined,
      /** Thêm profile mới = hồ sơ trình duyệt trống, không login account cũ */
      freshSession: Boolean(body.freshSession),
      mode: requestedMode,
    });
    slog({
      level: result.ok ? 'info' : 'warn',
      msg: 'flow_bootstrap',
      correlationId,
      route: '/api/flow/bootstrap',
      durationMs: Date.now() - started,
      error: result.ok ? undefined : result.message,
    });
    return NextResponse.json(
      { ...result, correlationId },
      {
        status: result.ok ? 200 : 503,
        headers: { 'x-correlation-id': correlationId },
      },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    slog({
      level: 'error',
      msg: 'flow_bootstrap_error',
      correlationId,
      route: '/api/flow/bootstrap',
      durationMs: Date.now() - started,
      error,
    });
    return NextResponse.json(
      { ok: false, error, correlationId },
      { status: 500, headers: { 'x-correlation-id': correlationId } },
    );
  }
}

export async function GET() {
  // Idempotent status-oriented bootstrap (no force chrome)
  try {
    const result = await bootstrapFlow({
      forceChrome: false,
      waitExtensionMs: 5_000,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
