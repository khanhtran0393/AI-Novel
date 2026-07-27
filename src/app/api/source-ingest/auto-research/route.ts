import { NextRequest, NextResponse } from 'next/server';
import { autoResearchKnowledge } from '@/lib/source-ingest/autoResearch';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { query?: string };
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          ok: false,
          error: '❌ Thiếu từ khóa query.',
        },
        { status: 400 },
      );
    }

    const result = await autoResearchKnowledge(query);

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          ...result,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        success: false,
        ok: false,
        error: err.message || 'Auto-research failed.',
      },
      { status: 500 },
    );
  }
}
