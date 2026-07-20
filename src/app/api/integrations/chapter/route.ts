/**
 * Chapter-level integration pipeline — uses real store assets from the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runChapterPipeline } from '@/lib/integrations/chapterPipeline';
import {
  collectChapterImageDiskPaths,
  collectChapterAudioDiskPaths,
  resolveMediaToDisk,
} from '@/lib/integrations/mediaPaths';
import { requireFeature } from '@/lib/commercial/apiGate';
import { extractEntitlementToken } from '@/lib/entitlement';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'integrations_pipeline', body);
    if (denied) return denied;
    const action = String(body.action || 'pipeline');
    const chapterNum = Number(body.chapterNum || body.so_chuong || 0);

    if (!chapterNum || chapterNum < 1) {
      return NextResponse.json(
        { success: false, error: 'chapterNum (so_chuong) bắt buộc ≥ 1' },
        { status: 400 },
      );
    }

    if (action === 'resolve') {
      const images = collectChapterImageDiskPaths(chapterNum, body.generatedImages);
      const audios = collectChapterAudioDiskPaths(chapterNum, body.generatedAudioPaths);
      return NextResponse.json({
        success: true,
        chapterNum,
        images,
        audios,
        sampleResolve: body.sampleUrl
          ? { url: body.sampleUrl, disk: resolveMediaToDisk(body.sampleUrl) }
          : undefined,
      });
    }

    const result = await runChapterPipeline({
      chapterNum,
      title: body.title || body.tieu_de,
      ten_tac_pham: body.ten_tac_pham,
      sceneTexts: body.sceneTexts,
      characterNames: body.characterNames || body.nhan_vat,
      genre: body.genre,
      styleHint: body.styleHint || body.visualDnaPrompt,
      generatedImages: body.generatedImages,
      generatedAudioPaths: body.generatedAudioPaths,
      generatedVideos: body.generatedVideos,
      generatedPrompts: body.generatedPrompts,
      runSeedance: body.runSeedance !== false && action !== 'fablecut-only',
      runFableCut: body.runFableCut !== false && action !== 'seedance-only',
      liveEditor: body.liveEditor !== false,
      autoStartFableCut: Boolean(body.autoStartFableCut ?? body.autoStart),
      aspect: body.aspect || '9:16',
      entitlementToken: extractEntitlementToken(req, body),
      secondsPerImage: body.secondsPerImage,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (err) {
    const e = err as Error;
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
