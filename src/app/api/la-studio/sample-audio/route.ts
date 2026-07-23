/**
 * GET /api/la-studio/sample-audio?familyId=&voiceId=&bake=0|1
 *
 * Ship-safe sample WAV stream:
 * - Resolves from userData/data/public/pack (not only Next public/)
 * - Optional bake=1: synthesize demo via Kokoro-VI if missing (first listen on user PC)
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  ensureDiskPresetSampleWavs,
  ensureFamilySamplePack,
  resolveSampleWav,
} from '@/lib/laStudioSampleVoices';
import { LA_STUDIO_DEFAULT_FAMILY } from '@/lib/laStudioRuntimes';
import { requireFeature } from '@/lib/commercial/apiGate';
import {
  isLaStudioUserCloneId,
  resolveCloneAudioPath,
} from '@/lib/laStudioClones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const denied = await requireFeature(req, 'tts_premium');
  if (denied) return denied;
  const familyId =
    req.nextUrl.searchParams.get('familyId')?.trim() ||
    LA_STUDIO_DEFAULT_FAMILY;
  const voiceId = req.nextUrl.searchParams.get('voiceId')?.trim() || '';
  const bake =
    req.nextUrl.searchParams.get('bake') === '1' ||
    req.nextUrl.searchParams.get('bake') === 'true';

  if (!voiceId) {
    return NextResponse.json(
      { error: 'Thiếu voiceId' },
      { status: 400 },
    );
  }

  const voiceNfc = voiceId.normalize('NFC');

  // Durable user clones (Voice Clone tab) — always serve ref sample
  if (
    isLaStudioUserCloneId(voiceNfc) ||
    familyId === 'user-clones'
  ) {
    const cloneHit = resolveCloneAudioPath(voiceNfc);
    if (cloneHit && fs.existsSync(cloneHit.path)) {
      const buf = fs.readFileSync(cloneHit.path);
      if (buf.length < 400) {
        return NextResponse.json(
          { error: 'File mẫu clone hỏng (quá ngắn)' },
          { status: 500 },
        );
      }
      const ext = path.extname(cloneHit.path).toLowerCase();
      const ct =
        ext === '.mp3'
          ? 'audio/mpeg'
          : ext === '.m4a'
            ? 'audio/mp4'
            : ext === '.ogg'
              ? 'audio/ogg'
              : 'audio/wav';
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Content-Length': String(buf.length),
          'Cache-Control': 'no-store',
          'X-LA-Studio-Sample': `user-clone:${cloneHit.meta.id}`,
        },
      });
    }
    if (isLaStudioUserCloneId(voiceNfc) || familyId === 'user-clones') {
      return NextResponse.json(
        {
          error: `Không tìm thấy mẫu clone «${voiceNfc}». Tạo lại trong tab Voice Clone.`,
          familyId: 'user-clones',
          voiceId: voiceNfc,
        },
        { status: 404 },
      );
    }
  }

  // Prefer family, then any family (stale kokoro family + VieNeu voice id is common)
  let hit = resolveSampleWav(familyId, voiceNfc);

  // Auto-bake when missing (first ▶ on user PC after download) — default on
  const shouldBake =
    bake ||
    req.nextUrl.searchParams.get('bake') !== '0';
  if (!hit && shouldBake) {
    try {
      await ensureFamilySamplePack(familyId);
      hit = resolveSampleWav(undefined, voiceNfc);
    } catch {
      /* try single voice bake */
    }
    if (!hit) {
      try {
        await ensureDiskPresetSampleWavs(
          familyId,
          [{ id: voiceNfc, name: voiceNfc }],
          { maxVoices: 1 },
        );
        hit = resolveSampleWav(undefined, voiceNfc);
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : 'Bake giọng mẫu thất bại — cần bin/la-studio-kokoro (ship).',
          },
          { status: 503 },
        );
      }
    }
  }

  if (!hit || !fs.existsSync(hit.path)) {
    return NextResponse.json(
      {
        error: `Chưa có WAV mẫu cho «${voiceNfc}» · family «${familyId}». Thử bake=1 hoặc tải lại family.`,
        familyId,
        voiceId: voiceNfc,
        hint: 'Sau khi tải family, app bake sample WAV trên máy user (Kokoro-VI demo).',
      },
      { status: 404 },
    );
  }

  const buf = fs.readFileSync(hit.path);
  if (buf.length < 800) {
    return NextResponse.json(
      { error: 'File mẫu hỏng (quá ngắn)' },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=3600',
      'X-Sample-Family': hit.familyId,
      'X-Sample-Source': 'la-studio-family-sample',
    },
  });
}
