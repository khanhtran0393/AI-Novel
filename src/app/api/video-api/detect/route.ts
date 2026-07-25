import { NextResponse } from 'next/server';
import { detectVideoApiPlatform } from '@/lib/video-api';
import type { VideoApiProviderId } from '@/lib/video-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/video-api/detect
 * Body: { apiKey, baseUrl?, forceProvider?, skipProbe? }
 * Auto-detect video platform (HeyGen, Luma, Runway, …).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      apiKey?: string;
      baseUrl?: string;
      forceProvider?: string;
      skipProbe?: boolean;
    };
    const apiKey = String(body.apiKey || '').trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Thiếu apiKey. Dán key nền tảng video.' },
        { status: 400 },
      );
    }
    const result = await detectVideoApiPlatform({
      apiKey,
      baseUrl: body.baseUrl,
      skipProbe: body.skipProbe === true,
      forceProvider: body.forceProvider
        ? (String(body.forceProvider).trim() as VideoApiProviderId)
        : undefined,
    });
    return NextResponse.json({
      ok: result.providerId !== 'unknown',
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
