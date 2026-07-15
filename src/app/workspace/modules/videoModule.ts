import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';

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
  /** Passed through to /api/generate-video (Seedance runs server-side) */
  characterHints?: string[];
  environmentHint?: string;
  genre?: string;
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
  } = params;

  let videoQuality = 'hd';
  try {
    if (typeof localStorage !== 'undefined') {
      videoQuality = localStorage.getItem('ainovel_flow_video_quality') || 'hd';
    }
  } catch {
    /* ignore */
  }

  const response = await fetch(API.generateVideo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      genre,
      quality: videoQuality,
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Video generation failed.');
  }

  return data;
}

export async function generateVideoAction(params: GenerateVideoParams): Promise<{ videoPath: string; method?: string }> {
  const storeState = useNovelStore.getState();
  const routeProvider = params.videoProvider || storeState.videoProvider || 'flow';
  const routeModel =
    params.model ||
    storeState.videoModel ||
    (routeProvider === 'flow' ? 'veo_3_1_t2v_fast_ultra' : 'veo');
  const routeKey = params.videoApiKey || storeState.videoApiKey || '';

  // Seedance director runs inside /api/generate-video — client only routes params
  const baseParams: GenerateVideoParams = {
    ...params,
    videoProvider: routeProvider,
    model: routeModel,
    videoApiKey: routeKey,
  };

  // No provider swap fallback — only multi-key rotation inside API.
  return await postVideoGeneration(baseParams);
}

