import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { ImageProviderCtx } from '../imageTypes';
import {
  bootstrapFlow,
  ensureBridgeStarted,
  getBridgeSnapshotAsync,
  runGenerateOne,
} from '@/lib/flow-bridge';

/**
 * Google Flow (labs) image generation via extension bridge.
 */
export async function generateWithFlow(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  const {
    providerPrompt,
    imageAspectRatio,
    imageCount,
    referenceImageB64,
    referenceMime,
    saveImage,
    saveImageBuffers,
    model,
    chapterNum,
    sceneIndex,
    promptIndex,
    localSavePath,
  } = ctx;

  try {
    await ensureBridgeStarted();
    let snap = await getBridgeSnapshotAsync();
    if (!snap.flowKeyPresent || !snap.extensionConnected) {
      console.log('[Flow Image] Session incomplete — auto bootstrap…');
      await bootstrapFlow({
        forceChrome: !snap.extensionConnected,
        engine: 'auto',
        waitExtensionMs: 35000,
        waitLoginMs: 15000,
      });
      snap = await getBridgeSnapshotAsync();
    }
    if (!snap.flowKeyPresent) {
      return NextResponse.json(
        {
          error:
            '[Google Flow] Chưa có token. Ảnh/Video → Engine Auto (Playwright/Ungoogled) → Đăng nhập Google trên browser app mở.',
        },
        { status: 503 },
      );
    }

    let referenceImagePath: string | undefined;
    if (referenceImageB64) {
      const tmpDir = path.join(process.cwd(), 'scratch', 'flow-refs');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ext =
        referenceMime?.includes('jpeg') || referenceMime?.includes('jpg')
          ? 'jpg'
          : 'png';
      referenceImagePath = path.join(
        tmpDir,
        `ref_c${chapterNum}_s${sceneIndex}_p${promptIndex}.${ext}`,
      );
      fs.writeFileSync(referenceImagePath, Buffer.from(referenceImageB64, 'base64'));
    }

    // quality from body if present (2k/4k → FlowAgent upsample stage)
    const quality =
      typeof ctx.body.imageQuality === 'string'
        ? ctx.body.imageQuality
        : typeof ctx.body.quality === 'string'
          ? ctx.body.quality
          : '1k';

    const result = await runGenerateOne({
      kind: 'image',
      prompt: providerPrompt,
      chapterNum,
      sceneIndex,
      promptIndex,
      aspectRatio: imageAspectRatio,
      imageCount,
      imageModel: model && model !== 'flow' && model !== 'imagen' ? model : 'GEM_PIX_2',
      referenceImagePath,
      quality,
    });

    if (!result.ok || !result.resultPaths?.length) {
      return NextResponse.json(
        {
          error: `[Google Flow] ${result.error || 'Sinh ảnh thất bại. Kiểm tra extension + đăng nhập Flow.'}`,
        },
        { status: 500 },
      );
    }

    const buffers = result.resultPaths.map((p) => fs.readFileSync(p));
    if (buffers.length > 1) {
      return saveImageBuffers(buffers, 'flow', undefined);
    }

    // Ensure primary path matches expected localSavePath for storyboard
    if (localSavePath && result.resultPaths[0] !== localSavePath) {
      try {
        fs.mkdirSync(path.dirname(localSavePath), { recursive: true });
        fs.copyFileSync(result.resultPaths[0], localSavePath);
      } catch {
        /* ignore */
      }
    }

    return saveImage(buffers[0], 'flow', undefined);
  } catch (e) {
    return NextResponse.json(
      {
        error: `[Google Flow] ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 },
    );
  }
}
