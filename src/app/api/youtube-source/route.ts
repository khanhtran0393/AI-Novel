import { NextRequest, NextResponse } from 'next/server';
import { buildYoutubeTranscriptUserError, fetchYoutubeSource } from '@/lib/youtubeSource';

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
        {
          success: false,
          errorCode: 'INVALID_URL',
          error: buildYoutubeTranscriptUserError({
            code: 'INVALID_URL',
            detail: 'Body thiếu field url',
          }),
        },
        { status: 400 },
      );
    }

    const preferredLangs = Array.isArray(body.preferredLangs)
      ? body.preferredLangs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined;

    const result = await fetchYoutubeSource(url, { preferredLangs });
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Fetch failed',
          errorCode: result.errorCode,
          videoId: result.videoId,
          url: result.url,
          title: result.title,
          channel: result.channel,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        success: false,
        errorCode: 'FETCH_FAILED',
        error:
          err.message ||
          'youtube-source failed — kiểm tra mạng và python_core/fetch_youtube_transcript.py',
      },
      { status: 500 },
    );
  }
}
