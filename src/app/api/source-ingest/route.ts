import { NextRequest, NextResponse } from 'next/server';
import { fetchMultiSourceIngest } from '@/lib/source-ingest';

export const runtime = 'nodejs';
/** YouTube path may run audio+Whisper; web is fast. */
export const maxDuration = 600;

/**
 * POST { url: string, preferredLangs?: string[] }
 * → Agent-Reach multi-source ingest (YouTube captions chain | web article extract).
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
          ok: false,
          platform: 'unsupported',
          errorCode: 'INVALID_URL',
          error:
            '❌ Thiếu URL.\n\n🔎 Vì sao: Body thiếu field url.\n📍 Ở đâu: /api/source-ingest\n✅ Cách khắc phục:\n• Gửi { url: "https://…" } hoặc danh sách URL.',
        },
        { status: 400 },
      );
    }

    const preferredLangs = Array.isArray(body.preferredLangs)
      ? body.preferredLangs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined;

    const result = await fetchMultiSourceIngest(url, { preferredLangs });

    if (!result.ok) {
      // Keep title/description so client can soft-seed cốt truyện
      return NextResponse.json(
        {
          success: false,
          ...result,
          // Client compat with youtube-source shape
          transcript: result.text || '',
          channel: result.author || '',
        },
        { status: result.errorCode === 'INVALID_URL' || result.errorCode === 'UNSUPPORTED_URL' || result.errorCode === 'SSRF_BLOCKED' ? 400 : 422 },
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
      transcript: result.text || '',
      channel: result.author || '',
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        success: false,
        ok: false,
        platform: 'unsupported',
        errorCode: 'FETCH_FAILED',
        error:
          err.message ||
          'source-ingest failed — kiểm tra mạng / URL / chuỗi YouTube (python_core, yt-dlp).',
      },
      { status: 500 },
    );
  }
}
