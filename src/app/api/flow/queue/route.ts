import { NextResponse } from 'next/server';
import { ensureBridgeStarted, getQueue } from '@/lib/flow-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureBridgeStarted();
  return NextResponse.json(getQueue().snapshot());
}

export async function POST(req: Request) {
  await ensureBridgeStarted();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'enqueue');
  const q = getQueue();

  if (action === 'enqueue') {
    const tasks = q.enqueueMany(body);
    return NextResponse.json({ tasks, queue: q.snapshot() });
  }
  if (action === 'start') {
    if (body.mode === 'parallel' || body.mode === 'sequential') {
      q.setMode(body.mode);
    }
    if (body.delayMin != null && body.delayMax != null) {
      q.setDelay(Number(body.delayMin), Number(body.delayMax));
    }
    q.start();
    return NextResponse.json(q.snapshot());
  }
  if (action === 'stop') {
    q.stop();
    return NextResponse.json(q.snapshot());
  }
  if (action === 'clear') {
    q.clearPending();
    return NextResponse.json(q.snapshot());
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
