import { NextResponse } from 'next/server';
import {
  ZUSTAND_STORE_KEY,
  getStoreBackupPath,
  readStoreBackup,
  scorePersistedStore,
  writeStoreBackup,
} from '@/lib/persistStore';

export const runtime = 'nodejs';

/**
 * GET — load durable disk backup of the Zustand store.
 * POST — save store JSON to disk (atomic write).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name') || ZUSTAND_STORE_KEY;
    if (name !== ZUSTAND_STORE_KEY) {
      return NextResponse.json({ error: 'Unknown store key' }, { status: 400 });
    }

    const value = readStoreBackup();
    const summary = scorePersistedStore(value);
    return NextResponse.json({
      name,
      value,
      path: getStoreBackupPath(),
      summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to read backup' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    // Support JSON fetch + sendBeacon(Blob)
    let body: { name?: string; value?: string } = {};
    const contentType = req.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json') || contentType.includes('text/plain') || !contentType) {
        const text = await req.text();
        if (text) body = JSON.parse(text);
      } else {
        body = await req.json();
      }
    } catch {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const name = body?.name || ZUSTAND_STORE_KEY;
    const value = typeof body?.value === 'string' ? body.value : '';

    if (name !== ZUSTAND_STORE_KEY) {
      return NextResponse.json({ error: 'Unknown store key' }, { status: 400 });
    }
    if (!value) {
      return NextResponse.json({ error: 'Missing value' }, { status: 400 });
    }

    const incoming = scorePersistedStore(value);
    const existing = readStoreBackup();
    const existingScore = scorePersistedStore(existing);

    // Never overwrite a much richer backup with empty/default state
    // (e.g. race during hydration before rehydrate finishes).
    if (existingScore.score > 0 && incoming.score < existingScore.score * 0.25 && incoming.score < 500) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'incoming_weaker_than_backup',
        path: getStoreBackupPath(),
        summary: existingScore,
      });
    }

    const result = writeStoreBackup(value);

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Write failed' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      path: result.path,
      summary: scorePersistedStore(value),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error)?.message || 'Failed to write backup' },
      { status: 500 },
    );
  }
}
