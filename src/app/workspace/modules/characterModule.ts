import { useNovelStore } from '@/store/useNovelStore';
import {
  composeCharacterReferenceSheetPrompt,
  type NhanVatProfile,
} from '@/lib/characterProfile';
import { API, postGenerate } from './apiClient';

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
  const store = useNovelStore.getState();
  const styleHint = String(
    store.visualDnaPrompt || store.mediaStylePreset || '',
  ).trim();
  const chu_de = String(store.setup?.chu_de || '').trim();
  const phong_cach = String(store.setup?.phong_cach || '').trim();
  const genre = [chu_de, phong_cach].filter(Boolean).join(' / ');
  if (!styleHint && !genre) {
    throw new Error(
      'Thieu Visual DNA / Media Style va Setup (Chu de + Phong cach) khi gen prompt nhan vat. App khong tu gan the loai mac dinh.',
    );
  }
  const data = await postGenerate(
    'GENERATE_CHARACTER_PROMPT',
    {
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
        styleHint,
        style: styleHint,
        visualDnaPrompt: store.visualDnaPrompt || '',
        chu_de,
        phong_cach,
        genre,
      },
  );
  return data as Partial<NhanVatProfile>;
}

export async function regenerateCharPromptOnlyAction(
  params: { char: string; profile: Partial<NhanVatProfile> },
): Promise<string> {
  const { char, profile } = params;
  const store = useNovelStore.getState();
  const styleHint = String(
    store.visualDnaPrompt || store.mediaStylePreset || '',
  ).trim();
  const chu_de = String(store.setup?.chu_de || '').trim();
  const phong_cach = String(store.setup?.phong_cach || '').trim();
  const genre = [chu_de, phong_cach].filter(Boolean).join(' / ');
  if (!styleHint && !genre) {
    throw new Error(
      'Thieu Visual DNA / Setup khi gen character prompt only. App khong tu gan the loai mac dinh.',
    );
  }
  const data = await postGenerate(
    'GENERATE_CHARACTER_PROMPT_ONLY',
    {
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
        styleHint,
        style: styleHint,
        visualDnaPrompt: store.visualDnaPrompt || '',
        chu_de,
        phong_cach,
        genre,
      },
  );
  const out = String((data as { prompt?: string }).prompt || '').trim();
  if (!out) {
    throw new Error('API character prompt only tra rong. Khong dung fill cuc bo.');
  }
  return out;
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


async function generateCharImageCore(params: {
  prompt: string;
  savePathCharacter: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  googleStudioCookies: string[];
  googleStudioCookie: string;
  sceneIndex: number;
  promptIndex: number;
}): Promise<{ imagePath: string; projectUrl?: string }> {
  const store = useNovelStore.getState();
  const imageProvider = (store.imageProvider || '').trim();
  const model = (store.imageModel || '').trim();
  const imageAspectRatio = (store.imageAspectRatio || '').trim();
  if (!imageProvider) {
    throw new Error('Chua chon imageProvider. App khong tu gan provider.');
  }
  if (!model) {
    throw new Error('Chua chon imageModel. App khong tu gan model.');
  }
  if (!imageAspectRatio) {
    throw new Error('Chua chon imageAspectRatio. App khong tu gan ty le anh.');
  }
  const cookie =
    (params.googleStudioCookies && params.googleStudioCookies[0]) ||
    params.googleStudioCookie ||
    store.googleStudioCookie ||
    '';
  const res = await fetch(API.generateImage, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      chapterNum: 0,
      sceneIndex: params.sceneIndex,
      promptIndex: params.promptIndex,
      drivePath: params.savePathCharacter || params.googleDrivePath || '',
      ten_tac_pham: params.ten_tac_pham,
      cookie,
      imageProvider,
      model,
      imageApiKey: store.imageApiKey || '',
      imageAspectRatio,
      imageCount: 1,
      aiMasterApiKey: store.aiMasterApiKey || '',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || 'Lỗi gen ảnh nhân vật.',
    );
  }
  const data = (await res.json()) as { imagePath?: string; projectUrl?: string };
  return { imagePath: data.imagePath || '', projectUrl: data.projectUrl };
}

/** @deprecated multi-image path removed — use generateCharImageAction (1 sheet) */
export type GenSheetProgress = {
  kind: 'sheet';
  key: string;
  label: string;
  index: number;
  total: number;
};
