import { useNovelStore } from '@/store/useNovelStore';
import {
  applyMediaSelfHealPatch,
  collectVideoRepairRoutes,
  diagnoseMediaSelfHeal,
  resolveMediaSelfHealLog,
  type VideoRepairRoute,
} from '../utils/mediaSelfRepair';

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
}

async function postVideoGeneration(params: GenerateVideoParams) {
  const { chapterNum, sceneIndex, promptIndex, prompt, duration, startImage, endImage, model, videoProvider, videoApiKey, videoAspectRatio, useGpuAcceleration } = params;

  const response = await fetch('/api/generate-video', {
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
      useGpuAcceleration
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
  const routeProvider = params.videoProvider || storeState.videoProvider || 'veo';
  const routeModel = params.model || storeState.videoModel || 'veo';
  const routeKey = params.videoApiKey || storeState.videoApiKey || '';

  const baseParams: GenerateVideoParams = {
    ...params,
    videoProvider: routeProvider,
    model: routeModel,
    videoApiKey: routeKey,
  };

  try {
    return await postVideoGeneration(baseParams);
  } catch (firstError) {
    const latestStore = useNovelStore.getState();
    const diagnosis = await diagnoseMediaSelfHeal(latestStore, 'video', firstError, {
      operation: 'generate_video',
      routeProvider,
      routeModel,
      sceneIndex: params.sceneIndex,
      promptIndex: params.promptIndex,
    });

    const routes = collectVideoRepairRoutes(
      useNovelStore.getState(),
      diagnosis,
      routeProvider,
    );

    console.info(
      `[Self-Heal Brain] Video orchestration: kind=${diagnosis.issue.kind}, routes=${routes.length}, log=${diagnosis.logId}`,
    );

    if (routes.length === 0) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }

    applyMediaSelfHealPatch(useNovelStore.getState(), diagnosis.patch);

    const attempted: VideoRepairRoute[] = [];
    let lastError: unknown = firstError;

    for (const route of routes) {
      attempted.push(route);
      applyMediaSelfHealPatch(useNovelStore.getState(), {
        videoProvider: route.provider,
        videoModel: route.model,
      });

      console.info(
        `[Self-Heal Brain] Trying video route ${attempted.length}/${routes.length}: ${route.provider}/${route.model} (${route.reason})`,
      );

      try {
        const repaired = await postVideoGeneration({
          ...baseParams,
          videoProvider: route.provider,
          model: route.model,
          videoApiKey: route.videoApiKey || baseParams.videoApiKey,
        });
        await resolveMediaSelfHealLog(diagnosis.logId);
        const summary = `Self-heal video: ${attempted.map((r) => `${r.provider}/${r.model}`).join(' -> ')}. OK: ${route.provider}/${route.model}`;
        console.info(`[Self-Heal Brain] Video healed: ${summary}`);
        return {
          ...repaired,
          method: summary,
        };
      } catch (retryError) {
        lastError = retryError;
        console.warn(
          `[Self-Heal Brain] Video route failed ${route.provider}/${route.model}:`,
          retryError instanceof Error ? retryError.message : retryError,
        );
      }
    }

    const lastMsg = lastError instanceof Error ? lastError.message : String(lastError);
    const firstMsg = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(
      `Self-heal that bai sau ${attempted.length} tuyen video. Goc: ${firstMsg}. Cuoi: ${lastMsg}. Log: ${diagnosis.logPath || diagnosis.logId}`,
    );
  }
}

