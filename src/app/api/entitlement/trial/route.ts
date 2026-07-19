/**
 * Trial start / status (one per HWID).
 */
import { NextResponse } from 'next/server';
import { getHwid, getEntitlementPublicStatus } from '@/lib/entitlement';
import { getTrialStatus, startTrial } from '@/lib/commercial/trial';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

export const runtime = 'nodejs';

export async function GET() {
  const status = getTrialStatus();
  const pub = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    ...status,
    endsIso: status.record
      ? new Date(status.record.endsAt * 1000).toISOString()
      : null,
    mode: pub.mode,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hwid?: string };
    const hwid =
      (typeof body.hwid === 'string' && body.hwid.trim()) || getHwid();
    const result = startTrial(hwid);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || 'Không bật trial được',
          status: result.status,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      created: result.created,
      message: result.created
        ? `Trial ${result.status.days} ngày đã bật cho máy này.`
        : result.error || 'Trial đã tồn tại trên máy này.',
      status: result.status,
      endsIso: result.status.record
        ? new Date(result.status.record.endsAt * 1000).toISOString()
        : null,
      hwid: result.status.hwid,
    });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}
