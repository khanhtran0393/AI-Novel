'use client';
import {
  API,
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
} from '@/contracts';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  generateImagePromptAction,
  regenPromptAction,
  generateImageAction
} from '../modules/imageModule';
import { generateVideoAction } from '../modules/videoModule';
import { scheduleSilentChapterTimeline } from '../modules/integrationsModule';
import {
  applyShotScaleToPrompt,
  checkImagePathReuse,
  mergeYoutubeSafe,
} from '@/lib/youtubeSafe';
import { toast } from '@/lib/toastBus';
import {
  createBatchJob,
  runBatchJob,
  jobProgress,
} from '@/lib/jobQueue';

function hasImageCredentials(store: ReturnType<typeof useNovelStore.getState>): boolean {
  // Google Flow: credential = browser session (extension + ya29), not API key
  if (store.imageProvider === 'flow') return true;
  const hasApiKey = !!store.apiKey || (store.apiKeys && store.apiKeys.length > 0);
  const hasCookie =
    !!store.googleStudioCookie ||
    (store.googleStudioCookies && store.googleStudioCookies.length > 0);
  const hasOpenAiKey =
    !!store.openaiApiKey || (store.openaiApiKeys && store.openaiApiKeys.length > 0);
  const hasGrokKey = !!store.grokApiKey || (store.grokApiKeys && store.grokApiKeys.length > 0);
  if (store.imageProvider === 'openai') return hasOpenAiKey;
  if (store.imageProvider === 'grok') return hasGrokKey;
  return hasApiKey || hasCookie;
}

function hasVideoCredentials(store: ReturnType<typeof useNovelStore.getState>): boolean {
  if (store.videoProvider === 'flow' || store.videoProvider === 'ffmpeg') return true;
  return Boolean(resolveVideoApiKey(store));
}

function resolveVideoApiKey(store: ReturnType<typeof useNovelStore.getState>): string {
  if (store.videoProvider === 'flow') return ''; // session via extension bridge
  if (store.videoProvider === 'luma') {
    return store.lumaApiKey || store.lumaApiKeys?.[0] || '';
  }
  if (store.videoProvider === 'runway') {
    return store.runwayApiKey || store.runwayApiKeys?.[0] || '';
  }
  if (store.videoProvider === 'sora') {
    return store.openaiApiKey || store.openaiApiKeys?.[0] || '';
  }
  if (store.videoProvider === 'grok') {
    return store.grokApiKey || store.grokApiKeys?.[0] || '';
  }
  return store.apiKey || store.apiKeys?.[0] || '';
}

