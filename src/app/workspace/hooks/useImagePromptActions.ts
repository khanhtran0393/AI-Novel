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
import { ensureFlowSessionReady } from '../modules/flowSessionPreflight';
import { scheduleSilentChapterTimeline } from '../modules/integrationsModule';
import {
  checkImagePathReuse,
  mergeYoutubeSafe,
} from '@/lib/youtubeSafe';
import { toast } from '@/lib/toastBus';
import {
  createBatchJob,
  runBatchJob,
  jobProgress,
} from '@/lib/jobQueue';
import {
  beginMediaGenProgress,
  completeMediaGenProgress,
} from '../modules/mediaGenSlotStore';
import { resolveCastIngredientPaths } from '@/lib/flow-bridge/castIngredients';
import { cameraFromScaleIndex } from '@/lib/flow-bridge/cameraPrompt';

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

/** Anti double-click / parallel same asset (spam gen cùng key). */
const inflightMediaKeys = new Set<string>();

function acquireMediaLock(key: string, kind: 'image' | 'video'): void {
  if (inflightMediaKeys.has(key)) {
    throw new Error(
      `Đang gen ${kind} «${key}» — không spam request trùng. Đợi xong hoặc hủy job.`,
    );
  }
  inflightMediaKeys.add(key);
}

function releaseMediaLock(key: string): void {
  inflightMediaKeys.delete(key);
}

/**
 * Media actions — progress UI chỉ qua mediaGenSlotStore (per-key).
 * Không subscribe full Zustand / không setState generating* trên parent → workspace không jank.
 * Flow preflight: modules/flowSessionPreflight (status + bootstrap + toast).
 */
