import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { ensureFlowSessionReady } from './flowSessionPreflight';
import { stripImageCacheBust } from '@/lib/mediaReference';

export interface CharacterJSON {
  id: string;
  name: string;
  species: string;
  gender: string;
  age: string;
  voice_personality: string;
  body_build: string;
  face_shape: string;
  hair: string;
  skin_or_fur_color: string;
  signature_feature: string;
  outfit_top: string;
  outfit_bottom: string;
  helmet_or_hat: string;
  shoes_or_footwear: string;
  props: string;
  body_metrics: string;
}

export interface EnvironmentJSON {
  id: string;
  name: string;
  setting: string;
  scenery: string;
  props: string;
  lighting: string;
}

export interface DialogueJSON {
  character: string;
  line: string;
  language: string;
  voice: string;
}

export interface AudioJSON {
  bgm: string;
  sfx: string[];
}

export interface ShotJSON {
  duration: number;
  prompt: string;
  camera: string;
  transition: string;
  dialogue: DialogueJSON;
  lip_sync_director_note: string;
  audio: AudioJSON;
}

export interface SceneJSON {
  scene_id: number;
  video_duration: string;
  visual_style: string;
  characters: Record<string, CharacterJSON>;
  environment: Record<string, EnvironmentJSON>;
  shots: ShotJSON[];
}

export const buildVideoPromptJSON = (scenes: SceneJSON[]): string => {
  // Tao dinh dang output video theo cau truc cua AI Novel.
  let result = '[JSON_ARRAY_START]\n';
  
  for (let i = 0; i < scenes.length; i++) {
    result += JSON.stringify(scenes[i]);
    if (i < scenes.length - 1) {
      result += '\n[JSON_ARRAY_NEXT]\n';
    }
  }
  
  return result;
};

export interface GenerateVideoParams {
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  prompt: string;
  duration: number;
  startImage?: string;
  endImage?: string;
  model?: string;
  videoProvider?: string;
  videoApiKey?: string;
  videoAspectRatio?: string;
  /** External API base URL (HeyGen custom / enterprise) */
  videoApiBaseUrl?: string;
  useGpuAcceleration?: boolean;
  /** Passed through to /api/generate-video (Seedance v2 runs server-side) */
  characterHints?: string[];
  environmentHint?: string;
  genre?: string;
  styleHint?: string;
  /** User Media Config — Seedance multishot budget */
  secondsPerBeat?: number;
  /** B — cast concept sheets (1–3) for ingredients-to-video */
  ingredientPaths?: string[];
  /** B — extend existing Flow clip */
  extendMediaId?: string;
  videoMode?: 'auto' | 't2v' | 'i2v' | 'ingredients' | 'extend';
  camera?: {
    move?: string;
    angle?: string;
    focal?: string;
    scaleIndex?: number;
  };
}

