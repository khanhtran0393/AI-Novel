import { API, postGenerate } from './apiClient';
/**
 * Module quản lý thiết kế mỹ thuật Phân cảnh & Vẽ tranh AI (Storyboarding & AI Whisk Art Generator)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { parseScenes } from '../utils/stringUtils';
import { useNovelStore, type PromptAsset } from '@/store/useNovelStore';

import type { NhanVatProfile } from '@/lib/characterProfile';
import { buildIdentityLockEnglish } from '@/lib/characterProfile';
import {
  resolveCastIngredientPaths,
  resolvePrimaryCastReference,
} from '@/lib/flow-bridge/castIngredients';
import { characterImageKey } from '@/contracts';
import { lorebookWithMemoryPack } from '@/lib/pipeline';

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
  /** Scene index for Seedance sequence (video_prompt continuity) */
  sceneIndex?: number;
  chapterNum?: number;
  /** Setup truyện — genre for director formula (no silent genre default) */
  chu_de?: string;
  phong_cach?: string;
  genre?: string;
}

export async function generateImagePromptAction(params: GenImagePromptParams): Promise<PromptAsset[]> {
  const { sceneText, duration, style, nhan_vat_prompts, wpm, secondsPerBeat } = params;
  void params.apiKey;
  void params.apiKeys;
  if (!sceneText?.trim()) {
    throw new Error('Thieu sceneText de sinh prompt anh.');
  }
  if (!style?.trim()) {
    throw new Error('Thieu style de sinh prompt anh (Visual DNA / Media Style).');
  }
  if (!Number.isFinite(wpm) || wpm <= 0) {
    throw new Error('Thieu WPM hop le. App khong tu gan WPM.');
  }
  if (!Number.isFinite(secondsPerBeat) || secondsPerBeat <= 0) {
    throw new Error('Thieu secondsPerBeat hop le. App khong tu gan secondsPerBeat.');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Thieu thoi luong scene hop le (TTS hoac WPM). App khong tu gan duration.');
  }

  const live = useNovelStore.getState();
  const chu_de = String(params.chu_de ?? live.setup?.chu_de ?? '').trim();
  const phong_cach = String(params.phong_cach ?? live.setup?.phong_cach ?? '').trim();
  const genre = String(
    params.genre || [chu_de, phong_cach].filter(Boolean).join(' / '),
  ).trim();
  if (!genre) {
    throw new Error(
      'Thieu Setup Chu de + Phong cach. Mo Setup chon truoc khi Gen Prompt. App khong tu gan the loai mac dinh.',
    );
  }

  const data = await postGenerate('GENERATE_IMAGE_PROMPT', {
    sceneText,
    style,
    voiceDuration: duration,
    characterReferences: nhan_vat_prompts,
    wpm,
    secondsPerBeat,
    chu_de,
    phong_cach,
    genre,
    scriptMode: live.scriptMode,
    // Seedance sequence auto — bakes continuity into every video_prompt
    chapterNum:
      typeof params.chapterNum === 'number'
        ? params.chapterNum
        : live.chuong_dang_chon,
    sceneIndex:
      typeof params.sceneIndex === 'number' ? params.sceneIndex : 0,
    ten_tac_pham: live.ten_tac_pham,
    title: live.ten_tac_pham,
    lorebook: lorebookWithMemoryPack(live.lorebook || ''),
  });

  let prompts: PromptAsset[] = [];
  if (data.prompts && Array.isArray(data.prompts)) {
    const mapped: PromptAsset[] = [];
    for (let i = 0; i < (data.prompts as PromptAsset[]).length; i++) {
      const p = (data.prompts as PromptAsset[])[i];
      const image = String(p.image_prompt || p.prompt || '').trim();
      const video = String(p.video_prompt || '').trim();
      if (!image || !video) {
        throw new Error(
          `Shot #${i + 1} thieu image_prompt hoac video_prompt tu API. Khong tu bi a prompt. Kiem tra model master.`,
        );
      }
      mapped.push({
        timestamp: p.timestamp || '',
        sentence: p.sentence || p.script_prompt || '',
        script_prompt: p.script_prompt || p.sentence || '',
        emotion: p.emotion || '',
        prompt: image,
        image_prompt: image,
        video_prompt: video,
      });
    }
    prompts = mapped;
  } else if (data.imagePrompt) {
    const image = String(data.imagePrompt).trim();
    const video = String(data.videoPrompt || '').trim();
    if (!image || !video) {
      throw new Error(
        'API tra imagePrompt/videoPrompt khong du. Khong tu bi a prompt.',
      );
    }
    prompts = [
      {
        timestamp: '0-0s',
        sentence: sceneText,
        script_prompt: sceneText,
        prompt: image,
        image_prompt: image,
        video_prompt: video,
      },
    ];
  }

  if (prompts.length === 0) {
    throw new Error(
      'Sinh prompt thất bại: API không trả image_prompt hợp lệ. Kiểm tra API key / model master và thử lại.',
    );
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
  chu_de?: string;
  phong_cach?: string;
  genre?: string;
}

export async function regenPromptAction(params: RegenPromptParams): Promise<string> {
  const { sentence, currentPrompt, style, nhan_vat_prompts } = params;
  void params.apiKey;
  void params.apiKeys;
  void params.sceneIndex;
  void params.promptIndex;
  if (!sentence?.trim()) {
    throw new Error('Thieu sentence de viet lai prompt.');
  }
  if (!currentPrompt?.trim()) {
    throw new Error('Thieu currentPrompt de viet lai prompt.');
  }
  if (!style?.trim()) {
    throw new Error('Thieu style de viet lai prompt (Visual DNA / Media Style).');
  }

  const live = useNovelStore.getState();
  const chu_de = String(params.chu_de ?? live.setup?.chu_de ?? '').trim();
  const phong_cach = String(params.phong_cach ?? live.setup?.phong_cach ?? '').trim();
  const genre = String(
    params.genre || [chu_de, phong_cach].filter(Boolean).join(' / '),
  ).trim();
  if (!genre) {
    throw new Error(
      'Thieu Setup Chu de + Phong cach khi viet lai prompt. App khong tu gan the loai mac dinh.',
    );
  }

  const data = await postGenerate('REGENERATE_PROMPT', {
    sentence,
    currentPrompt,
    style,
    characterReferences: nhan_vat_prompts,
    chu_de,
    phong_cach,
    genre,
  });
  const out = String(data.prompt || '').trim();
  if (!out) {
    throw new Error('API viet lai prompt tra rong. Khong dung fill cuc bo.');
  }
  return out;
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
  // B — auto cast concept / face_ref from store images
  const storeForCast = useNovelStore.getState();
  if (!referenceImagePath) {
    const autoRef = resolvePrimaryCastReference({
      prompt,
      sentence,
      nhan_vat: nhan_vat || [],
      nhan_vat_prompts: nhan_vat_prompts as Record<string, NhanVatProfile>,
      generatedImages: storeForCast.generatedImages || {},
    });
    if (autoRef) referenceImagePath = resolveLocalImagePath(autoRef);
  }
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
          const conceptPath = resolveLocalImagePath(
            storeForCast.generatedImages?.[characterImageKey(char)],
          );
          if (!referenceImagePath && faceRefPath) {
            referenceImagePath = faceRefPath;
          }
          if (!referenceImagePath && conceptPath) {
            referenceImagePath = conceptPath;
          }
          const faceHint =
            (charRef as { identity_lock?: string }).identity_lock ||
            faceRefPath ||
            conceptPath ||
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
  // Extra cast paths for multi-ingredient (Flow) — sent as ingredientPaths
  const castIngredientPaths = resolveCastIngredientPaths({
    prompt,
    sentence,
    nhan_vat: nhan_vat || [],
    nhan_vat_prompts: nhan_vat_prompts as Record<string, NhanVatProfile>,
    generatedImages: storeForCast.generatedImages || {},
    max: 3,
  }).map(resolveLocalImagePath).filter(Boolean);
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

    let imageQuality = '';
    try {
      if (typeof localStorage !== 'undefined') {
        imageQuality =
          localStorage.getItem('ainovel_flow_image_quality') || '';
      }
    } catch {
      imageQuality = '';
    }

    const { buildClientApiHeaders } = await import('./apiClient');
    // Off-GUI: network wait runs in Electron utilityProcess / Web Worker — not BrowserWindow
    const { offThreadFetchResponse } = await import(
      '@/lib/appWork/offThreadFetchCompat'
    );
    const res = await offThreadFetchResponse(API.generateImage, {
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
        ingredientPaths:
          castIngredientPaths.length > 0 ? castIngredientPaths : undefined,
        apiKey: routeKey,
        apiKeys: apiKeysToSend,
        model: activeModel,
        imageProvider: activeProvider,
        imageApiKey: routeKey,
        imageAspectRatio,
        imageCount,
        quality: imageQuality || undefined,
        imageQuality: imageQuality || undefined,
        aiMasterApiKey: params.aiMasterApiKey
      })
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const correlationId =
      res.headers.get('x-correlation-id') ||
      (typeof data.correlationId === 'string' ? data.correlationId : '') ||
      '';
    if (!res.ok) {
      const rawErr =
        (typeof data.error === 'string' && data.error.trim()) ||
        (typeof data.message === 'string' && data.message.trim()) ||
        '';
      const msg =
        rawErr ||
        (res.status === 503
          ? 'Image provider chưa sẵn sàng (503) — kiểm tra Flow extension / đăng nhập.'
          : res.status === 401 || res.status === 403
            ? `Image provider từ chối quyền (HTTP ${res.status}).`
            : `Sinh ảnh thất bại (HTTP ${res.status}).`);
      const e = new Error(
        correlationId ? `${msg} [cid=${correlationId}]` : msg,
      ) as Error & { correlationId?: string };
      e.correlationId = correlationId || undefined;
      throw e;
    }

    return {
      ...(data as {
        imagePath: string;
        imagePaths?: string[];
        projectUrl?: string;
        usedApiKey?: string;
        method?: string;
      }),
      correlationId:
        correlationId ||
        (typeof data.correlationId === 'string' ? data.correlationId : undefined),
    };
  };

  // Provider/model are explicit; multi-key/cookie rotation stays inside postImage / API.
  return await postImage(routeProvider, routeModel, selectedCookie || '', imageApiKey || '');
}
