import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { ensureFlowSessionReady } from './flowSessionPreflight';

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
      'Thieu Visual DNA / Media Style va Setup (Chu de + Phong cach) khi gen video. App khong tu gan mat the.',
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
      'Thieu secondsPerBeat (Media Config) khi gen video. App khong tu gan beat.',
    );
  }

  const { buildClientApiHeaders } = await import('./apiClient');
  const response = await fetch(API.generateVideo, {
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
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Video generation failed.');
  }

  if (
    data.success !== true ||
    typeof data.videoPath !== 'string' ||
    !data.videoPath.trim()
  ) {
    const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
    throw new Error(
      data.error ||
        (jobId
          ? `Provider chi tao job ${jobId} nhung chua tra artifact video. App khong danh dau hoan tat.`
          : 'Video API did not return a verified video artifact.'),
    );
  }

  return data;
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
    throw new Error('Chua chon videoProvider. App khong tu gan provider.');
  }
  const routeModel = (params.model || storeState.videoModel || '').trim();
  if (!routeModel) {
    throw new Error('Chua chon videoModel. App khong tu gan model.');
  }
  const routeKey = params.videoApiKey || storeState.videoApiKey || '';

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
  };

  // Provider/model are explicit; multi-key rotation stays inside API.
  return await postVideoGeneration(baseParams);
}

