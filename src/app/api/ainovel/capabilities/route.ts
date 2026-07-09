import { NextResponse } from 'next/server';
import { buildCapabilitiesReport } from '@/lib/novel-engine/capabilities';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(buildCapabilitiesReport());
}
