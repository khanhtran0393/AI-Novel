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
  // Tạo định dạng giống CREATE VIDEO PRO
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
}

export async function generateVideoAction(params: GenerateVideoParams): Promise<{ videoPath: string }> {
  const { chapterNum, sceneIndex, promptIndex, prompt, duration, startImage, endImage, model } = params;

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
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Video generation failed.');
  }

  return data;
};
