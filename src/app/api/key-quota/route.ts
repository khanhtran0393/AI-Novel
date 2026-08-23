/**
 * API key time-window quota snapshot (RPM / RPD counters).
 * POST body: { keys?: string[] } — fingerprints only in response.
 */
import { NextResponse } from 'next/server';
import {
  getKeyRotateSnapshot,
  registerKeys,
  getRpmLimit,
  getRpdLimit,
} from '@/lib/apiKeyRotate';
import { correlationIdFromRequest } from '@/lib/requestContext';

export const runtime = 'nodejs';

export async function GET() {
  const rpmLimit = getRpmLimit();
  const rpdLimit = getRpdLimit();
  return NextResponse.json({
    rpmLimit,
    rpdLimit,
    mode: rpmLimit > 0 || rpdLimit > 0 ? 'local_override' : 'provider_driven',
    hint: 'POST { keys: string[] } để xem đếm thời gian từng key trong pool.',
  });
}

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  try {
    const body = (await req.json().catch(() => ({}))) as {
      keys?: string[];
      register?: boolean;
    };
    const keys = Array.isArray(body.keys)
      ? body.keys.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    if (body.register !== false) {
      registerKeys(keys);
    }
    const snap = getKeyRotateSnapshot(keys);
    return NextResponse.json(
      {
        ok: true,
        ...snap,
        serverTime: Date.now(),
      },
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500, headers: { 'x-correlation-id': correlationId } },
    );
  }
}
