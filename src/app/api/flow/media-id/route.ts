import { NextResponse } from 'next/server';
import {
  getFlowMediaId,
  setFlowMediaId,
} from '@/lib/flow-bridge/mediaIdIndex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = String(url.searchParams.get('key') || '').trim();
  if (!key) {
    return NextResponse.json({ error: 'Thiếu key' }, { status: 400 });
  }
  return NextResponse.json({ key, mediaId: getFlowMediaId(key) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || '').trim();
  const mediaId = String(body.mediaId || '').trim();
  if (!key || !mediaId) {
    return NextResponse.json({ error: 'Thiếu key/mediaId' }, { status: 400 });
  }
  setFlowMediaId(key, mediaId);
  return NextResponse.json({ ok: true, key, mediaId });
}
