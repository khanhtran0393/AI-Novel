/**
 * Module quản lý thiết kế mỹ thuật Phân cảnh & Vẽ tranh AI (Storyboarding & AI Whisk Art Generator)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { parseScenes } from '../utils/stringUtils';

export type NhanVatPrompts = Record<string, { gioi_tinh: string; quan_ao: string; so_thich: string; thoi_quen: string; prompt: string }>;

interface GenImagePromptParams {
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  sceneText: string;
  duration: number;
  style: string;
  nhan_vat_prompts: NhanVatPrompts;
}

export async function generateImagePromptAction(params: GenImagePromptParams): Promise<{ timestamp: string; prompt: string; sentence?: string }[]> {
  const { useMock, apiKey, apiKeys, sceneText, duration, style, nhan_vat_prompts } = params;

  let prompts: { timestamp: string; prompt: string; sentence?: string }[] = [];

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const sentences = sceneText.split(/[.!?。]\s*/).filter(s => s.trim().length > 10);
    const segDur = Math.max(3, Math.round(duration / Math.max(1, sentences.length)));
    prompts = sentences.slice(0, 8).map((s, i) => ({
      timestamp: `${i * segDur}s`,
      sentence: s,
      prompt: `Cinematic wide shot, Neo-Veridia city, neon light rays, ${i % 2 === 0 ? 'glowing Empathic Net nerve structures floating' : 'detective Khải Đăng holds a memory scanner decrypter'}, hyper realistic, Unreal Engine 5, 8k, cinematic lighting, depth of field`
    }));
    if (prompts.length === 0) {
      prompts = [{ timestamp: '0s', sentence: sceneText, prompt: 'Cinematic shot, detective Khải Đăng walking in a dark neon alleyway in Neo-Veridia, holding a blue-glowing memory reader device, detailed, cinematic atmosphere, 8k, realistic render.' }];
    }
    return prompts;
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key. Vui lòng nhập API Key ở góc trên bên phải.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_IMAGE_PROMPT',
      apiKeys: keysToUse,
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
    prompts = data.prompts.map((p: { timestamp?: string; sentence?: string; prompt?: string }) => ({
      timestamp: p.timestamp || '0s',
      sentence: p.sentence || '',
      prompt: p.prompt || ''
    }));
  } else if (data.imagePrompt) {
    prompts = [{ timestamp: '0s', sentence: sceneText, prompt: data.imagePrompt }];
  }

  // Nếu API trả về usedApiKey, có thể phản hồi lại để UI ghi nhận độ ưu tiên
  if (data.usedApiKey) {
    (prompts as unknown as { usedApiKey?: string }).usedApiKey = data.usedApiKey;
  }

  return prompts;
}

interface RegenPromptParams {
  useMock: boolean;
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
  const { useMock, apiKey, apiKeys, sceneIndex, promptIndex, sentence, currentPrompt, style, nhan_vat_prompts } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `[REGEN c${sceneIndex+1}-${String(promptIndex+1).padStart(2, '0')}] Cinematic high dynamic range, Neo-Veridia cyberpunk scene, Khải Đăng resolving mysteries under purple neon haze, photorealistic, 8k.`;
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'REGENERATE_PROMPT',
      apiKeys: keysToUse,
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
  useMock: boolean;
  apiKey?: string;
  apiKeys?: string[];
  model?: string;
}

export async function generateImageAction(params: GenerateImageParams): Promise<{ imagePath: string; projectUrl?: string; usedApiKey?: string; method?: string }> {
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
    useMock,
    apiKey,
    apiKeys
  } = params;

  // Tự động tìm prompt tạo hình tham chiếu của nhân vật nếu tên được nhắc đến
  let characterPrompt = '';
  if (nhan_vat && nhan_vat_prompts) {
    for (const char of nhan_vat) {
      if (prompt.toLowerCase().includes(char.toLowerCase()) || (sentence && sentence.toLowerCase().includes(char.toLowerCase()))) {
        const charRef = nhan_vat_prompts[char];
        if (charRef && charRef.prompt) {
          characterPrompt = charRef.prompt;
          break;
        }
      }
    }
  }

  const drivePath = savePathImage || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Studio Cảnh` : '');

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
      cookie: selectedCookie,
      characterPrompt,
      useMock,
      apiKey,
      apiKeys,
      model: params.model,
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi không xác định từ máy chủ sinh ảnh.');
  }

  return await res.json();
}
