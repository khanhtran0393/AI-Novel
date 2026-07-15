import { NextResponse } from 'next/server';
import {
  commandExtension,
  ensureBridgeStarted,
  getBridgeSnapshot,
} from '@/lib/flow-bridge';
import { bootstrapFlow } from '@/lib/flow-bridge/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await ensureBridgeStarted();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'auto');

    if (action === 'refresh') {
      try {
        await commandExtension('refresh_flow_tab', {});
      } catch {
        /* offline */
      }
      return NextResponse.json({
        ok: true,
        snapshot: getBridgeSnapshot(),
      });
    }

    // Default: full auto (bridge + default account + Chrome --load-extension)
    if (
      action === 'auto' ||
      action === 'open_tab' ||
      action === 'bootstrap' ||
      action === 'connect'
    ) {
      const result = await bootstrapFlow({
        forceChrome: Boolean(body.forceChrome) || action === 'open_tab',
        browserExe: body.browserExe ? String(body.browserExe) : undefined,
        accountId: body.accountId ? String(body.accountId) : undefined,
        waitExtensionMs: 20_000,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 503 });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
