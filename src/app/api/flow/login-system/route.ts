import { NextResponse } from 'next/server';
import {
  loginWithSystemBrowser,
  completeSystemLogin,
  closeSystemBrowserLogin,
  isSystemBrowserOpen,
  listSystemBrowserSessions,
  findSystemChromePath,
} from '@/lib/flow-bridge/systemBrowserLogin';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Real-Chrome login may need long time for user to type credentials */
export const maxDuration = 600;

/**
 * System-browser (real Chrome + CDP) login — ported from SuperAutoTools.
 * POST { action: 'start'|'complete'|'close', accountId, chromePath?, proxy?, forceChrome? }
 * GET  ?accountId= → status { open, sessions, chromePath }
 */
export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const accountId = String(body.accountId || '').trim();
    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: 'accountId required', correlationId },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }
    let result: unknown;
    let status = 200;
    if (action === 'start') {
      result = await loginWithSystemBrowser(accountId, {
        chromePath: body.chromePath ? String(body.chromePath) : undefined,
        proxy: body.proxy ? String(body.proxy) : undefined,
        timeoutMs: body.timeoutMs != null ? Number(body.timeoutMs) : undefined,
      });
      status = (result as { success?: boolean }).success ? 200 : 502;
    } else if (action === 'complete') {
      result = await completeSystemLogin(accountId, {
        forceChrome: body.forceChrome === true,
      });
      status = (result as { relaunched?: boolean }).relaunched ? 200 : 502;
    } else if (action === 'close') {
      result = await closeSystemBrowserLogin(accountId);
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "action required: 'start' | 'complete' | 'close'",
          correlationId,
        },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }
    slog({
      level: status < 400 ? 'info' : 'warn',
      msg: `flow_login_system_${action}`,
      correlationId,
      route: '/api/flow/login-system',
      durationMs: Date.now() - started,
      error: status >= 400 ? JSON.stringify(result).slice(0, 300) : undefined,
    });
    return NextResponse.json(
      { ok: status < 400, ...(result as object), correlationId },
      { status, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    slog({
      level: 'error',
      msg: 'flow_login_system_error',
      correlationId,
      route: '/api/flow/login-system',
      durationMs: Date.now() - started,
      error,
    });
    return NextResponse.json(
      { ok: false, error, correlationId },
      { status: 500, headers: { 'x-correlation-id': correlationId } },
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId') || '';
    return NextResponse.json({
      ok: true,
      open: accountId ? isSystemBrowserOpen(accountId) : false,
      sessions: listSystemBrowserSessions(),
      chromePath: findSystemChromePath(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
