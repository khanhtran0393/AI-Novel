/**
 * Device fingerprint for license binding (display + copy in Settings).
 */
import { NextResponse } from 'next/server';
import { getEntitlementPublicStatus, getHwid } from '@/lib/entitlement';

export const runtime = 'nodejs';

export async function GET() {
  const status = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    hwid: getHwid(),
    mode: status.mode,
    readyForCommercial: status.readyForCommercial,
    blockers: status.blockers,
  });
}