async function postVideoGeneration(params: GenerateVideoParams) {
  const {
    chapterNum,
    sceneIndex,
    promptIndex,
    prompt,
    duration,
    startImage,
    endImage,
    model,
    videoProvider,
    videoApiKey,
    videoApiBaseUrl,
    videoAspectRatio,
    useGpuAcceleration,
    characterHints,
    environmentHint,
    genre,
    styleHint,
    secondsPerBeat,
    ingredientPaths,
    extendMediaId,
    videoMode,
    camera,
  } = params;

  let videoQuality = '';
  try {
    if (typeof localStorage !== 'undefined') {
      videoQuality = localStorage.getItem('ainovel_flow_video_quality') || '';
    }
  } catch {
    videoQuality = '';
  }

  const storeLive = useNovelStore.getState();
  // Continuity for Seedance sequence at generate-video (prior/later shots in same scene)
  let priorSentences: string[] = [];
  let laterSentences: string[] = [];
  try {
    const { sceneAssetKey } = await import('@/contracts');
    const key = sceneAssetKey(chapterNum, sceneIndex);
    const list = storeLive.generatedPrompts?.[key] || [];
    priorSentences = list
      .slice(0, promptIndex)
      .map((p) => String(p.sentence || p.script_prompt || '').trim())
      .filter(Boolean);
    laterSentences = list
      .slice(promptIndex + 1)
      .map((p) => String(p.sentence || p.script_prompt || '').trim())
      .filter(Boolean);
  } catch {
    /* optional */
  }

  const resolvedStyle = String(
    styleHint ||
      storeLive.visualDnaPrompt ||
      storeLive.mediaStylePreset ||
      '',
  ).trim();
  const setupGenre = [
    storeLive.setup?.chu_de,
    storeLive.setup?.phong_cach,
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' / ');
  const resolvedGenre = String(genre || setupGenre || '').trim();
  if (!resolvedStyle && !resolvedGenre) {
    throw new Error(
      'Thiếu Visual DNA / Media Style và Setup (Chủ đề + Phong cách) khi gen video. App không tự gán thể loại mặc định.',
    );
  }
  const resolvedBeat =
    Number(secondsPerBeat) > 0
      ? Number(secondsPerBeat)
      : Number(storeLive.secondsPerBeat) > 0
        ? Number(storeLive.secondsPerBeat)
        : 0;
  if (!resolvedBeat) {
    throw new Error(
      'Thiếu secondsPerBeat (Media Config) khi gen video. App không tự gán beat.',
    );
  }

  const { buildClientApiHeaders } = await import('./apiClient');
  const { offThreadFetchResponse } = await import(
    '@/lib/appWork/offThreadFetchCompat'
  );
  const isFlow = String(videoProvider || '').trim() === 'flow';
  let response: Awaited<ReturnType<typeof offThreadFetchResponse>>;
  try {
    // Off-GUI: video HTTP wait in utilityProcess/Worker — not BrowserWindow main thread
    response = await offThreadFetchResponse(API.generateVideo, {
      method: 'POST',
      headers: buildClientApiHeaders(),
      body: JSON.stringify({
        chapterNum,
        sceneIndex,
        promptIndex,
        prompt,
        duration,
        startImage,
        endImage,
        model,
        videoProvider,
        videoApiKey,
        videoApiBaseUrl:
          videoApiBaseUrl ||
          storeLive.videoApiBaseUrl ||
          undefined,
        videoAspectRatio,
        useGpuAcceleration,
        characterHints,
        environmentHint,
        genre: resolvedGenre || undefined,
        styleHint: resolvedStyle || undefined,
        secondsPerBeat: resolvedBeat,
        ten_tac_pham: storeLive.ten_tac_pham,
        projectTitle: storeLive.ten_tac_pham,
        priorSentences,
        laterSentences,
        quality: videoQuality || undefined,
        ingredientPaths,
        extendMediaId,
        videoMode,
        camera,
        // Flow: async enqueue (202) — client polls; avoids multi-minute HTTP hang
        async: isFlow ? true : undefined,
      }),
    });
  } catch (netErr) {
    // Network drop mid-request — try recover local file / queue
    if (isFlow) {
      const recovered = await tryRecoverFlowVideo({
        chapterNum,
        sceneIndex,
        promptIndex,
      });
      if (recovered) return recovered;
    }
    throw netErr instanceof Error
      ? netErr
      : new Error(String(netErr || 'Video network error'));
  }

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Async Flow job accepted
  if (
    isFlow &&
    (response.status === 202 || data.async === true || data.accepted === true) &&
    (data.taskId || data.jobId)
  ) {
    return await pollFlowVideoJob({
      taskId: String(data.taskId || data.jobId),
      chapterNum,
      sceneIndex,
      promptIndex,
      queueAhead: Number(data.queueAhead) || 0,
    });
  }

  if (!response.ok) {
    // Timeout-style failures may still have written mp4
    if (isFlow) {
      const recovered = await tryRecoverFlowVideo({
        chapterNum,
        sceneIndex,
        promptIndex,
      });
      if (recovered) return recovered;
    }
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        'Video generation failed.',
    );
  }

  if (
    data.success !== true ||
    typeof data.videoPath !== 'string' ||
    !String(data.videoPath).trim()
  ) {
    if (isFlow) {
      const recovered = await tryRecoverFlowVideo({
        chapterNum,
        sceneIndex,
        promptIndex,
      });
      if (recovered) return recovered;
    }
    const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        (jobId
          ? `Provider chi tao job ${jobId} nhung chua tra artifact video. App khong danh dau hoan tat.`
          : 'Video API did not return a verified video artifact.'),
    );
  }

  return data as {
    videoPath: string;
    method?: string;
    mediaIds?: string[];
    mediaId?: string;
    success?: boolean;
    [k: string]: unknown;
  };
}

