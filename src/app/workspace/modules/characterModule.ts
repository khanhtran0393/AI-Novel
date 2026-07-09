import { useNovelStore } from '@/store/useNovelStore';
import {
  composeCharacterReferenceSheetPrompt,
  type NhanVatProfile,
} from '@/lib/characterProfile';

function resolveKeysForModel() {
  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse =
      storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0
        ? storeState.openaiApiKeys
        : storeState.openaiApiKey
          ? [storeState.openaiApiKey]
          : [];
  } else if (model === 'llama') {
    keysToUse =
      storeState.grokApiKeys && storeState.grokApiKeys.length > 0
        ? storeState.grokApiKeys
        : storeState.grokApiKey
          ? [storeState.grokApiKey]
          : [];
  } else {
    keysToUse =
      storeState.apiKeys && storeState.apiKeys.length > 0
        ? storeState.apiKeys
        : storeState.apiKey
          ? [storeState.apiKey]
          : [];
  }
  return { model, keysToUse };
}

export interface GenCharPromptParams {
  char: string;
  dan_y_tong_the: string;
  lorebook: string;
  profile: Partial<NhanVatProfile>;
}

export async function generateCharPromptAction(
  params: GenCharPromptParams,
): Promise<Partial<NhanVatProfile>> {
  const { char, dan_y_tong_the, lorebook, profile } = params;
  const { model, keysToUse } = resolveKeysForModel();

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
        gioi_tinh: profile.gioi_tinh || '',
        tuoi: profile.tuoi || '',
        dang_nguoi: profile.dang_nguoi || '',
        vai_tro: profile.vai_tro || '',
        quan_ao: profile.quan_ao || '',
        so_thich: profile.so_thich || '',
        thoi_quen: profile.thoi_quen || '',
        dong_co: profile.dong_co || '',
        giong_thoai: profile.giong_thoai || '',
        ngoai_hinh: profile.ngoai_hinh || '',
        dac_diem_nhan_dang: profile.dac_diem_nhan_dang || '',
        khuet_tat: profile.khuet_tat || '',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lỗi sinh hồ sơ nhân vật.');
  }

  return await res.json();
}

export async function regenerateCharPromptOnlyAction(
  params: { char: string; profile: Partial<NhanVatProfile> },
): Promise<string> {
  const { char, profile } = params;
  const { model, keysToUse } = resolveKeysForModel();

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
        gioi_tinh: profile.gioi_tinh || '',
        tuoi: profile.tuoi || '',
        dang_nguoi: profile.dang_nguoi || '',
        quan_ao: profile.quan_ao || '',
        so_thich: profile.so_thich || '',
        thoi_quen: profile.thoi_quen || '',
        ngoai_hinh: profile.ngoai_hinh || '',
        dac_diem_nhan_dang: profile.dac_diem_nhan_dang || '',
        khuet_tat: profile.khuet_tat || '',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lỗi tạo lại prompt.');
  }

  const data = await res.json();
  return data.prompt || '';
}

interface GenCharImageCoreParams {
  prompt: string;
  savePathCharacter: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  googleStudioCookies: string[];
  googleStudioCookie: string;
  /** Optional scene/prompt index override for unique file names */
  sceneIndex?: number;
  promptIndex?: number;
}

export async function generateCharImageCore(
  params: GenCharImageCoreParams,
): Promise<{ imagePath: string; projectUrl?: string }> {
  const {
    prompt,
    savePathCharacter,
    googleDrivePath,
    ten_tac_pham,
    googleStudioCookies,
    googleStudioCookie,
    sceneIndex = 999,
    promptIndex = 999,
  } = params;

  if (!prompt?.trim()) {
    throw new Error('⚠️ Vui lòng soạn thảo hoặc bấm "Gen Prompt AI" cho nhân vật trước khi sinh ảnh.');
  }

  const selectedCookie = googleStudioCookies?.[0] || googleStudioCookie;
  const drivePath =
    savePathCharacter ||
    (googleDrivePath
      ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Hồ Sơ Nhân Vật`
      : '');

  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      chapterNum: 0,
      sceneIndex,
      promptIndex,
      drivePath,
      ten_tac_pham,
      cookie: selectedCookie,
      imageProvider: 'gemini',
      model: 'whisk',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Lỗi không xác định từ máy chủ Google Labs Whisk.');
  }

  return await res.json();
}

interface GenCharImageParams {
  char: string;
  /** Optional override; if empty, builds unified sheet prompt from profile */
  charPrompt?: string;
  profile?: Partial<NhanVatProfile>;
  savePathCharacter: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  googleStudioCookies: string[];
  googleStudioCookie: string;
}

/**
 * Gen MỘT ảnh sheet gộp:
 * front master + turnaround 4 chiều + hàng biểu cảm khuôn mặt.
 * Lưu key: char_{tên}
 */
export async function generateCharImageAction(
  params: GenCharImageParams,
): Promise<{ imagePath: string; projectUrl?: string; promptUsed: string }> {
  const sheetPrompt =
    params.charPrompt?.trim() ||
    composeCharacterReferenceSheetPrompt(params.profile || {}, params.char);

  const data = await generateCharImageCore({
    prompt: sheetPrompt,
    savePathCharacter: params.savePathCharacter,
    googleDrivePath: params.googleDrivePath,
    ten_tac_pham: params.ten_tac_pham,
    googleStudioCookies: params.googleStudioCookies,
    googleStudioCookie: params.googleStudioCookie,
    sceneIndex: 999,
    promptIndex: 999,
  });

  return { ...data, promptUsed: sheetPrompt };
}

/** @deprecated multi-image path removed — use generateCharImageAction (1 sheet) */
export type GenSheetProgress = {
  kind: 'sheet';
  key: string;
  label: string;
  index: number;
  total: number;
};
