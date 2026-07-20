import { NextResponse } from 'next/server';
import {
  diagnoseMediaSelfHeal,
  normalizeMediaSelfHealRequest,
  resolveMediaSelfHealLog,
} from '@/lib/self-heal/mediaSelfHealCore';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const denied = await requireToolboxAccess(req, body || {});
    if (denied) return denied;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Request body must be JSON.' },
        { status: 400 },
      );
    }

    if (body.action === 'resolve') {
      const result = resolveMediaSelfHealLog(body.logId);
      return NextResponse.json({ success: true, ...result });
    }

    const normalized = normalizeMediaSelfHealRequest(body);
    if (!('domain' in normalized)) {
      return NextResponse.json(
        {
          success: false,
          error: normalized.error,
          received: normalized.received,
        },
        { status: 400 },
      );
    }

    const diagnosis = await diagnoseMediaSelfHeal(normalized);
    return NextResponse.json({ success: true, diagnosis });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
