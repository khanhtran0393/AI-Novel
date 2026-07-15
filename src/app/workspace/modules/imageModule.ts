import { API, postGenerate } from './apiClient';
/**
 * Module quản lý thiết kế mỹ thuật Phân cảnh & Vẽ tranh AI (Storyboarding & AI Whisk Art Generator)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { parseScenes } from '../utils/stringUtils';
import { useNovelStore, type PromptAsset } from '@/store/useNovelStore';

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
  void params.apiKey;
  void params.apiKeys;

  const data = await postGenerate('GENERATE_IMAGE_PROMPT', {
    sceneText,
    style,
    voiceDuration: duration,
    characterReferences: nhan_vat_prompts,
    wpm: wpm > 0 ? wpm : 140,
    secondsPerBeat: secondsPerBeat > 0 ? secondsPerBeat : 6,
  });

  let prompts: PromptAsset[] = [];
  if (data.prompts && Array.isArray(data.prompts)) {
    prompts = (data.prompts as PromptAsset[]).map((p) => ({
      timestamp: p.timestamp || '0s',
      sentence: p.sentence || p.script_prompt || '',
      script_prompt: p.script_prompt || p.sentence || '',
      emotion: p.emotion || '',
      prompt: p.image_prompt || p.prompt || '',
      image_prompt: p.image_prompt || p.prompt || '',
      video_prompt: p.video_prompt || '',
    }));
  } else if (data.imagePrompt) {
    prompts = [
      {
        timestamp: '0s',
        sentence: sceneText,
        script_prompt: sceneText,
        prompt: String(data.imagePrompt),
        image_prompt: String(data.imagePrompt),
        video_prompt: String(data.videoPrompt || ''),
      },
    ];
  }

  if (data.usedApiKey) {
    (prompts as unknown as { usedApiKey?: string }).usedApiKey = String(data.usedApiKey);
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
  void params.apiKey;
  void params.apiKeys;
  void params.sceneIndex;
  void params.promptIndex;

  const data = await postGenerate('REGENERATE_PROMPT', {
    sentence: sentence || 'Mô tả bối cảnh hoặc hành động của nhân vật',
    currentPrompt,
    style,
    characterReferences: nhan_vat_prompts,
  });
  return String(data.prompt || '');
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
  /** Absolute/local path of concept sheet for face identity lock */
  referenceImagePath?: string;
}

/** Normalize face_ref / generated image URL → local path when possible */
export function resolveLocalImagePath(raw?: string): string {
  let s = String(raw || '').trim().split('?')[0] || '';
  if (!s) return '';
  try {
    if (s.startsWith('file:')) {
      s = decodeURIComponent(s.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
    }
  } catch {
    /* ignore */
  }
  // /images/xxx.png served from public
  if (s.startsWith('/images/') || s.startsWith('images/')) {
    return s.replace(/^\//, '');
  }
  // full URL to local serve-image?path=
  try {
    if (s.includes('serve-image') && s.includes('path=')) {
      const u = new URL(s, 'http://local');
      return decodeURIComponent(u.searchParams.get('path') || '');
    }
  } catch {
    /* ignore */
  }
  return s;
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
  let referenceImagePath =
    resolveLocalImagePath(params.referenceImagePath) || '';
  if (nhan_vat && nhan_vat_prompts) {
    for (const char of nhan_vat) {
      const mentioned = prompt.toLowerCase().includes(char.toLowerCase())
        || Boolean(sentence && sentence.toLowerCase().includes(char.toLowerCase()));
      if (mentioned) {
        const charRef = nhan_vat_prompts[char];
        if (charRef) {
          // Identity lock: English sheet + optional face-lock phrase for providers
          const lock = buildIdentityLockEnglish(charRef) || charRef.prompt || '';
          const faceRefPath = resolveLocalImagePath(
            (charRef as { face_ref?: string }).face_ref,
          );
          if (!referenceImagePath && faceRefPath) {
            referenceImagePath = faceRefPath;
          }
          const faceHint =
            (charRef as { identity_lock?: string }).identity_lock ||
            faceRefPath ||
            '';
          characterPrompt = [
            lock,
            faceHint
              ? `STRICT IDENTITY LOCK: preserve exact face/identity from reference sheet (${String(faceHint).slice(0, 200)}); same age, scars, hairline; no face swap.`
              : 'STRICT IDENTITY LOCK: consistent character face, hair, scars across all shots; no redesign.',
          ]
            .filter(Boolean)
            .join(' ');
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

    let imageQuality = '1k';
    try {
      if (typeof localStorage !== 'undefined') {
        imageQuality =
          localStorage.getItem('ainovel_flow_image_quality') || '1k';
      }
    } catch {
      /* ignore */
    }

    const { buildClientApiHeaders } = await import('./apiClient');
    const res = await fetch(API.generateImage, {
      method: 'POST',
      headers: buildClientApiHeaders(),
      body: JSON.stringify({
        prompt,
        chapterNum,
        sceneIndex,
        promptIndex,
        drivePath,
        ten_tac_pham,
        cookie: activeCookie || '',
        characterPrompt,
        referenceImagePath: referenceImagePath || undefined,
        apiKey: routeKey,
        apiKeys: apiKeysToSend,
        model: activeModel,
        imageProvider: activeProvider,
        imageApiKey: routeKey,
        imageAspectRatio,
        imageCount,
        quality: imageQuality,
        imageQuality,
        aiMasterApiKey: params.aiMasterApiKey
      })
    });

    const data = await res.json().catch(() => ({}));
    const correlationId =
      res.headers.get('x-correlation-id') ||
      (typeof data?.correlationId === 'string' ? data.correlationId : '') ||
      '';
    if (!res.ok) {
      const msg = data.error || 'Image generation failed.';
      const e = new Error(
        correlationId ? `${msg} [cid=${correlationId}]` : msg,
      ) as Error & { correlationId?: string };
      e.correlationId = correlationId || undefined;
      throw e;
    }

    return { ...data, correlationId: correlationId || data.correlationId };
  };

  // No provider swap fallback — only multi-key/cookie rotation inside postImage / API.
  return await postImage(routeProvider, routeModel, selectedCookie || '', imageApiKey || '');
}