export function useImagePromptActions() {
  // Chỉ state UI cho prompt (ít khi đổi) — gen ảnh/video KHÔNG dùng useState ở đây
  const [generatingPrompt, setGeneratingPrompt] = useState<{ [sceneIndex: number]: boolean }>({});
  const [regeneratingSinglePrompt, setRegeneratingSinglePrompt] = useState<{ [key: string]: boolean }>({});

  const resolveMediaStyle = () => {
    const st = useNovelStore.getState();
    const style = (st.visualDnaPrompt?.trim() || st.mediaStylePreset?.trim() || '').trim();
    if (!style) {
      throw new Error('Chua cau hinh Visual DNA / Media Style. App khong tu gan style.');
    }
    return style;
  };

  /**
   * Parse shot duration from unified start-end timestamp ("0-8.5s")
   * or legacy duration-start ("08-16"). No silent default.
   */
  const parsePromptDuration = (timestamp?: string) => {
    const s = String(timestamp || '').trim();
    const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        // Unified: start-end when end >= start
        if (b >= a) {
          const dur = Math.round((b - a) * 10) / 10;
          if (dur > 0) return dur;
        } else if (a > 0) {
          // Legacy duration-start
          return Math.round(a);
        }
      }
    }
    const st = useNovelStore.getState();
    const configured = Number(st.videoDuration);
    if (Number.isFinite(configured) && configured > 0) return configured;
    throw new Error(
      'Khong doc duoc duration tu timestamp prompt va chua cau hinh videoDuration. App khong tu gan thoi luong.',
    );
  };

  /** Step 1 — prompts only. Seedance formula applied inside /api/generate. */
  const handleGenerateImagePrompt = async (
    sceneText: string,
    sceneIndex: number,
    duration: number,
  ) => {
    setGeneratingPrompt((prev) => ({ ...prev, [sceneIndex]: true }));
    const st0 = useNovelStore.getState();
    const assetKey = sceneAssetKey(st0.chuong_dang_chon, sceneIndex);
    st0.addGeneratedPrompts(assetKey, []);
    try {
      const wpm = Number(st0.wpm);
      const beat = Number(st0.secondsPerBeat);
      if (!Number.isFinite(wpm) || wpm <= 0) {
        throw new Error('Chua cau hinh WPM (Media Config). App khong tu gan WPM.');
      }
      if (!Number.isFinite(beat) || beat <= 0) {
        throw new Error(
          'Chua cau hinh secondsPerBeat (Media Config). App khong tu gan beat.',
        );
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(
          'Thieu thoi luong scene (TTS hoac o thoi luong). App khong tu gan duration.',
        );
      }
      const chu_de = String(st0.setup?.chu_de || '').trim();
      const phong_cach = String(st0.setup?.phong_cach || '').trim();
      if (!chu_de && !phong_cach) {
        throw new Error(
          'Chua chon Setup Chu de + Phong cach. App khong tu gan mat the.',
        );
      }

      const prompts = await generateImagePromptAction({
        apiKey: st0.apiKey,
        apiKeys: st0.apiKeys || [],
        sceneText,
        duration,
        style: resolveMediaStyle(),
        nhan_vat_prompts: st0.nhan_vat_prompts,
        wpm,
        secondsPerBeat: beat,
        chapterNum: st0.chuong_dang_chon,
        sceneIndex,
        chu_de,
        phong_cach,
        genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      });

      const promptsWithKey = prompts as unknown as { usedApiKey?: string };
      if (promptsWithKey.usedApiKey) {
        useNovelStore.getState().prioritizeApiKey(promptsWithKey.usedApiKey);
      }

      // Shot graph already applied server-side — do not double-prefix on client
      useNovelStore.getState().addGeneratedPrompts(assetKey, prompts);
      toast.success('Prompt Studio', `Đã sinh ${prompts.length} prompt.`);
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
    const st0 = useNovelStore.getState();
    const assetKey = sceneAssetKey(st0.chuong_dang_chon, sceneIndex);
    const key = imageAssetKey(st0.chuong_dang_chon, sceneIndex, promptIndex);

    setRegeneratingSinglePrompt((prev) => ({ ...prev, [key]: true }));
    try {
      const chu_de = String(st0.setup?.chu_de || '').trim();
      const phong_cach = String(st0.setup?.phong_cach || '').trim();
      if (!chu_de && !phong_cach) {
        throw new Error(
          'Chua chon Setup Chu de + Phong cach. App khong tu gan mat the.',
        );
      }
      const newPromptStr = await regenPromptAction({
        apiKey: st0.apiKey,
        apiKeys: st0.apiKeys || [],
        sceneIndex,
        promptIndex,
        sentence,
        currentPrompt,
        style: resolveMediaStyle(),
        nhan_vat_prompts: st0.nhan_vat_prompts,
        chu_de,
        phong_cach,
        genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      });

      if (newPromptStr) {
        // Formula layer: Seedance video_prompt when rewriting a single shot
        const seedRes = await fetch(API.integrations.seedance, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneText: newPromptStr,
            hasStartImage: true,
            durationSec: parsePromptDuration(),
          }),
        });
        const seedData = await seedRes.json().catch(() => ({}));
        if (!seedRes.ok) {
          throw new Error(String(seedData.error || `Seedance failed (${seedRes.status})`));
        }
        const videoPrompt = String(seedData?.result?.prompt || '').trim();
        if (!videoPrompt) {
          throw new Error('Seedance khong tra video_prompt.');
        }

        const live = useNovelStore.getState();
        const currentPrompts = live.generatedPrompts[assetKey] || [];
        const updated = [...currentPrompts];
        if (updated[promptIndex]) {
          updated[promptIndex] = {
            ...updated[promptIndex],
            prompt: newPromptStr,
            image_prompt: newPromptStr,
            video_prompt: videoPrompt,
          };
          live.addGeneratedPrompts(assetKey, updated);
        }
      }
    } catch (err: unknown) {
      toast.error('Lỗi viết lại prompt', err instanceof Error ? err.message : String(err));
    } finally {
      setRegeneratingSinglePrompt((prev) => ({ ...prev, [key]: false }));
    }
  };

  /** Step 2 — images. Progress chỉ notify mediaGenSlotStore(key). Không setState parent. */
  const handleGenerateImage = async (
    sceneIndex: number,
    promptIndex: number,
    prompt: string,
    sentence: string,
    silentError: boolean = false,
  ) => {
    const stStart = useNovelStore.getState();
    const key = imageAssetKey(stStart.chuong_dang_chon, sceneIndex, promptIndex);
    try {
      acquireMediaLock(key, 'image');
    } catch (lockErr) {
      if (!silentError) {
        toast.warn(
          'Đang gen',
          lockErr instanceof Error ? lockErr.message : String(lockErr),
        );
      }
      throw lockErr;
    }
    if (!stStart.deductCredits(1)) {
      releaseMediaLock(key);
      if (!silentError) {
        toast.error('Hết tín dụng', 'Nạp thêm để gen ảnh.');
      }
      throw new Error('HẾT_TÍN_DỤNG');
    }

    // KHÔNG ghi ảnh rỗng vào Zustand (tránh re-render cả workspace).
    // KHÔNG setGeneratingImage — UI đọc generating từ mediaGenSlotStore(key).
    beginMediaGenProgress(key, { type: 'estimate', kind: 'image' });

    const runOnce = async (activePrompt: string) => {
      const st = useNovelStore.getState();
      if (!st.imageProvider?.trim()) {
        throw new Error('Chua chon imageProvider. App khong tu gan provider.');
      }
      if (!st.imageModel?.trim()) {
        throw new Error('Chua chon imageModel. App khong tu gan model.');
      }
      if (!st.ten_tac_pham?.trim()) {
        throw new Error('Chua nhap ten_tac_pham. App khong tu gan ten truyen.');
      }
      if (!st.imageAspectRatio?.trim()) {
        throw new Error('Chua chon imageAspectRatio. App khong tu gan ty le anh.');
      }
      if (!Number.isFinite(Number(st.imageCount)) || Number(st.imageCount) <= 0) {
        throw new Error('Chua chon imageCount hop le. App khong tu gan so luong anh.');
      }
      if (st.imageProvider === 'flow') {
        await ensureFlowSessionReady({ kind: 'image', notify: true });
        beginMediaGenProgress(key, {
          type: 'flow',
          kind: 'image',
          chapterNum: st.chuong_dang_chon,
          sceneIndex,
          promptIndex,
        });
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
        ten_tac_pham: st.ten_tac_pham,
        selectedCookie,
        nhan_vat: st.nhan_vat || [],
        nhan_vat_prompts: st.nhan_vat_prompts,
        apiKey: st.apiKey,
        apiKeys: st.apiKeys || [],
        model: st.imageModel,
        imageProvider: st.imageProvider,
        imageApiKey: resolvedImageApiKey,
        imageAspectRatio: st.imageAspectRatio,
        imageCount: st.imageCount,
        aiMasterApiKey: st.aiMasterApiKey,
      });
    };

    try {
      const data = await runOnce(prompt);

      if (data.usedApiKey) {
        useNovelStore.getState().prioritizeApiKey(data.usedApiKey);
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
      const live = useNovelStore.getState();
      live.addGeneratedImage(key, primary);
      live.addGeneratedImageVariants(key, cacheBustedImagePaths);
      if (data.projectUrl) {
        live.addProjectUrl(key, data.projectUrl);
      }
      completeMediaGenProgress(key, true);
      console.log(
        `[Image Builder] c${sceneIndex + 1}-${promptIndex + 1} via ${data.method || 'unknown'}: ${data.imagePath}`,
      );
    } catch (err: unknown) {
      completeMediaGenProgress(
        key,
        false,
        err instanceof Error ? err.message : 'Lỗi',
      );
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
      releaseMediaLock(key);
    }
  };

  const handleGenerateAllImages = async (sceneIndex: number) => {
    const st0 = useNovelStore.getState();
    const assetKey = sceneAssetKey(st0.chuong_dang_chon, sceneIndex);
    const promptsAsset = st0.generatedPrompts[assetKey] || [];
    if (promptsAsset.length === 0) {
      toast.warn('Chưa có prompt', 'Bấm "Gen Prompt Studio" trước.');
      return;
    }

    if (!hasImageCredentials(st0)) {
      toast.error(
        'Thiếu credential ảnh',
        'Flow: kết nối browser trong Ảnh/Video. Hoặc cấu hình API key / Cookie (legacy).',
      );
      return;
    }

    // Flow / labs: sequential + gap — anti-spam (không concurrency 3)
    const isFlow = st0.imageProvider === 'flow';
    const { FLOW_DEFAULTS } = await import('@/lib/flow-bridge/config');
    const job = createBatchJob({
      title: `Gen ảnh · Ch.${st0.chuong_dang_chon} · Cảnh ${sceneIndex + 1}`,
      kind: 'image',
      concurrency: isFlow ? FLOW_DEFAULTS.clientFlowBatchConcurrency : 1,
      itemGapMs: isFlow ? FLOW_DEFAULTS.clientFlowItemGapMs : 800,
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
      `${promptsAsset.length} shot · ${isFlow ? 'tuần tự + nghỉ chống spam Flow' : 'tuần tự'} · Jobs panel`,
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
    scheduleSilentChapterTimeline({ chapterNum: useNovelStore.getState().chuong_dang_chon });
  };

  /** Step 3 — video. Progress chỉ mediaGenSlotStore(key). */
  const handleGenerateVideo = async (
    sceneIndex: number,
    startPromptIndex: number,
    endPromptIndex: number,
    prompt: string,
    silentError: boolean = false,
  ) => {
    void prompt;
    const stStart = useNovelStore.getState();
    const key = videoAssetKey(stStart.chuong_dang_chon, sceneIndex, endPromptIndex);
    try {
      acquireMediaLock(key, 'video');
    } catch (lockErr) {
      if (!silentError) {
        toast.warn(
          'Đang gen',
          lockErr instanceof Error ? lockErr.message : String(lockErr),
        );
      }
      throw lockErr;
    }
    if (!stStart.deductCredits(2)) {
      releaseMediaLock(key);
      if (!silentError) {
        toast.error('Hết tín dụng', 'Nạp thêm để gen video.');
      }
      throw new Error('HẾT_TÍN_DỤNG');
    }

    // Không ghi video rỗng / không setState parent
    beginMediaGenProgress(key, { type: 'estimate', kind: 'video' });

    try {
      const assetKey = sceneAssetKey(stStart.chuong_dang_chon, sceneIndex);
      const startKey = imageAssetKey(stStart.chuong_dang_chon, sceneIndex, startPromptIndex);
      const endKey = imageAssetKey(stStart.chuong_dang_chon, sceneIndex, endPromptIndex);
      const st = useNovelStore.getState();
      if (!st.videoProvider?.trim()) {
        throw new Error('Chua chon videoProvider. App khong tu gan provider.');
      }
      if (!st.videoModel?.trim()) {
        throw new Error('Chua chon videoModel. App khong tu gan model.');
      }
      if (!st.videoAspectRatio?.trim()) {
        throw new Error('Chua chon videoAspectRatio. App khong tu gan ty le video.');
      }
      if (st.videoProvider === 'flow') {
        beginMediaGenProgress(key, {
          type: 'flow',
          kind: 'video',
          chapterNum: st.chuong_dang_chon,
          sceneIndex,
          promptIndex: endPromptIndex,
        });
        await ensureFlowSessionReady({ kind: 'video', notify: true });
      }
      const startImage = st.generatedImages?.[startKey];
      const endImage = st.generatedImages?.[endKey];

      const promptsAsset = st.generatedPrompts[assetKey] || [];
      const endPromptItem = promptsAsset[endPromptIndex];
      const finalPrompt = (endPromptItem?.video_prompt || '').trim();

      // Flow: T2V (text only) or I2V (1+ images). Legacy providers need 2 frames.
      const isFlow = st.videoProvider === 'flow';
      if (!isFlow && (!startImage || !endImage)) {
        throw new Error(
          'Cần sinh ảnh cho cả 2 Prompt trước khi tạo Video nội suy (provider legacy)!',
        );
      }
      if (!finalPrompt) {
        throw new Error('Thieu video_prompt. App khong dung image prompt thay the.');
      }

      const promptDuration = parsePromptDuration(endPromptItem?.timestamp);
      const characterHints = [
        ...(st.nhan_vat || []),
        ...Object.keys(st.nhan_vat_prompts || {}),
      ].filter(Boolean);

      // B — auto cast concept sheets as ingredients (max 3)
      const castPaths = resolveCastIngredientPaths({
        prompt: finalPrompt,
        sentence: endPromptItem?.sentence || endPromptItem?.script_prompt || '',
        nhan_vat: st.nhan_vat || [],
        nhan_vat_prompts: st.nhan_vat_prompts || {},
        generatedImages: st.generatedImages || {},
        max: 3,
      });
      const ingredientPaths = [...castPaths];
      for (const p of [startImage, endImage]) {
        if (p && !ingredientPaths.includes(p.split('?')[0])) {
          ingredientPaths.push(p);
        }
      }
      const videoMode =
        ingredientPaths.length >= 2
          ? 'ingredients'
          : castPaths.length >= 1
            ? 'ingredients'
            : 'auto';

      const data = await generateVideoAction(
        {
          chapterNum: st.chuong_dang_chon,
          sceneIndex,
          promptIndex: endPromptIndex,
          prompt: finalPrompt,
          duration: promptDuration,
          startImage: startImage || undefined,
          endImage: endImage || undefined,
          model: st.videoModel,
          videoProvider: st.videoProvider,
          videoApiKey: resolveVideoApiKey(st),
          videoAspectRatio: st.videoAspectRatio,
          useGpuAcceleration: st.useGpuAcceleration,
          characterHints,
          environmentHint: st.visualDnaPrompt || st.mediaStylePreset,
          ingredientPaths: ingredientPaths.slice(0, 3),
          videoMode,
          camera: cameraFromScaleIndex(endPromptIndex % 6),
        },
        { skipFlowPreflight: st.videoProvider === 'flow' },
      );

      console.log(`[Video Builder] Successfully generated video: ${data.videoPath}`);
      if (data.videoPath) {
        useNovelStore.getState().addGeneratedVideo(key, data.videoPath);
      }
      // Client + server cache mediaId for Extend button
      const mid = data.mediaId || data.mediaIds?.[0];
      if (mid && typeof window !== 'undefined') {
        try {
          localStorage.setItem(`ainovel_flow_mid_${key}`, mid);
          void fetch(API.flowMediaId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, mediaId: mid }),
          });
        } catch {
          /* ignore */
        }
      }
      completeMediaGenProgress(key, true);
      scheduleSilentChapterTimeline({
        chapterNum: useNovelStore.getState().chuong_dang_chon,
        delayMs: 800,
      });
      if (!silentError) {
        toast.success(
          'Video xong',
          `c${sceneIndex + 1}-${String(endPromptIndex + 1).padStart(2, '0')}`,
        );
      }
    } catch (err: unknown) {
      completeMediaGenProgress(
        key,
        false,
        err instanceof Error ? err.message : 'Lỗi',
      );
      if (!silentError) {
        toast.error('Lỗi gen video', err instanceof Error ? err.message : String(err));
      }
      throw err;
    } finally {
      releaseMediaLock(key);
    }
  };

  /**
   * B — Extend clip: tiếp nối video đã gen (cần Flow mediaId).
   */
  const handleExtendVideo = async (
    sceneIndex: number,
    promptIndex: number,
    silentError: boolean = false,
  ) => {
    const st0 = useNovelStore.getState();
    const key = videoAssetKey(st0.chuong_dang_chon, sceneIndex, promptIndex);
    const existing = st0.generatedVideos?.[key];
    if (!existing) {
      if (!silentError) {
        toast.warn('Extend', 'Chưa có video để nối — gen video trước.');
      }
      throw new Error('Chưa có video để extend');
    }
    if (st0.videoProvider !== 'flow') {
      if (!silentError) {
        toast.error('Extend', 'Extend chỉ hỗ trợ Google Flow.');
      }
      throw new Error('Extend chỉ Flow');
    }
    if (!st0.deductCredits(2)) {
      if (!silentError) toast.error('Hết tín dụng', 'Nạp thêm để extend video.');
      throw new Error('HẾT_TÍN_DỤNG');
    }

    beginMediaGenProgress(key, { type: 'estimate', kind: 'video' });
    try {
      beginMediaGenProgress(key, {
        type: 'flow',
        kind: 'video',
        chapterNum: st0.chuong_dang_chon,
        sceneIndex,
        promptIndex,
      });
      await ensureFlowSessionReady({ kind: 'video', notify: true });

      // Resolve mediaId: localStorage → server index
      let mediaId = '';
      try {
        mediaId = localStorage.getItem(`ainovel_flow_mid_${key}`) || '';
      } catch {
        mediaId = '';
      }
      if (!mediaId) {
        const res = await fetch(
          `${API.flowMediaId}?key=${encodeURIComponent(key)}`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => ({}));
        mediaId = String(data.mediaId || '');
      }
      if (!mediaId) {
        throw new Error(
          'Không tìm thấy mediaId Flow của clip. Gen lại video một lần (bản mới sẽ lưu id cho Extend).',
        );
      }

      const assetKey = sceneAssetKey(st0.chuong_dang_chon, sceneIndex);
      const item = (st0.generatedPrompts[assetKey] || [])[promptIndex];
      const continuePrompt = [
        (item?.video_prompt || item?.image_prompt || item?.prompt || '').trim(),
        'Continue seamlessly from the previous clip: same characters, lighting, and motion continuity. Extend the action forward without hard cut.',
      ]
        .filter(Boolean)
        .join(' ');

      const castPaths = resolveCastIngredientPaths({
        prompt: continuePrompt,
        sentence: item?.sentence || '',
        nhan_vat: st0.nhan_vat || [],
        nhan_vat_prompts: st0.nhan_vat_prompts || {},
        generatedImages: st0.generatedImages || {},
        max: 2,
      });

      const data = await generateVideoAction(
        {
          chapterNum: st0.chuong_dang_chon,
          sceneIndex,
          promptIndex,
          prompt: continuePrompt,
          duration: parsePromptDuration(item?.timestamp),
          model: st0.videoModel?.includes('extend')
            ? st0.videoModel
            : 'veo_3_1_extend_fast',
          videoProvider: 'flow',
          videoApiKey: resolveVideoApiKey(st0),
          videoAspectRatio: st0.videoAspectRatio,
          useGpuAcceleration: st0.useGpuAcceleration,
          characterHints: [
            ...(st0.nhan_vat || []),
            ...Object.keys(st0.nhan_vat_prompts || {}),
          ],
          environmentHint: st0.visualDnaPrompt || st0.mediaStylePreset,
          extendMediaId: mediaId,
          videoMode: 'extend',
          ingredientPaths: castPaths,
          camera: cameraFromScaleIndex(promptIndex % 6),
        },
        { skipFlowPreflight: true },
      );

      if (data.videoPath) {
        useNovelStore.getState().addGeneratedVideo(key, data.videoPath);
      }
      const mid = data.mediaId || data.mediaIds?.[0];
      if (mid) {
        try {
          localStorage.setItem(`ainovel_flow_mid_${key}`, mid);
          await fetch(API.flowMediaId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, mediaId: mid }),
          });
        } catch {
          /* ignore */
        }
      }
      completeMediaGenProgress(key, true);
      scheduleSilentChapterTimeline({
        chapterNum: st0.chuong_dang_chon,
        delayMs: 600,
      });
      if (!silentError) {
        toast.success(
          'Extend xong',
          `c${sceneIndex + 1}-${String(promptIndex + 1).padStart(2, '0')}`,
        );
      }
    } catch (err: unknown) {
      completeMediaGenProgress(
        key,
        false,
        err instanceof Error ? err.message : 'Lỗi',
      );
      if (!silentError) {
        toast.error('Lỗi extend', err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  };

  const handleGenerateAllVideos = async (sceneIndex: number) => {
    const st0 = useNovelStore.getState();
    const assetKey = sceneAssetKey(st0.chuong_dang_chon, sceneIndex);
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

    const isFlowV = st0.videoProvider === 'flow';
    const { FLOW_DEFAULTS: FLOW_V } = await import('@/lib/flow-bridge/config');
    const job = createBatchJob({
      title: `Gen video · Ch.${st0.chuong_dang_chon} · Cảnh ${sceneIndex + 1}`,
      kind: 'video',
      concurrency: isFlowV ? FLOW_V.clientFlowBatchConcurrency : 1,
      itemGapMs: isFlowV ? FLOW_V.clientFlowItemGapMs : 1200,
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
    scheduleSilentChapterTimeline({
      chapterNum: useNovelStore.getState().chuong_dang_chon,
      delayMs: 400,
    });
  };

  return {
    generatingPrompt,
    regeneratingSinglePrompt,
    handleGenerateImagePrompt,
    handleRegenPrompt,
    handleGenerateImage,
    handleGenerateAllImages,
    handleGenerateVideo,
    handleExtendVideo,
    handleGenerateAllVideos,
  };
}