/** Ensure Flow bridge session before gen (server-side bootstrap if needed). */
async function ensureFlowSessionReady(): Promise<void> {
  try {
    const st = await fetch(API.flowStatus, { cache: 'no-store' }).then((r) => r.json());
    if (st?.extensionConnected && st?.flowKeyPresent) return;
    toast.info(
      'Flow',
      'Đang kết nối browser + extension (Chromium sạch)…',
    );
    const res = await fetch(API.flowBootstrap, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forceChrome: !st?.extensionConnected,
        engine: 'auto',
        waitExtensionMs: 35000,
        waitLoginMs: 20000,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.flowKeyPresent && !data.extensionConnected) {
      throw new Error(
        data.message ||
          'Flow chưa sẵn sàng. Ảnh/Video → Engine Auto (Playwright/Ungoogled) → Đăng nhập Google.',
      );
    }
    if (!data.flowKeyPresent) {
      throw new Error(
        'Extension đã nối nhưng chưa có token. Đăng nhập Google trên cửa sổ browser Flow rồi thử lại.',
      );
    }
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}

/**
 * Media actions stay step-by-step for user QA.
 * Seedance / formula / timeline run as silent logic inside APIs & after gen — no extra hub buttons.
 */
export function useImagePromptActions() {
  const store = useNovelStore();
  const [generatingPrompt, setGeneratingPrompt] = useState<{ [sceneIndex: number]: boolean }>({});
  const [regeneratingSinglePrompt, setRegeneratingSinglePrompt] = useState<{ [key: string]: boolean }>({});
  const [generatingImage, setGeneratingImage] = useState<Record<string, boolean>>({});
  const [generatingVideo, setGeneratingVideo] = useState<Record<string, boolean>>({});

  const resolveMediaStyle = () => (
    store.visualDnaPrompt?.trim() ||
    store.mediaStylePreset?.trim() ||
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials'
  );

  const parsePromptDuration = (timestamp?: string) => {
    const match = String(timestamp || '').match(/^(\d{1,2})-/);
    const duration = match ? Number(match[1]) : 0;
    return duration > 0 ? duration : (store.videoDuration || 6);
  };

  /** Step 1 — prompts only. Seedance formula applied inside /api/generate. */
  const handleGenerateImagePrompt = async (
    sceneText: string,
    sceneIndex: number,
    duration: number,
  ) => {
    setGeneratingPrompt((prev) => ({ ...prev, [sceneIndex]: true }));
    const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
    store.addGeneratedPrompts(assetKey, []);
    try {
      const prompts = await generateImagePromptAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneText,
        duration,
        style: resolveMediaStyle(),
        nhan_vat_prompts: store.nhan_vat_prompts,
        wpm: store.wpm || 140,
        secondsPerBeat: store.secondsPerBeat || 6,
      });

      const promptsWithKey = prompts as unknown as { usedApiKey?: string };
      if (promptsWithKey.usedApiKey) {
        store.prioritizeApiKey(promptsWithKey.usedApiKey);
      }

      const yt = mergeYoutubeSafe(useNovelStore.getState().youtubeSafe);
      const withShots = yt.enforceShotGraph
        ? prompts.map((p, i) => {
            const img =
              (p as { image_prompt?: string; prompt?: string }).image_prompt ||
              (p as { prompt?: string }).prompt ||
              '';
            const next = applyShotScaleToPrompt(img, i);
            return { ...p, prompt: next, image_prompt: next };
          })
        : prompts;

      store.addGeneratedPrompts(assetKey, withShots);
      toast.success('Prompt Studio', `Đã sinh ${withShots.length} prompt.`);
    } catch (err: unknown) {
      toast.error('Lỗi sinh Prompt', err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPrompt((prev) => ({ ...prev, [sceneIndex]: false }));
    }
  };

  const handleRegenPrompt = async (
    sceneIndex: number,
    promptIndex: number,
    sentence: string,
    currentPrompt: string,
  ) => {
    const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
    const key = imageAssetKey(store.chuong_dang_chon, sceneIndex, promptIndex);

    setRegeneratingSinglePrompt((prev) => ({ ...prev, [key]: true }));
    try {
      const newPromptStr = await regenPromptAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneIndex,
        promptIndex,
        sentence,
        currentPrompt,
        style: resolveMediaStyle(),
        nhan_vat_prompts: store.nhan_vat_prompts,
      });

      if (newPromptStr) {
        // Formula layer: Seedance video_prompt when rewriting a single shot
        let videoPrompt = `Image-to-video: preserve identity from still; one camera move; visible beat. Visual: ${newPromptStr}`;
        try {
          const seedRes = await fetch(API.integrations.seedance, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sceneText: newPromptStr,
              hasStartImage: true,
              durationSec: 5,
              genre: 'dark survival / mạt thế',
            }),
          });
          const seedData = await seedRes.json();
          if (seedData?.result?.prompt) videoPrompt = seedData.result.prompt;
        } catch {
          /* keep fallback */
        }

        const currentPrompts = store.generatedPrompts[assetKey] || [];
        const updated = [...currentPrompts];
        if (updated[promptIndex]) {
          updated[promptIndex] = {
            ...updated[promptIndex],
            prompt: newPromptStr,
            image_prompt: newPromptStr,
            video_prompt: videoPrompt,
          };
          store.addGeneratedPrompts(assetKey, updated);
        }
      }
    } catch (err: unknown) {
      toast.error('Lỗi viết lại prompt', err instanceof Error ? err.message : String(err));
    } finally {
      setRegeneratingSinglePrompt((prev) => ({ ...prev, [key]: false }));
    }
  };

  const isPolicyImageError = (msg: string) =>
    /policy|safety|blocked|không được phép|violat|nsfw|prohibited|content filter|unsafe/i.test(
      msg || '',
    );

  /** Step 2 — images. Uses image_prompt already directed by server formulas. */
  const handleGenerateImage = async (
    sceneIndex: number,
    promptIndex: number,
    prompt: string,
    sentence: string,
    silentError: boolean = false,
  ) => {
    if (!store.deductCredits(1)) {
      if (!silentError) {
        toast.error('Hết tín dụng', 'Nạp thêm để gen ảnh.');
      }
      throw new Error('HẾT_TÍN_DỤNG');
    }
    const key = imageAssetKey(store.chuong_dang_chon, sceneIndex, promptIndex);

    store.addGeneratedImage(key, '');
    store.addGeneratedImageVariants(key, []);
    setGeneratingImage((prev) => ({ ...prev, [key]: true }));

    const runOnce = async (activePrompt: string) => {
      const st = useNovelStore.getState();
      if (st.imageProvider === 'flow') {
        await ensureFlowSessionReady();
      }
      const cookiesList = st.googleStudioCookies || [];
      const selectedCookie =
        cookiesList[promptIndex % Math.max(1, cookiesList.length)] || st.googleStudioCookie;

      let resolvedImageApiKey = '';
      if (st.imageProvider === 'openai') {
        resolvedImageApiKey = st.openaiApiKey || st.openaiApiKeys?.[0] || '';
      } else if (st.imageProvider === 'gemini') {
        resolvedImageApiKey = st.apiKey || st.apiKeys?.[0] || '';
      } else if (st.imageProvider === 'grok') {
        resolvedImageApiKey = st.grokApiKey || st.grokApiKeys?.[0] || '';
      }

      return generateImageAction({
        prompt: activePrompt,
        sentence,
        chapterNum: st.chuong_dang_chon,
        sceneIndex,
        promptIndex,
        savePathImage: st.savePathImage || '',
        googleDrivePath: st.googleDrivePath || '',
        ten_tac_pham: st.ten_tac_pham || 'Kịch Bản Vô Danh',
        selectedCookie,
        nhan_vat: st.nhan_vat || [],
        nhan_vat_prompts: st.nhan_vat_prompts,
        apiKey: st.apiKey,
        apiKeys: st.apiKeys || [],
        model: st.imageModel,
        imageProvider: st.imageProvider || 'flow',
        imageApiKey: resolvedImageApiKey,
        imageAspectRatio: st.imageAspectRatio || '16:9',
        imageCount: st.imageCount || 1,
        aiMasterApiKey: st.aiMasterApiKey,
      });
    };

    try {
      let activePrompt = prompt;
      let data;
      try {
        data = await runOnce(activePrompt);
      } catch (firstErr: unknown) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (!isPolicyImageError(msg)) throw firstErr;
        // Auto rewrite prompt once then retry (policy / safety)
        toast.warn('Policy ảnh', 'Đang viết lại prompt rồi gen lại…');
        const style =
          useNovelStore.getState().visualDnaPrompt?.trim() ||
          useNovelStore.getState().mediaStylePreset ||
          'cinematic natural realism';
        const rewritten = await regenPromptAction({
          apiKey: store.apiKey,
          apiKeys: store.apiKeys || [],
          sceneIndex,
          promptIndex,
          sentence: sentence || 'storyboard still',
          currentPrompt: activePrompt,
          style,
          nhan_vat_prompts: store.nhan_vat_prompts || {},
        });
        if (rewritten?.trim()) {
          activePrompt = rewritten.trim();
          const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
          const list = [...(useNovelStore.getState().generatedPrompts[assetKey] || [])];
          if (list[promptIndex]) {
            list[promptIndex] = {
              ...list[promptIndex],
              prompt: activePrompt,
              image_prompt: activePrompt,
            };
            store.addGeneratedPrompts(assetKey, list);
          }
          if (!store.deductCredits(1)) throw firstErr;
          data = await runOnce(activePrompt);
        } else {
          throw firstErr;
        }
      }

      if (data.usedApiKey) {
        store.prioritizeApiKey(data.usedApiKey);
      }

      const cacheBust = Date.now();
      const imagePaths =
        data.imagePaths && data.imagePaths.length > 0 ? data.imagePaths : [data.imagePath];
      const cacheBustedImagePaths = imagePaths
        .filter(Boolean)
        .map((path) => `${path}?t=${cacheBust}`);
      const primary = cacheBustedImagePaths[0] || `${data.imagePath}?t=${cacheBust}`;
      const yt = mergeYoutubeSafe(useNovelStore.getState().youtubeSafe);
      if (yt.enforceAntiReuse) {
        const reuse = checkImagePathReuse(primary, useNovelStore.getState().generatedImages, key);
        if (reuse.reused) {
          console.warn(`[Anti-Reuse] Image path reused from ${reuse.otherKey}`);
          if (!silentError) {
            toast.warn(
              'Anti-reuse',
              `File ảnh trùng slot ${reuse.otherKey}. Nên tạo lại ảnh.`,
            );
          }
        }
      }
      store.addGeneratedImage(key, primary);
      store.addGeneratedImageVariants(key, cacheBustedImagePaths);
      if (data.projectUrl) {
        store.addProjectUrl(key, data.projectUrl);
      }
      console.log(
        `[Image Builder] c${sceneIndex + 1}-${promptIndex + 1} via ${data.method || 'unknown'}: ${data.imagePath}`,
      );
    } catch (err: unknown) {
      if (!silentError) {
        const e = err as Error & { correlationId?: string };
        const cid = e?.correlationId ? ` · cid ${e.correlationId}` : '';
        toast.error(
          'Lỗi gen ảnh',
          `${err instanceof Error ? err.message : String(err)}${cid}`,
        );
      }
      throw err;
    } finally {
      setGeneratingImage((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleGenerateAllImages = async (sceneIndex: number) => {
    const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
    const promptsAsset = useNovelStore.getState().generatedPrompts[assetKey] || [];
    if (promptsAsset.length === 0) {
      toast.warn('Chưa có prompt', 'Bấm "Gen Prompt Studio" trước.');
      return;
    }

    if (!hasImageCredentials(useNovelStore.getState())) {
      toast.error(
        'Thiếu credential ảnh',
        'Flow: kết nối browser trong Ảnh/Video. Hoặc cấu hình API key / Cookie (legacy).',
      );
      return;
    }

    const job = createBatchJob({
      title: `Gen ảnh · Ch.${store.chuong_dang_chon} · Cảnh ${sceneIndex + 1}`,
      kind: 'image',
      concurrency: 3,
      items: promptsAsset.map((promptItem, pIdx) => ({
        label: `p${pIdx + 1}`,
        meta: {
          sceneIndex,
          pIdx,
          prompt: promptItem.image_prompt || promptItem.prompt,
          sentence: promptItem.sentence || promptItem.script_prompt || '',
        },
      })),
    });

    toast.info(
      'Job ảnh đã xếp hàng',
      `${promptsAsset.length} shot · pause/cancel trong panel Jobs`,
    );

    const finished = await runBatchJob(job.id, async (item) => {
      const meta = item.meta || {};
      await handleGenerateImage(
        Number(meta.sceneIndex),
        Number(meta.pIdx),
        String(meta.prompt || ''),
        String(meta.sentence || ''),
        true,
      );
    });

    const p = finished ? jobProgress(finished) : null;
    if (p && p.failed > 0) {
      toast.warn('Gen ảnh xong (có lỗi)', `${p.done}/${p.total} · ${p.failed} fail`);
    } else {
      toast.success('Gen ảnh hoàn tất', p ? `${p.done}/${p.total}` : undefined);
    }
    // Silent: refresh FableCut timeline artifact (no UI button)
    scheduleSilentChapterTimeline({ chapterNum: store.chuong_dang_chon });
  };

  /** Step 3 — video. Seedance re-applied inside /api/generate-video. */
  const handleGenerateVideo = async (
    sceneIndex: number,
    startPromptIndex: number,
    endPromptIndex: number,
    prompt: string,
    silentError: boolean = false,
  ) => {
    if (!store.deductCredits(2)) {
      if (!silentError) {
        toast.error('Hết tín dụng', 'Nạp thêm để gen video.');
      }
      throw new Error('HẾT_TÍN_DỤNG');
    }
    const key = videoAssetKey(store.chuong_dang_chon, sceneIndex, endPromptIndex);
    setGeneratingVideo((prev) => ({ ...prev, [key]: true }));
    store.addGeneratedVideo(key, '');

    try {
      const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
      const startKey = imageAssetKey(store.chuong_dang_chon, sceneIndex, startPromptIndex);
      const endKey = imageAssetKey(store.chuong_dang_chon, sceneIndex, endPromptIndex);
      const st = useNovelStore.getState();
      if (st.videoProvider === 'flow') {
        await ensureFlowSessionReady();
      }
      const startImage = st.generatedImages?.[startKey];
      const endImage = st.generatedImages?.[endKey];

      const promptsAsset = st.generatedPrompts[assetKey] || [];
      const endPromptItem = promptsAsset[endPromptIndex];
      const finalPrompt = endPromptItem?.video_prompt || prompt;

      // Flow: T2V (text only) or I2V (1+ images). Legacy providers need 2 frames.
      const isFlow = st.videoProvider === 'flow';
      if (!isFlow && (!startImage || !endImage)) {
        throw new Error(
          'Cần sinh ảnh cho cả 2 Prompt trước khi tạo Video nội suy (provider legacy)!',
        );
      }
      if (isFlow && !finalPrompt?.trim()) {
        throw new Error('Thiếu prompt video (Flow T2V).');
      }

      const promptDuration = parsePromptDuration(endPromptItem?.timestamp);
      const characterHints = [
        ...(st.nhan_vat || []),
        ...Object.keys(st.nhan_vat_prompts || {}),
      ].filter(Boolean);

      const data = await generateVideoAction({
        chapterNum: st.chuong_dang_chon,
        sceneIndex,
        promptIndex: endPromptIndex,
        prompt: finalPrompt,
        duration: promptDuration || st.videoDuration || 6,
        startImage: startImage || undefined,
        endImage: endImage || undefined,
        model: st.videoModel,
        videoProvider: st.videoProvider || 'flow',
        videoApiKey: resolveVideoApiKey(st),
        videoAspectRatio: st.videoAspectRatio || '16:9',
        useGpuAcceleration: st.useGpuAcceleration,
        characterHints,
        genre: 'dark survival / mạt thế',
        environmentHint: st.visualDnaPrompt || st.mediaStylePreset,
      });

      console.log(`[Video Builder] Successfully generated video: ${data.videoPath}`);
      if (data.videoPath) {
        store.addGeneratedVideo(key, data.videoPath);
      }
      scheduleSilentChapterTimeline({ chapterNum: st.chuong_dang_chon, delayMs: 800 });
      if (!silentError) {
        toast.success(
          'Video xong',
          `c${sceneIndex + 1}-${String(endPromptIndex + 1).padStart(2, '0')}`,
        );
      }
    } catch (err: unknown) {
      if (!silentError) {
        toast.error('Lỗi gen video', err instanceof Error ? err.message : String(err));
      }
      throw err;
    } finally {
      setGeneratingVideo((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleGenerateAllVideos = async (sceneIndex: number) => {
    const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
    const st0 = useNovelStore.getState();
    const promptsAsset = st0.generatedPrompts[assetKey] || [];
    if (promptsAsset.length < 1) {
      toast.warn('Gen video', 'Cần ít nhất 1 prompt (Flow T2V) hoặc prompt + ảnh.');
      return;
    }
    if (!hasVideoCredentials(st0)) {
      toast.error('Thiếu credential video', 'Flow: kết nối browser. Legacy: API key.');
      return;
    }

    // Flow: each prompt can be T2V alone; legacy: adjacent pairs for I2V
    const pairs: Array<[number, number]> = [];
    if (st0.videoProvider === 'flow') {
      for (let i = 0; i < promptsAsset.length; i++) {
        pairs.push([i, i]);
      }
    } else if (promptsAsset.length === 1) {
      pairs.push([0, 0]);
    } else {
      for (let i = 1; i < promptsAsset.length; i++) {
        pairs.push([i - 1, i]);
      }
    }

    const job = createBatchJob({
      title: `Gen video · Ch.${store.chuong_dang_chon} · Cảnh ${sceneIndex + 1}`,
      kind: 'video',
      concurrency: 1,
      items: pairs.map(([startIdx, endIdx]) => ({
        label: `v${startIdx + 1}-${endIdx + 1}`,
        meta: {
          sceneIndex,
          startIdx,
          endIdx,
          prompt:
            promptsAsset[endIdx].video_prompt || promptsAsset[endIdx].prompt || '',
        },
      })),
    });

    toast.info('Job video đã xếp hàng', `${pairs.length} clip · Jobs panel pause/cancel/retry`);

    const finished = await runBatchJob(job.id, async (item) => {
      const meta = item.meta || {};
      await handleGenerateVideo(
        Number(meta.sceneIndex),
        Number(meta.startIdx),
        Number(meta.endIdx),
        String(meta.prompt || ''),
        true,
      );
    });

    const p = finished ? jobProgress(finished) : null;
    if (p && p.failed > 0) {
      toast.warn('Gen video xong (có lỗi)', `${p.done}/${p.total} · ${p.failed} fail`);
    } else {
      toast.success('Gen video hoàn tất', p ? `${p.done}/${p.total}` : undefined);
    }
    scheduleSilentChapterTimeline({ chapterNum: store.chuong_dang_chon, delayMs: 400 });
  };

  return {
    generatingPrompt,
    regeneratingSinglePrompt,
    generatingImage,
    generatingVideo,
    handleGenerateImagePrompt,
    handleRegenPrompt,
    handleGenerateImage,
    handleGenerateAllImages,
    handleGenerateVideo,
    handleGenerateAllVideos,
  };
}
