/**
 * Module quản lý thiết kế mỹ thuật Phân cảnh & Vẽ tranh AI (Storyboarding & AI Whisk Art Generator)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { parseScenes } from '../utils/stringUtils';
import { useNovelStore, type PromptAsset } from '@/store/useNovelStore';
import {
  applyMediaSelfHealPatch,
  collectImageRepairRoutes,
  diagnoseMediaSelfHeal,
  formatRepairSummary,
  resolveMediaSelfHealLog,
  type ImageRepairRoute,
} from '../utils/mediaSelfRepair';

import type { NhanVatProfile } from '@/lib/characterProfile';
import { buildIdentityLockEnglish } from '@/lib/characterProfile';

export type NhanVatPrompts = Record<string, NhanVatProfile | Partial<NhanVatProfile>>;

interface GenImagePromptParams {
  apiKey: string;
  apiKeys: string[];
  sceneText: string;
  duration: number;
  style: string;
  nhan_vat_prompts: NhanVatPrompts;
  wpm: number;
  secondsPerBeat: number;
}

export async function generateImagePromptAction(params: GenImagePromptParams): Promise<PromptAsset[]> {
  const { sceneText, duration, style, nhan_vat_prompts, wpm, secondsPerBeat } = params;

  let prompts: PromptAsset[] = [];



  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse = storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0 ? storeState.openaiApiKeys : (storeState.openaiApiKey ? [storeState.openaiApiKey] : []);
  } else if (model === 'llama') {
    keysToUse = storeState.grokApiKeys && storeState.grokApiKeys.length > 0 ? storeState.grokApiKeys : (storeState.grokApiKey ? [storeState.grokApiKey] : []);
  } else {
    keysToUse = storeState.apiKeys && storeState.apiKeys.length > 0 ? storeState.apiKeys : (storeState.apiKey ? [storeState.apiKey] : []);
  }

  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_IMAGE_PROMPT',
      apiKeys: keysToUse,
      model,
      payload: {
        sceneText,
        style,
        voiceDuration: duration,
        characterReferences: nhan_vat_prompts
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi sinh Image Prompt.');
  }

  const data = await res.json();
  
  if (data.prompts && Array.isArray(data.prompts)) {
    prompts = data.prompts.map((p: PromptAsset) => ({
      timestamp: p.timestamp || '0s',
      sentence: p.sentence || p.script_prompt || '',
      script_prompt: p.script_prompt || p.sentence || '',
      emotion: p.emotion || '',
      prompt: p.image_prompt || p.prompt || '',
      image_prompt: p.image_prompt || p.prompt || '',
      video_prompt: p.video_prompt || ''
    }));
  } else if (data.imagePrompt) {
    prompts = [{ timestamp: '0s', sentence: sceneText, script_prompt: sceneText, prompt: data.imagePrompt, image_prompt: data.imagePrompt, video_prompt: data.videoPrompt || '' }];
  }

  // Nếu API trả về usedApiKey, có thể phản hồi lại để UI ghi nhận độ ưu tiên
  if (data.usedApiKey) {
    (prompts as unknown as { usedApiKey?: string }).usedApiKey = data.usedApiKey;
  }

  return prompts;
}

interface RegenPromptParams {
  apiKey: string;
  apiKeys: string[];
  sceneIndex: number;
  promptIndex: number;
  sentence: string;
  currentPrompt: string;
  style: string;
  nhan_vat_prompts: NhanVatPrompts;
}

export async function regenPromptAction(params: RegenPromptParams): Promise<string> {
  const { sentence, currentPrompt, style, nhan_vat_prompts } = params;



  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse = storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0 ? storeState.openaiApiKeys : (storeState.openaiApiKey ? [storeState.openaiApiKey] : []);
  } else if (model === 'llama') {
    keysToUse = storeState.grokApiKeys && storeState.grokApiKeys.length > 0 ? storeState.grokApiKeys : (storeState.grokApiKey ? [storeState.grokApiKey] : []);
  } else {
    keysToUse = storeState.apiKeys && storeState.apiKeys.length > 0 ? storeState.apiKeys : (storeState.apiKey ? [storeState.apiKey] : []);
  }

  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'REGENERATE_PROMPT',
      apiKeys: keysToUse,
      model,
      payload: {
        sentence: sentence || 'Mô tả bối cảnh hoặc hành động của nhân vật',
        currentPrompt,
        style,
        characterReferences: nhan_vat_prompts
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi viết lại prompt.');
  }

  const data = await res.json();
  return data.prompt || '';
}

interface GenerateImageParams {
  prompt: string;
  sentence: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  savePathImage: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  selectedCookie: string;
  nhan_vat: string[];
  nhan_vat_prompts: NhanVatPrompts;
  apiKey?: string;
  apiKeys?: string[];
  model?: string;
  imageProvider?: string;
  imageApiKey?: string;
  imageAspectRatio?: string;
  imageCount?: number;
  aiMasterApiKey?: string;
}

export async function generateImageAction(params: GenerateImageParams): Promise<{
  imagePath: string;
  imagePaths?: string[];
  projectUrl?: string;
  usedApiKey?: string;
  method?: string;
}> {
  const {
    prompt,
    sentence,
    chapterNum,
    sceneIndex,
    promptIndex,
    savePathImage,
    googleDrivePath,
    ten_tac_pham,
    selectedCookie,
    nhan_vat,
    nhan_vat_prompts,
    apiKey,
    imageProvider,
    imageApiKey,
    model,
    imageAspectRatio,
    imageCount
  } = params;

  let characterPrompt = '';
  if (nhan_vat && nhan_vat_prompts) {
    for (const char of nhan_vat) {
      const mentioned = prompt.toLowerCase().includes(char.toLowerCase())
        || Boolean(sentence && sentence.toLowerCase().includes(char.toLowerCase()));
      if (mentioned) {
        const charRef = nhan_vat_prompts[char];
        if (charRef) {
          characterPrompt = buildIdentityLockEnglish(charRef) || charRef.prompt || '';
          break;
        }
      }
    }
  }
  const drivePath = savePathImage || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Studio Canh` : '');
  const storeState = useNovelStore.getState();
  const routeProvider = imageProvider || storeState.imageProvider;
  const routeModel = model || storeState.imageModel;

  if (!routeProvider || !routeModel) {
    throw new Error('Thieu cau hinh provider/model sinh anh.');
  }

  const postImage = async (
    activeProvider: string,
    activeModel: string,
    activeCookie: string,
    activeImageApiKey = '',
  ) => {
    const latestStore = useNovelStore.getState();
    const providerApiKeys = activeProvider === 'openai'
      ? (latestStore.openaiApiKeys?.length ? latestStore.openaiApiKeys : (latestStore.openaiApiKey ? [latestStore.openaiApiKey] : []))
      : activeProvider === 'grok'
        ? (latestStore.grokApiKeys?.length ? latestStore.grokApiKeys : (latestStore.grokApiKey ? [latestStore.grokApiKey] : []))
        : (latestStore.apiKeys?.length ? latestStore.apiKeys : (latestStore.apiKey ? [latestStore.apiKey] : []));
    const routeKey = activeImageApiKey || providerApiKeys[0] || apiKey || '';
    const apiKeysToSend = providerApiKeys.length ? providerApiKeys : (routeKey ? [routeKey] : []);

    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        chapterNum,
        sceneIndex,
        promptIndex,
        drivePath,
        ten_tac_pham,
        cookie: activeCookie || '',
        characterPrompt,
        apiKey: routeKey,
        apiKeys: apiKeysToSend,
        model: activeModel,
        imageProvider: activeProvider,
        imageApiKey: routeKey,
        imageAspectRatio,
        imageCount,
        aiMasterApiKey: params.aiMasterApiKey
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Image generation failed.');
    }

    return data;
  };

  try {
    return await postImage(routeProvider, routeModel, selectedCookie || '', imageApiKey || '');
  } catch (firstError) {
    const latestStore = useNovelStore.getState();
    const diagnosis = await diagnoseMediaSelfHeal(latestStore, 'image', firstError, {
      operation: 'generate_image',
      routeProvider,
      routeModel,
      sceneIndex,
      promptIndex,
    });

    const routes = collectImageRepairRoutes(
      useNovelStore.getState(),
      diagnosis,
      promptIndex,
      routeProvider,
      routeModel,
    );

    console.info(
      `[Self-Heal Brain] Image orchestration: kind=${diagnosis.issue.kind}, routes=${routes.length}, log=${diagnosis.logId}`,
    );

    if (routes.length === 0) {
      throw firstError instanceof Error
        ? firstError
        : new Error(String(firstError));
    }

    // Persist brain patch, then cascade every viable provider/model route.
    applyMediaSelfHealPatch(useNovelStore.getState(), diagnosis.patch);

    const attempted: ImageRepairRoute[] = [];
    let lastError: unknown = firstError;

    for (const route of routes) {
      attempted.push(route);
      applyMediaSelfHealPatch(useNovelStore.getState(), {
        imageProvider: route.provider,
        imageModel: route.model,
      });

      console.info(
        `[Self-Heal Brain] Trying image route ${attempted.length}/${routes.length}: ${route.provider}/${route.model} (${route.reason})`,
      );

      try {
        const repaired = await postImage(
          route.provider,
          route.model,
          route.selectedCookie,
          route.imageApiKey,
        );
        await resolveMediaSelfHealLog(diagnosis.logId);
        const summary = formatRepairSummary(attempted, route);
        console.info(`[Self-Heal Brain] Image healed: ${summary}`);
        return {
          ...repaired,
          method: repaired.method ? `${repaired.method} | ${summary}` : summary,
        };
      } catch (retryError) {
        lastError = retryError;
        console.warn(
          `[Self-Heal Brain] Image route failed ${route.provider}/${route.model}:`,
          retryError instanceof Error ? retryError.message : retryError,
        );
      }
    }

    const lastMsg = lastError instanceof Error ? lastError.message : String(lastError);
    const firstMsg = firstError instanceof Error ? firstError.message : String(firstError);
    throw new Error(
      `Self-heal that bai sau ${attempted.length} tuyen anh. Goc: ${firstMsg}. Cuoi: ${lastMsg}. Log: ${diagnosis.logPath || diagnosis.logId}`,
    );
  }
}
