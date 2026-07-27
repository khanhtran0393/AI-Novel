import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { buildShipPack, type ShipPackInput } from '@/lib/shipPack';
import type { ChannelProfile, ShipMode } from '@/lib/channelModel';
import { normalizeChannelProfile } from '@/lib/channelModel';
import { assertPremiumAccessHard } from '@/lib/commercial/proGateHard';
import { responseForGateFailure } from '@/lib/commercial/apiGate';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

type ChapterPipelinePrompts = Record<
  string,
  Array<{ prompt?: string; image_prompt?: string; video_prompt?: string; sentence?: string }>
>;

export const runtime = 'nodejs';

function resolveOutDir(
  savePathRoot: string | undefined,
  folderName: string,
): string {
  const root =
    (savePathRoot && savePathRoot.trim()) ||
    path.join(process.cwd(), 'exports', 'ship-packs');
  return path.join(/* turbopackIgnore: true */ root, folderName);
}

function stripQuery(p: string): string {
  const s = String(p || '').trim();
  if (!s) return '';
  // file:/// or cache-busted ?t=
  const noQuery = s.split('?')[0] || s;
  try {
    if (noQuery.startsWith('file:')) {
      return decodeURIComponent(noQuery.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
    }
  } catch {
    /* ignore */
  }
  return noQuery;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    try {
      await assertPremiumAccessHard(req, body);
    } catch (gateErr) {
      return responseForGateFailure(gateErr, 'ship_pack', undefined, body);
    }
    const mode = (body.mode || body.defaultShipMode || 'longform') as ShipMode;
    const channelRaw = body.channel as Partial<ChannelProfile> | undefined;
    const channel = normalizeChannelProfile(channelRaw);
    if (!channel) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid channel profile' },
        { status: 400 },
      );
    }

    const chapter = body.chapter || {
      so_chuong: body.chapterNum || 1,
      tieu_de: body.tieu_de || `Chương ${body.chapterNum || 1}`,
      dan_y: body.dan_y || '',
      noi_dung: body.noi_dung || body.content || '',
    };

    if (!String(chapter.noi_dung || chapter.dan_y || '').trim()) {
      return NextResponse.json(
        { ok: false, error: 'Chapter content is empty — nothing to ship' },
        { status: 400 },
      );
    }

    const input: ShipPackInput = {
      channel,
      mode,
      ten_tac_pham: body.ten_tac_pham || channel.name || 'Untitled',
      chapter: {
        so_chuong: Number(chapter.so_chuong) || 1,
        tieu_de: chapter.tieu_de || '',
        dan_y: chapter.dan_y || '',
        noi_dung: chapter.noi_dung || '',
      },
      chapterHooks: body.chapterHooks || null,
      voiceCast: body.voiceCast || null,
      nhan_vat: body.nhan_vat || [],
      nhan_vat_prompts: body.nhan_vat_prompts || {},
      generatedAudioPaths: body.generatedAudioPaths || {},
      generatedImages: body.generatedImages || {},
      generatedVideos: body.generatedVideos || {},
      generatedPrompts: body.generatedPrompts || {},
      generatedAssetDna: body.generatedAssetDna || {},
      liveMediaDna: body.liveMediaDna || undefined,
      savePathRoot: body.savePathRoot || channel.savePathRoot,
      so_tu_chuong:
        typeof body.so_tu_chuong === 'number' && body.so_tu_chuong > 0
          ? body.so_tu_chuong
          : typeof body.setup?.so_tu_chuong === 'number' && body.setup.so_tu_chuong > 0
            ? body.setup.so_tu_chuong
            : undefined,
    };

    const pack = buildShipPack(input);
    const outDir = resolveOutDir(input.savePathRoot, pack.folderName);
    fs.mkdirSync(outDir, { recursive: true });

    const written: string[] = [];
    for (const file of pack.files) {
      const abs = path.join(outDir, file.relativePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.content, 'utf8');
      written.push(abs);
    }

    // Physical media copy (audio / images / videos / thumb) into pack folder
    const copiedMedia: string[] = [];
    const copyErrors: string[] = [];
    for (const item of pack.mediaCopyList || []) {
      try {
        const src = stripQuery(item.sourcePath);
        if (!src || !fs.existsSync(src)) {
          copyErrors.push(`missing: ${item.key} → ${src || '(empty)'}`);
          continue;
        }
        const dest = path.join(outDir, item.suggestedName);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copiedMedia.push(dest);
        written.push(dest);
      } catch (e) {
        copyErrors.push(
          `${item.key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    fs.writeFileSync(
      path.join(outDir, 'media_copy_result.json'),
      JSON.stringify(
        {
          copied: copiedMedia.length,
          errors: copyErrors,
          files: copiedMedia.map((p) => path.relative(outDir, p)),
        },
        null,
        2,
      ),
      'utf8',
    );

    // Core pipeline: attach FableCut timeline into ship pack when images exist
    let fablecutPath: string | undefined;
    try {
      const { runChapterPipeline } = await import('@/lib/integrations/chapterPipeline');
      const { extractEntitlementToken } = await import('@/lib/entitlement');
      const pipe = await runChapterPipeline({
        chapterNum: pack.chapterNum,
        title: input.chapter.tieu_de,
        ten_tac_pham: input.ten_tac_pham,
        sceneTexts: [input.chapter.noi_dung || input.chapter.dan_y || ''].filter(Boolean),
        characterNames: input.nhan_vat || [],
        generatedImages: input.generatedImages,
        generatedAudioPaths: input.generatedAudioPaths,
        generatedVideos: input.generatedVideos,
        generatedPrompts: input.generatedPrompts as ChapterPipelinePrompts | undefined,
        runSeedance: true,
        runFableCut: true,
        liveEditor: false,
        autoStartFableCut: false,
        aspect: pack.recipe?.aspectRatio === '16:9' ? '16:9' : '9:16',
        entitlementToken: extractEntitlementToken(req, body),
      });
      if (pipe.fablecut?.success && pipe.fablecut.projectPath && fs.existsSync(pipe.fablecut.projectPath)) {
        const dest = path.join(outDir, 'fablecut', 'project.json');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(pipe.fablecut.projectPath, dest);
        written.push(dest);
        fablecutPath = dest;
        // copy media folder if sibling
        const mediaSrc = pipe.fablecut.mediaDir;
        if (mediaSrc && fs.existsSync(mediaSrc)) {
          const mediaDest = path.join(outDir, 'fablecut', 'media');
          fs.mkdirSync(mediaDest, { recursive: true });
          for (const name of fs.readdirSync(mediaSrc)) {
            const from = path.join(mediaSrc, name);
            const to = path.join(mediaDest, name);
            if (fs.statSync(from).isFile()) {
              fs.copyFileSync(from, to);
              written.push(to);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[ship-pack] fablecut attach skipped:', (e as Error).message);
    }

    console.log(
      JSON.stringify({
        event: 'ship_pack_written',
        mode: pack.mode,
        channelId: pack.channelId,
        chapter: pack.chapterNum,
        outDir,
        files: written.length,
        fablecut: Boolean(fablecutPath),
      }),
    );

    // Auto-save Ship Pack into active channel ship_pack folder
    try {
      const { autoSaveToChannelFolder } = require('@/lib/channelMediaMirror');
      autoSaveToChannelFolder({
        channelName: body.ten_tac_pham || pack.channelId || 'Kênh Chính',
        resourceType: 'ship_pack',
        sourceFilePath: outDir,
      });
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      ok: true,
      mode: pack.mode,
      folderName: pack.folderName,
      outDir,
      files: written,
      checklist: pack.checklist,
      manifest: pack.manifest,
      recipe: pack.recipe,
      fablecutPath,
      mediaCopied: copiedMedia.length,
      mediaCopyErrors: copyErrors,
    });

  } catch (err: unknown) {
    console.error('[ship-pack]', err);
    return NextResponse.json(
      { ok: false, ...toErrorJson(err) },
      { status: httpStatusFromError(err) },
    );
  }
}
