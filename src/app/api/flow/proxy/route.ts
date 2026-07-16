/**
 * Proxy any Flow/labs request as a specific app profile account.
 * Whatever that Google account can do in browser → app can call and receive.
 */
import { NextResponse } from 'next/server';
import { ensureBridgeStarted } from '@/lib/flow-bridge';
import {
  downloadAsAccount,
  proxyAsAccount,
} from '@/lib/flow-bridge/accountProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await ensureBridgeStarted();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'proxy');
  const accountId = String(body.accountId || '').trim();
  if (!accountId) {
    return NextResponse.json(
      { ok: false, error: 'accountId required' },
      { status: 400 },
    );
  }

  if (action === 'download') {
    const url = String(body.url || '').trim();
    const destPath = String(body.destPath || '').trim();
    if (!url || !destPath) {
      return NextResponse.json(
        { ok: false, error: 'url and destPath required' },
        { status: 400 },
      );
    }
    const result = await downloadAsAccount(accountId, url, destPath);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  // default: proxy API/trpc
  const url = String(body.url || '').trim();
  if (!url) {
    return NextResponse.json(
      { ok: false, error: 'url required' },
      { status: 400 },
    );
  }
  const result = await proxyAsAccount({
    accountId,
    url,
    method: body.method ? String(body.method) : 'POST',
    headers: body.headers as Record<string, string> | undefined,
    body: body.body,
    captchaAction: body.captchaAction
      ? String(body.captchaAction)
      : undefined,
    mode: body.mode === 'trpc' ? 'trpc' : 'api',
    timeoutMs: body.timeoutMs != null ? Number(body.timeoutMs) : undefined,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
