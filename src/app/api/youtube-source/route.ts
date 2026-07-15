import { NextRequest, NextResponse } from 'next/server';
import { fetchYoutubeSource } from '@/lib/youtubeSource';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST { url: string, preferredLangs?: string[] }
 * → bắt buộc bản chép lời (phụ đề). Không fallback mô tả video.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      url?: string;
      preferredLangs?: string[];
    };
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json(
        { success: false, error: 'Thiếu url YouTube' },
        { status: 400 },
      );
    }

    const preferredLangs = Array.isArray(body.preferredLangs)
      ? body.preferredLangs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined;

    const result = await fetchYoutubeSource(url, { preferredLangs });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error || 'Fetch failed', ...result },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { success: false, error: err.message || 'youtube-source failed' },
      { status: 500 },
    );
  }
}
