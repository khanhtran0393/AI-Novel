import fs from 'fs';
import path from 'path';

const p = path.join(process.cwd(), 'src/lib/flow-bridge/queueEngine.ts');
let s = fs.readFileSync(p, 'utf8');

if (s.includes('Video INGREDIENTS')) {
  console.log('already patched');
  process.exit(0);
}

const old = `    let startMediaId: string | undefined;
    let endMediaId: string | undefined;

    const startPath = resolveLocalImage(
      task.startImagePath || task.referenceImagePath,
    );
    if (startPath) {
      task.progress = 10;
      startMediaId = await this.uploadLocalImage(
        startPath,
        projectId,
        bridge,
        task.accountId,
      );
      if (!startMediaId) {
        throw new Error(
          \`Upload start image failed (no mediaId). path=\${startPath}\`,
        );
      }
    }

    const endPath = resolveLocalImage(task.endImagePath);
    if (endPath) {
      task.progress = 18;
      endMediaId = await this.uploadLocalImage(
        endPath,
        projectId,
        bridge,
        task.accountId,
      );
    }

    // FlowAgent practical path: T2V without start frame is flaky on aisandbox.
    // Auto-gen a still (Imagen) then I2V — same as "prompt only" UX for user.
    if (!startMediaId) {`;

const neu = `    let startMediaId: string | undefined;
    let endMediaId: string | undefined;
    let resEarly: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      null;
    let lastVidErrEarly = '';
    const vMode =
      task.videoMode || (task.kind === 'extend' ? 'extend' : 'auto');

    // P0 Extend
    if ((vMode === 'extend' || task.kind === 'extend') && task.extendMediaId) {
      task.progress = 20;
      try {
        const genEx = buildVideoExtendBody({
          projectId,
          prompt: task.prompt,
          aspectRatio: task.aspectRatio,
          videoModel: task.videoModel || 'veo_3_1_extend_fast',
          sourceMediaId: task.extendMediaId,
        });
        console.log(
          '[FlowQueue] Video EXTEND',
          task.extendMediaId.slice(0, 14),
        );
        resEarly = await bridge.requestViaExtension({
          url: genEx.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: genEx.body,
          captchaAction: genEx.captchaAction,
          timeoutMs: 90_000,
          accountId: task.accountId,
        });
        if (resEarly.error || (resEarly.status && resEarly.status >= 400)) {
          lastVidErrEarly =
            resEarly.error ||
            \`HTTP \${resEarly.status}: \${JSON.stringify(resEarly.data).slice(0, 200)}\`;
          resEarly = null;
        }
      } catch (e) {
        lastVidErrEarly = e instanceof Error ? e.message : String(e);
        resEarly = null;
      }
    }

    // P0 Ingredients 1–3
    if (
      !resEarly &&
      (vMode === 'ingredients' || (task.ingredientPaths?.length || 0) > 0)
    ) {
      const paths = (task.ingredientPaths || [])
        .map((pp) => resolveLocalImage(pp))
        .filter(Boolean) as string[];
      for (const extra of [
        task.startImagePath,
        task.referenceImagePath,
        task.endImagePath,
      ]) {
        const r = resolveLocalImage(extra);
        if (r && !paths.includes(r)) paths.push(r);
      }
      const mediaIds: string[] = [];
      task.progress = 12;
      for (const pp of paths.slice(0, 3)) {
        const mid = await this.uploadLocalImage(
          pp,
          projectId,
          bridge,
          task.accountId,
        );
        if (mid) mediaIds.push(mid);
      }
      if (mediaIds.length) {
        try {
          const videoPromptIng = injectFaceLockPrompt(task.prompt, {
            hasReference: true,
            mediaId: mediaIds[0],
          });
          const genIng = buildVideoIngredientsBody({
            projectId,
            prompt: videoPromptIng,
            aspectRatio: task.aspectRatio,
            videoModel: task.videoModel || 'veo_3_1_reference_fast',
            referenceMediaIds: mediaIds,
          });
          console.log(
            \`[FlowQueue] Video INGREDIENTS n=\${mediaIds.length}\`,
          );
          resEarly = await bridge.requestViaExtension({
            url: genIng.url,
            method: 'POST',
            headers: buildBrowserHeaders(),
            body: genIng.body,
            captchaAction: genIng.captchaAction,
            timeoutMs: 90_000,
            accountId: task.accountId,
          });
          if (resEarly.error || (resEarly.status && resEarly.status >= 400)) {
            lastVidErrEarly =
              resEarly.error ||
              \`HTTP \${resEarly.status}: \${JSON.stringify(resEarly.data).slice(0, 200)}\`;
            resEarly = null;
            startMediaId = mediaIds[0];
            endMediaId = mediaIds[1];
          }
        } catch (e) {
          lastVidErrEarly = e instanceof Error ? e.message : String(e);
          resEarly = null;
          startMediaId = mediaIds[0];
          endMediaId = mediaIds[1];
        }
      }
    }

    const startPath = resolveLocalImage(
      task.startImagePath || task.referenceImagePath,
    );
    if (startPath && !startMediaId && !resEarly) {
      task.progress = 10;
      startMediaId = await this.uploadLocalImage(
        startPath,
        projectId,
        bridge,
        task.accountId,
      );
      if (!startMediaId) {
        throw new Error(
          \`Upload start image failed (no mediaId). path=\${startPath}\`,
        );
      }
    }

    const endPath = resolveLocalImage(task.endImagePath);
    if (endPath && !endMediaId && !resEarly) {
      task.progress = 18;
      endMediaId = await this.uploadLocalImage(
        endPath,
        projectId,
        bridge,
        task.accountId,
      );
    }

    // FlowAgent practical path: T2V without start frame is flaky on aisandbox.
    // Auto-gen a still (Imagen) then I2V — same as "prompt only" UX for user.
    if (!startMediaId && !resEarly) {`;

if (!s.includes(old)) {
  console.error('OLD block not found');
  process.exit(1);
}
s = s.replace(old, neu);

const oldRes = `    let res: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      null;
    let lastVidErr = '';
    outer: for (const captchaAction of captchaStrategies) {`;

const neuRes = `    let res: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      resEarly;
    let lastVidErr = lastVidErrEarly || '';
    if (res) {
      console.log('[FlowQueue] Using early EXTEND/INGREDIENTS response');
    }
    outer: for (const captchaAction of captchaStrategies) {
      if (res) break outer;`;

if (!s.includes(oldRes)) {
  console.error('RES block not found');
  process.exit(1);
}
s = s.replace(oldRes, neuRes);

// Skip still gen if resEarly already set
s = s.replace(
  `    if (!startMediaId) {
      task.progress = 15;
      console.log('[FlowQueue] Video: no start frame → auto still then I2V');`,
  `    if (!startMediaId && !resEarly) {
      task.progress = 15;
      console.log('[FlowQueue] Video: no start frame → auto still then I2V');`,
);

// Face-lock and I2V only when no early res — wrap videoPrompt usage
// If resEarly, startMediaId may be missing; guard injectFaceLockPrompt
s = s.replace(
  `    const videoPrompt = injectFaceLockPrompt(task.prompt, {
      hasReference: true,
      mediaId: startMediaId,
    });

    task.progress = 25;`,
  `    const videoPrompt = injectFaceLockPrompt(task.prompt, {
      hasReference: Boolean(startMediaId),
      mediaId: startMediaId,
    });

    task.progress = resEarly ? 40 : 25;
    if (resEarly) {
      // jump past modelCandidates loop by keeping res set
    }`,
);

fs.writeFileSync(p, s, 'utf8');
console.log('OK patched', p);
