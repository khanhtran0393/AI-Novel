import { NextResponse } from 'next/server';
import { getIntegrationsStatus } from '@/lib/integrations';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const status = await getIntegrationsStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
