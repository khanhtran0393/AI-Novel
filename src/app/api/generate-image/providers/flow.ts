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
    const sessionReady =
      Boolean(snap.extensionConnected) && Boolean(snap.flowKeyPresent);
    if (!sessionReady) {
      console.log(
        `[Flow Image] Session incomplete ext=${snap.extensionConnected} key=${snap.flowKeyPresent} — auto bootstrap…`,
      );
      const boot = await bootstrapFlow({
        forceChrome: !snap.extensionConnected || !snap.flowKeyPresent,
        engine: 'auto',
        waitExtensionMs: 40000,
        waitLoginMs: 25000,
      });
      snap = await getBridgeSnapshotAsync();
      if (!snap.flowKeyPresent || !snap.extensionConnected) {
        const detail =
          boot.message ||
          (!snap.extensionConnected
            ? 'Extension chưa nối — đang/đã thử mở browser.'
            : 'Chưa có token — đăng nhập Google trên browser Flow của app.');
        return NextResponse.json(
          {
            error: `[Google Flow] ${detail}`,
            loginRequired: Boolean(boot.loginRequired) || !snap.flowKeyPresent,
            extensionConnected: snap.extensionConnected,
            flowKeyPresent: snap.flowKeyPresent,
            chromeLaunched: boot.chromeLaunched,
            steps: boot.steps?.slice(-12),
          },
          { status: 503 },
        );
      }
    }
    if (!snap.flowKeyPresent) {
      return NextResponse.json(
        {
          error:
            '[Google Flow] Chưa có token. Ảnh/Video → Engine Auto → Đăng nhập Google trên browser app mở.',
          loginRequired: true,
          extensionConnected: snap.extensionConnected,
          flowKeyPresent: false,
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

    // quality from body if present (2k/4k → FlowAgent upsample stage); default HD (P1)
    const quality =
      typeof ctx.body.imageQuality === 'string'
        ? ctx.body.imageQuality
        : typeof ctx.body.quality === 'string'
          ? ctx.body.quality
          : 'hd';

    const result = await runGenerateOne({
      kind: ctx.body.edit === true || ctx.body.kind === 'edit' ? 'edit' : 'image',
      prompt: providerPrompt,
      chapterNum,
      sceneIndex,
      promptIndex,
      aspectRatio: imageAspectRatio,
      imageCount,
      // resolveFlowImageModelName applied inside payloadBuilder
      imageModel:
        model && model !== 'flow' && model !== 'imagen' ? model : 'GEM_PIX_2',
      referenceImagePath,
      quality,
      camera:
        ctx.body.camera && typeof ctx.body.camera === 'object'
          ? ctx.body.camera
          : {
              scaleIndex: Number(promptIndex) % 6,
              move: 'static',
              angle: 'eye',
              focal: Number(promptIndex) % 6 <= 1 ? 'tele' : 'normal',
            },
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