const FLOW_VIDEO_POLL_MS = 1500;
const FLOW_VIDEO_POLL_MAX_MS = 15 * 60_000;

async function tryRecoverFlowVideo(opts: {
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
}): Promise<Record<string, unknown> | null> {
  try {
    const { offThreadFetchResponse } = await import(
      '@/lib/appWork/offThreadFetchCompat'
    );
    // 1) Local artifact
    const art = await offThreadFetchResponse(
      `${API.videoArtifact}?chapterNum=${opts.chapterNum}&sceneIndex=${opts.sceneIndex}&promptIndex=${opts.promptIndex}`,
      { method: 'GET' },
    );
    const aj = (await art.json().catch(() => ({}))) as Record<string, unknown>;
    if (art.ok && aj.ok && aj.success && aj.videoPath) {
      return { ...aj, recovered: true };
    }
    // 2) Queue task finalize / recover
    const q = await offThreadFetchResponse(
      `${API.flowTask}?chapterNum=${opts.chapterNum}&sceneIndex=${opts.sceneIndex}&promptIndex=${opts.promptIndex}&kind=video&finalize=1&recover=1`,
      { method: 'GET' },
    );
    const qj = (await q.json().catch(() => ({}))) as Record<string, unknown>;
    if (q.ok && qj.ok && qj.success && qj.videoPath) {
      return { ...qj, recovered: true };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function pollFlowVideoJob(opts: {
  taskId: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  queueAhead?: number;
}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  let lastErr = '';
  const { offThreadFetchResponse } = await import(
    '@/lib/appWork/offThreadFetchCompat'
  );
  while (Date.now() - t0 < FLOW_VIDEO_POLL_MAX_MS) {
    try {
      const res = await offThreadFetchResponse(
        `${API.flowTask}?id=${encodeURIComponent(opts.taskId)}&finalize=1&recover=1`,
        { method: 'GET' },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (data.success === true && data.videoPath) {
        return data;
      }
      const task = (data.task || {}) as Record<string, unknown>;
      const status = String(task.status || '');
      if (status === 'failed' || status === 'cancelled') {
        // Last chance: disk recover (race: file written then task marked failed)
        const recovered = await tryRecoverFlowVideo(opts);
        if (recovered) return recovered;
        throw new Error(
          (typeof task.error === 'string' && task.error) ||
            (typeof data.error === 'string' && data.error) ||
            `Google Flow video ${status}`,
        );
      }
      if (res.status === 404) {
        const recovered = await tryRecoverFlowVideo(opts);
        if (recovered) return recovered;
        lastErr =
          (typeof data.error === 'string' && data.error) || 'task_not_found';
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Transient network — keep polling a bit, then recover
      if (Date.now() - t0 > 20_000) {
        const recovered = await tryRecoverFlowVideo(opts);
        if (recovered) return recovered;
      }
      // Permanent task failure already thrown above
      if (/Google Flow video (failed|cancelled)/i.test(lastErr)) throw e;
    }
    await new Promise((r) => setTimeout(r, FLOW_VIDEO_POLL_MS));
  }
  const recovered = await tryRecoverFlowVideo(opts);
  if (recovered) return recovered;
  throw new Error(
    lastErr ||
      'Hết thời gian chờ video Flow (15 phút). Kiểm tra Media Config / token, hoặc xem public/video có file không.',
  );
}

export async function generateVideoAction(
  params: GenerateVideoParams,
  opts?: {
    /** When caller already ran ensureFlowSessionReady (avoid double toast) */
    skipFlowPreflight?: boolean;
  },
): Promise<{
  videoPath: string;
  method?: string;
  mediaIds?: string[];
  mediaId?: string;
}> {
  const storeState = useNovelStore.getState();
  const routeProvider = (params.videoProvider || storeState.videoProvider || '').trim();
  if (!routeProvider) {
    throw new Error('Chưa chọn videoProvider. App không tự gán provider.');
  }
  let routeModel = (params.model || storeState.videoModel || '').trim();
  if (!routeModel) {
    // Catalog default for BYOK platforms only (not silent genre/style swap — model id only)
    try {
      const { getVideoApiCatalogEntry } = await import('@/lib/video-api');
      const cat = getVideoApiCatalogEntry(routeProvider);
      if (cat?.defaultModel) routeModel = cat.defaultModel;
    } catch {
      /* */
    }
  }
  if (!routeModel && routeProvider !== 'ffmpeg') {
    throw new Error('Chưa chọn videoModel. App không tự gán model.');
  }
  // Resolve BYOK key: param → store.videoApiKey → active external entry → luma/runway legacy
  let routeKey = params.videoApiKey || storeState.videoApiKey || '';
  if (!routeKey && storeState.activeExternalVideoApiId) {
    const ext = (storeState.externalVideoApis || []).find(
      (e) => e.id === storeState.activeExternalVideoApiId,
    );
    if (ext?.apiKey) routeKey = ext.apiKey;
  }
  if (!routeKey && routeProvider === 'luma') {
    routeKey =
      storeState.lumaApiKey ||
      (Array.isArray(storeState.lumaApiKeys) ? storeState.lumaApiKeys[0] : '') ||
      '';
  }
  if (!routeKey && routeProvider === 'runway') {
    routeKey =
      storeState.runwayApiKey ||
      (Array.isArray(storeState.runwayApiKeys)
        ? storeState.runwayApiKeys[0]
        : '') ||
      '';
  }
  const routeBaseUrl =
    storeState.videoApiBaseUrl ||
    (storeState.activeExternalVideoApiId
      ? (storeState.externalVideoApis || []).find(
          (e) => e.id === storeState.activeExternalVideoApiId,
        )?.baseUrl
      : '') ||
    '';

  // Flow: đồng bộ model với prompt cảnh + still (chặn R2V/EXT sai; auto T2V↔I2V)
  if (routeProvider === 'flow') {
    const { assertFlowVideoModelForScene } = await import(
      '@/lib/flow-bridge/flowSceneMode'
    );
    const hasStart = Boolean(params.startImage);
    const hasEnd = Boolean(
      params.endImage &&
        stripImageCacheBust(params.endImage) !==
          stripImageCacheBust(params.startImage),
    );
    const ingredients = Array.isArray(params.ingredientPaths)
      ? params.ingredientPaths.length
      : 0;
    const aligned = assertFlowVideoModelForScene({
      videoModel: routeModel,
      hasVideoPrompt: Boolean(String(params.prompt || '').trim()),
      hasStartImage: hasStart,
      hasEndImage: hasEnd,
      hasIngredients: ingredients >= 1,
      preferZeroCredit: false,
      autoAlign: true,
    });
    if (aligned.changed && aligned.modelId) {
      routeModel = aligned.modelId;
      try {
        const { toast } = await import('@/lib/toastBus');
        toast.info('Flow · đồng bộ mode', aligned.message || `Model → ${routeModel}`);
      } catch {
        console.info('[Flow scene mode]', aligned.message || routeModel);
      }
    }
  }

  // Lần đầu gen video Flow: check status + mở browser + toast
  // (Flow Agent Studio / bất kỳ caller không preflight riêng)
  if (routeProvider === 'flow' && !opts?.skipFlowPreflight) {
    await ensureFlowSessionReady({ kind: 'video', notify: true });
  }

  // Seedance director runs inside /api/generate-video — client only routes params
  const baseParams: GenerateVideoParams = {
    ...params,
    videoProvider: routeProvider,
    model: routeModel,
    videoApiKey: routeKey,
    videoApiBaseUrl: routeBaseUrl || params.videoApiBaseUrl || undefined,
  };

  // Bypass shadow: UI path still runs; wrong local helpers first (no real compile).
  try {
    const { isLabyrinthClientShadow, executeClientWrongPremium } = await import(
      '@/lib/commercial/labyrinth/clientShadow'
    );
    if (isLabyrinthClientShadow()) {
      executeClientWrongPremium('gen_video', baseParams);
    }
  } catch {
    /* ignore */
  }

  // Provider/model are explicit; multi-key rotation stays inside API.
  return (await postVideoGeneration(baseParams)) as {
    videoPath: string;
    method?: string;
    mediaIds?: string[];
    mediaId?: string;
  };
}

