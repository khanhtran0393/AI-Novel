import { useNovelStore } from '@/store/useNovelStore';

interface GenCharPromptParams {
  char: string;
  dan_y_tong_the: string;
  lorebook: string;
  gioiTinh: string;
  quanAo: string;
  soThich: string;
  thoiQuen: string;
  apiKeys: string[];
  apiKey: string;
  useMock: boolean;
}

export async function generateCharPromptAction(params: GenCharPromptParams): Promise<{
  gioi_tinh?: string;
  quan_ao?: string;
  so_thich?: string;
  thoi_quen?: string;
  prompt?: string;
}> {
  const { char, dan_y_tong_the, lorebook, gioiTinh, quanAo, soThich, thoiQuen, apiKeys, apiKey, useMock } = params;
  


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
      requestType: 'GENERATE_CHARACTER_PROMPT',
      apiKeys: keysToUse,
      model,
      payload: {
        name: char,
        dan_y_tong_the,
        lorebook,
        gioi_tinh: gioiTinh,
        quan_ao: quanAo,
        so_thich: soThich,
        thoi_quen: thoiQuen
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi sinh hồ sơ nhân vật.');
  }

  return await res.json();
}

interface RegenCharPromptParams {
  char: string;
  gioiTinh: string;
  quanAo: string;
  soThich: string;
  thoiQuen: string;
  apiKeys: string[];
  apiKey: string;
  useMock: boolean;
}

export async function regenerateCharPromptOnlyAction(params: RegenCharPromptParams): Promise<string> {
  const { char, gioiTinh, quanAo, soThich, thoiQuen, apiKeys, apiKey, useMock } = params;



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
      requestType: 'GENERATE_CHARACTER_PROMPT_ONLY',
      apiKeys: keysToUse,
      model,
      payload: {
        name: char,
        gioi_tinh: gioiTinh,
        quan_ao: quanAo,
        so_thich: soThich,
        thoi_quen: thoiQuen
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi tạo lại prompt.');
  }

  const data = await res.json();
  return data.prompt || '';
}

interface GenCharImageParams {
  char: string;
  charPrompt: string;
  savePathCharacter: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  googleStudioCookies: string[];
  googleStudioCookie: string;
  useMock: boolean;
}

export async function generateCharImageAction(params: GenCharImageParams): Promise<{ imagePath: string; projectUrl?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { char, charPrompt, savePathCharacter, googleDrivePath, ten_tac_pham, googleStudioCookies, googleStudioCookie, useMock } = params;

  if (!charPrompt) {
    throw new Error('⚠️ Vui lòng soạn thảo hoặc bấm "Gen Prompt AI" cho nhân vật trước khi sinh ảnh.');
  }

  const selectedCookie = googleStudioCookies?.[0] || googleStudioCookie;
  const drivePath = savePathCharacter || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Hồ Sơ Nhân Vật` : '');

  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: charPrompt,
      chapterNum: 0, // 0 cho nhân vật
      sceneIndex: 999, // 999 cho nhân vật
      promptIndex: 999,
      drivePath,
      ten_tac_pham,
      cookie: selectedCookie,
      useMock
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi không xác định từ máy chủ Google Labs Whisk.');
  }

  return await res.json();
}
