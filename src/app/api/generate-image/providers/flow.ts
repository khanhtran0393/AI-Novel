import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { ImageProviderCtx } from '../imageTypes';
import {
  bootstrapFlow,
  ensureBridgeStarted,
  getBridgeSnapshotAsync,
  isLiveFlowGenerationSession,
  isVerifiedFlowAccountSession,
  resolveFlowImageModelName,
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
    ingredientPaths,
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
    const activeAccount = snap.accounts?.find(
      (account) => account.id === snap.activeAccountId,
    );
    const profileVerified = isVerifiedFlowAccountSession(activeAccount);
    const sessionReady = isLiveFlowGenerationSession(activeAccount);
    if (!sessionReady) {
      if (!profileVerified) {
        return NextResponse.json(
          {
            error:
              '[Google Flow] Profile chua dang nhap du email/token. Hay vao Anh/Video -> Media Config -> Dang nhap Google tren browser cua app, doi browser tu dong dong roi gen lai.',
            loginRequired: true,
            extensionConnected: Boolean(activeAccount?.extensionConnected),
            flowKeyPresent: Boolean(activeAccount?.flowKeyPresent),
            chromeLaunched: false,
          },
          { status: 503 },
        );
      }
      console.log(
        `[Flow Image] Session incomplete ext=${snap.extensionConnected} key=${snap.flowKeyPresent} — auto bootstrap…`,
      );
      const boot = await bootstrapFlow({
        forceChrome: false,
        accountId: snap.activeAccountId || undefined,
        engine: 'auto',
        waitExtensionMs: 40000,
        waitLoginMs: 15000,
        mode: 'background',
      });
      snap = await getBridgeSnapshotAsync();
      const activeAfterBootstrap = snap.accounts?.find(
        (account) => account.id === snap.activeAccountId,
      );
      const readyAfterBootstrap =
        isLiveFlowGenerationSession(activeAfterBootstrap);
      if (!readyAfterBootstrap) {
        const detail =
          boot.message ||
          (!snap.extensionConnected
            ? 'Extension chưa nối — đang/đã thử mở browser.'
            : 'Chưa có token — đăng nhập Google trên browser Flow của app.');
        return NextResponse.json(
          {
            error: `[Google Flow] ${detail}`,
            loginRequired: !isVerifiedFlowAccountSession(activeAfterBootstrap),
            extensionConnected: Boolean(activeAfterBootstrap?.extensionConnected),
            flowKeyPresent: Boolean(activeAfterBootstrap?.flowKeyPresent),
            chromeLaunched: boot.chromeLaunched,
            steps: boot.steps?.slice(-12),
          },
          { status: 503 },
        );
      }
    }
    const activeReady = snap.accounts?.find(
      (account) => account.id === snap.activeAccountId,
    );
    if (!isLiveFlowGenerationSession(activeReady)) {
      return NextResponse.json(
        {
          error:
            '[Google Flow] Chưa có token. Ảnh/Video → Engine Auto → Đăng nhập Google trên browser app mở.',
          loginRequired: !isVerifiedFlowAccountSession(activeReady),
          extensionConnected: Boolean(activeReady?.extensionConnected),
          flowKeyPresent: Boolean(activeReady?.flowKeyPresent),
        },
        { status: 503 },
      );
    }

    // Prefer the already-resolved real file path. Re-materializing the same
    // reference from base64 creates a second path and uploads one sheet twice.
    let referenceImagePath: string | undefined = ingredientPaths[0];
    if (!referenceImagePath && referenceImageB64) {
      const tmpDir = path.join(process.cwd(), 'scratch', 'flow-refs');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ext =
        referenceMime?.includes('jpeg') || referenceMime?.includes('jpg')
          ? 'jpg'
          : 'png';
      const uniqueTag = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      referenceImagePath = path.join(
        tmpDir,
        `ref_c${chapterNum}_s${sceneIndex}_p${promptIndex}_${uniqueTag}.${ext}`,
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

    const flowImageModel = resolveFlowImageModelName(model);
    if (!flowImageModel) {
      return NextResponse.json(
        {
          error: `[Google Flow] FLOW_IMAGE_MODEL_REQUIRED — model ảnh phải được chỉ định rõ (nhận: ${String(model || '(missing)')}).`,
          imageModel: null,
        },
        { status: 400 },
      );
    }
    const explicitFlowModel = flowImageModel;

    const result = await runGenerateOne({
      kind: ctx.body.edit === true || ctx.body.kind === 'edit' ? 'edit' : 'image',
      prompt: providerPrompt,
      chapterNum,
      sceneIndex,
      promptIndex,
      aspectRatio: imageAspectRatio,
      imageCount,
      imageModel: explicitFlowModel,
      referenceImagePath,
      ingredientPaths: ingredientPaths.length ? ingredientPaths : undefined,
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
      let err =
        result.error ||
        'Sinh ảnh thất bại. Kiểm tra extension + đăng nhập Flow.';
      if (
        /invalid.?argument|INVALID_ARGUMENT|imageModelName/i.test(err) &&
        /GEM_PIX|NANO_BANANA_PRO/i.test(flowImageModel)
      ) {
        err +=
          '\n→ Thử model ảnh NARWHAL (Nano Banana 2) trong Cấu hình đầu ra — không tự đổi model.';
      }
      return NextResponse.json(
        {
          error: `[Google Flow] ${err}`,
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
