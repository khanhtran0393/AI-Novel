/**
 * GET /api/omnivoice/status — probe OmniVoice Local server
 * POST /api/omnivoice/status — ensure/start server
 */
import { NextResponse } from 'next/server';
import {
  ensureOmniServer,
  probeOmniBaseUrl,
  resolveOmniProfileDir,
  resolveOmniPython,
  getLastSpawnedPid,
} from '@/lib/omnivoiceLocal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = await probeOmniBaseUrl(undefined, 1500);
  return NextResponse.json({
    ok: !!base,
    online: !!base,
    baseUrl: base,
    defaultPort: 8880,
    python: resolveOmniPython(),
    profileDir: resolveOmniProfileDir(),
  });
}

export async function POST() {
  try {
    const already = await probeOmniBaseUrl(undefined, 1200);
    if (already) {
      return NextResponse.json({
        ok: true,
        started: false,
        alreadyRunning: true,
        baseUrl: already,
        message: 'OmniVoice Local đã chạy.',
      });
    }
    const baseUrl = await ensureOmniServer();
    return NextResponse.json({
      ok: true,
      started: true,
      alreadyRunning: false,
      baseUrl,
      pid: getLastSpawnedPid(),
      message: `OmniVoice Local online tại ${baseUrl}`,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        python: resolveOmniPython(),
        profileDir: resolveOmniProfileDir(),
      },
      { status: 503 },
    );
  }
}
