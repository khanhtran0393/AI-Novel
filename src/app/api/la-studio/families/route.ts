/**
 * GET  /api/la-studio/families — status + download progress
 * POST /api/la-studio/families { familyId, action?: 'ensure'|'start' }
 *   → download-on-demand; returns job snapshot (poll GET while status=downloading)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  LA_STUDIO_DEFAULT_FAMILY,
  getLaStudioFamily,
} from '@/lib/laStudioRuntimes';
import {
  ensureFamilyDownloaded,
  familiesWithJobs,
  getDownloadJob,
} from '@/lib/laStudioDownload';
import { isKokoroCliReady } from '@/lib/laStudioLocal';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'tts_premium');
  if (denied) return denied;
  const familyId = req.nextUrl.searchParams.get('familyId') || '';
  const families = familiesWithJobs();
  const job = familyId ? getDownloadJob(familyId) : null;
  return NextResponse.json({
    ok: true,
    defaultFamily: LA_STUDIO_DEFAULT_FAMILY,
    kokoroCliReady: isKokoroCliReady(),
    families,
    job,
    note:
      'Trial/Pro: download-on-demand family. Ship default Kokoro-VI; family khác tải khi dùng.',
  });
}

export async function POST(req: NextRequest) {
  let body: { familyId?: string; action?: string; wait?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const denied = await requireFeature(req, 'tts_premium', body);
  if (denied) return denied;

  const familyId = String(body.familyId || LA_STUDIO_DEFAULT_FAMILY).trim();
  const fam = getLaStudioFamily(familyId);
  if (!fam) {
    return NextResponse.json({ error: `Unknown family: ${familyId}` }, { status: 400 });
  }

  // OmniVoice: platform omnivoice_local, UI stays on tab LA Studio (no zip, no Engine dropdown)
  if (familyId === 'omnivoice') {
    const job = await ensureFamilyDownloaded(familyId);
    return NextResponse.json({
      ok: true,
      familyId,
      switchPlatform: 'omnivoice_local',
      switchVoice: 'alloy',
      job,
      families: familiesWithJobs(),
      message:
        'OmniVoice sẵn sàng trong tab LA Studio (platform omnivoice_local · không tải pack · không dùng Engine chọn tay).',
    });
  }

  const wait = body.wait !== false;
  if (!wait) {
    // Fire-and-forget for huge packs; client polls
    void ensureFamilyDownloaded(familyId);
    return NextResponse.json({
      ok: true,
      started: true,
      familyId,
      job: getDownloadJob(familyId),
      families: familiesWithJobs(),
      message: `Đang tải «${fam.title}»…`,
    });
  }

  const job = await ensureFamilyDownloaded(familyId);
  return NextResponse.json({
    ok: job.status === 'done',
    familyId,
    job,
    families: familiesWithJobs(),
    message: job.message,
    error: job.error,
    // After download of non-kokoro packs, synth may still need LA Studio API
    synthHint:
      job.status === 'done' && familyId !== 'kokoro-vietnamese'
        ? 'Pack đã tải. Gen TTS: family Kokoro-VI dùng ngay; family khác cần LA Studio API load model hoặc Engine tương ứng.'
        : undefined,
  });
}
