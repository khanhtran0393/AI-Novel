import { useNovelStore } from '@/store/useNovelStore';
import {
  composeCharacterReferenceSheetPrompt,
  type NhanVatProfile,
} from '@/lib/characterProfile';
import {
  localCharacterSheetFilename,
  localCharacterWardrobeFilename,
} from '@/contracts';
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
  const data = await postGenerate('GENERATE_CHARACTER_PROMPT', {
    name: char,
    dan_y_tong_the,
    lorebook,
    gioi_tinh: profile.gioi_tinh || '',
    tuoi: profile.tuoi || '',
    dang_nguoi: profile.dang_nguoi || '',
    chieu_cao: profile.chieu_cao || '',
    vai_tro: profile.vai_tro || '',
    quan_ao: profile.quan_ao || '',
    phu_kien: profile.phu_kien || '',
    so_thich: profile.so_thich || '',
    thoi_quen: profile.thoi_quen || '',
    dong_co: profile.dong_co || '',
    giong_thoai: profile.giong_thoai || '',
    ngoai_hinh: profile.ngoai_hinh || '',
    dac_diem_nhan_dang: profile.dac_diem_nhan_dang || '',
    khuet_tat: profile.khuet_tat || '',
    mau_sac: profile.mau_sac || '',
    styleHint,
    style: styleHint,
    visualDnaPrompt: store.visualDnaPrompt || '',
    chu_de,
    phong_cach,
    genre,
  });
  return data as Partial<NhanVatProfile>;
}

export async function regenerateCharPromptOnlyAction(params: {
  char: string;
  profile: Partial<NhanVatProfile>;
}): Promise<string> {
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
  const data = await postGenerate('GENERATE_CHARACTER_PROMPT_ONLY', {
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
  });
  const out = String((data as { prompt?: string }).prompt || '').trim();
  if (!out) {
    throw new Error(
      'API character prompt only tra rong. Khong dung fill cuc bo.',
    );
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
  /** Wardrobe variant id → unique disk file */
  wardrobeId?: string;
}

/**
 * Build displayable /api/serve-image URL from public file, serve URL, or absolute path.
 */
export function toServeImageUrl(raw: string): string {
  const s0 = String(raw || '').trim();
  if (!s0) return '';
  if (s0.startsWith('/api/serve-image')) return s0.split('&t=')[0].split('?t=')[0];
  if (s0.includes('/api/serve-image?')) {
    try {
      const u = new URL(s0, 'http://local');
      const file = u.searchParams.get('file');
      const p = u.searchParams.get('path');
      if (file) return `/api/serve-image?file=${encodeURIComponent(file)}`;
      if (p) return `/api/serve-image?path=${encodeURIComponent(p)}`;
    } catch {
      /* fall through */
    }
  }
  const s = s0.split('?')[0];
  const base = s.replace(/\\/g, '/').split('/').pop() || '';
  if (
    base &&
    (/^char_sheet_/i.test(base) ||
      /^chapter_/i.test(base) ||
      s.includes('public/images') ||
      s.includes('public\\images'))
  ) {
    return `/api/serve-image?file=${encodeURIComponent(base)}`;
  }
  // Absolute durable face_ref (user save folder)
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/')) {
    return `/api/serve-image?path=${encodeURIComponent(s)}`;
  }
  if (base) return `/api/serve-image?file=${encodeURIComponent(base)}`;
  return s0;
}

/**
 * Gen MỘT ảnh sheet gộp:
 * front master + turnaround 4 chiều + hàng biểu cảm khuôn mặt.
 * Lưu key store: char_{tên} · file đĩa: char_sheet_{tên}.png (unique / NV)
 */
export async function generateCharImageAction(
  params: GenCharImageParams,
): Promise<{
  imagePath: string;
  durablePath: string;
  projectUrl?: string;
  promptUsed: string;
}> {
  const storeForStyle = useNovelStore.getState();
  const styleHint = String(
    storeForStyle.visualDnaPrompt || storeForStyle.mediaStylePreset || '',
  ).trim();
  const genre = [
    storeForStyle.setup?.chu_de,
    storeForStyle.setup?.phong_cach,
  ]
    .filter(Boolean)
    .join(' / ')
    .trim();

  const sheetPrompt =
    params.charPrompt?.trim() ||
    composeCharacterReferenceSheetPrompt(params.profile || {}, params.char, {
      styleHint,
      genre,
    });

  const assetFilename = params.wardrobeId
    ? localCharacterWardrobeFilename(params.char, params.wardrobeId)
    : localCharacterSheetFilename(params.char);

  const data = await generateCharImageCore({
    prompt: sheetPrompt,
    savePathCharacter: params.savePathCharacter,
    googleDrivePath: params.googleDrivePath,
    ten_tac_pham: params.ten_tac_pham,
    googleStudioCookies: params.googleStudioCookies,
    googleStudioCookie: params.googleStudioCookie,
    assetFilename,
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
  assetFilename: string;
}): Promise<{ imagePath: string; durablePath: string; projectUrl?: string }> {
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
  const { offThreadFetchResponse } = await import(
    '@/lib/appWork/offThreadFetchCompat'
  );
  const { buildClientApiHeaders } = await import('./apiClient');
  const res = await offThreadFetchResponse(API.generateImage, {
    method: 'POST',
    headers: buildClientApiHeaders(),
    body: JSON.stringify({
      prompt: params.prompt,
      chapterNum: 0,
      // Legacy indices — server prefers assetFilename for unique disk name
      sceneIndex: 999,
      promptIndex: 999,
      assetFilename: params.assetFilename,
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
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Lỗi gen ảnh nhân vật.');
  }
  const data = (await res.json()) as {
    imagePath?: string;
    driveFilePath?: string;
    localFilePath?: string;
    projectUrl?: string;
  };
  const imagePath = String(data.imagePath || '').trim();
  if (!imagePath) {
    throw new Error('API gen sheet không trả imagePath. Không soft-success.');
  }
  // Prefer absolute save-folder copy for face_ref (survives public/images wipe)
  const durablePath =
    String(data.driveFilePath || data.localFilePath || '').trim() || imagePath;
  return {
    imagePath: toServeImageUrl(imagePath) || imagePath,
    durablePath,
    projectUrl: data.projectUrl,
  };
}

/** @deprecated multi-image path removed — use generateCharImageAction (1 sheet) */
export type GenSheetProgress = {
  kind: 'sheet';
  key: string;
  label: string;
  index: number;
  total: number;
};
