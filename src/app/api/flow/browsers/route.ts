import { NextResponse } from 'next/server';
import { getBrowserCatalog } from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List detected browsers for Flow (FlowAgent multi-engine strategy). */
export async function GET() {
  try {
    const catalog = getBrowserCatalog();
    return NextResponse.json(catalog);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
