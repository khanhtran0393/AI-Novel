import { NextResponse } from 'next/server';

import {
  getStatus,
  recordCheckpoint,
  recordSnapshot,
  resetEngine,
  type EngineScope,
  type EngineSnapshot,
} from '@/lib/novel-engine/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type EnginePostBody =
  | { action: 'checkpoint'; step: string; scope?: EngineScope; payload: unknown; projectName?: string }
  | { action: 'snapshot'; snapshot: EngineSnapshot }
  | { action: 'reset' }
  | { action: 'status' };

export async function GET() {
  return NextResponse.json(getStatus());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as EnginePostBody;

    if (body.action === 'checkpoint') {
      if (!body.step) {
        return NextResponse.json({ error: 'Missing checkpoint step.' }, { status: 400 });
      }
      const checkpoint = recordCheckpoint({
        step: body.step,
        scope: body.scope,
        payload: body.payload,
        projectName: body.projectName,
      });
      return NextResponse.json({ success: true, checkpoint, status: getStatus() });
    }

    if (body.action === 'snapshot') {
      const checkpoint = recordSnapshot(body.snapshot);
      return NextResponse.json({ success: true, checkpoint, status: getStatus() });
    }

    if (body.action === 'reset') {
      resetEngine();
      return NextResponse.json({ success: true, status: getStatus() });
    }

    if (body.action === 'status') {
      return NextResponse.json(getStatus());
    }

    return NextResponse.json({ error: 'Unsupported engine action.' }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
