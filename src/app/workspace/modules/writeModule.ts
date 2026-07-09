import { Chuong, useNovelStore } from '@/store/useNovelStore';
import { resolveUserRules } from '@/lib/youtubeSafe';
import type { NhanVatProfile } from '@/lib/characterProfile';

export interface WriteChapterParams {
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  dan_y_tong_the: string;
  lorebook: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  nhan_vat: string[];
  nhan_vat_prompts?: Record<string, Partial<NhanVatProfile>>;
  chuong_hien_tai: Chuong;
  so_chuong: number;
  so_tu_chuong: number;
  ngon_ngu?: string;
  noi_dung_hien_tai: string;
  userRules?: {
    forbidden_words: string;
    fatigue_words: string;
  };
  da_dien_ra_entities?: {
    dia_diem: string[];
    vat_pham: string[];
    motifs: string[];
  };
  world_state?: {
    inventory: string[];
    discovered_clues: string[];
    current_location: string;
  };
  current_beat_type?: string;
  intervention_directive?: string;
  force_word_gate_continue?: boolean;
  signal?: AbortSignal;
}

export interface WriteChapterResult {
  noi_dung: string;
  wordCount?: number;
  sceneCount?: number;
  wordMin?: number;
  wordGoal?: number;
  needsContinue?: boolean;
  wordsOk?: boolean;
  scenesOk?: boolean;
}

function resolveKeysToUse(): { keysToUse: string[]; model: string } {
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

  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.');
  }

  return { keysToUse, model };
}

async function postGenerate(
  requestType: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { keysToUse, model } = resolveKeysToUse();
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType,
      apiKeys: keysToUse,
      model,
      payload,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Lỗi API ${requestType}.`);
  }

  return (await res.json()) as Record<string, unknown>;
}

export async function compressContextAction(params: {
  apiKeys: string[];
  apiKey: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  signal?: AbortSignal;
}): Promise<string> {
  const data = await postGenerate(
    'COMPRESS_CONTEXT',
    {
      tom_tat_cuon_chieu: params.tom_tat_cuon_chieu,
      tri_nho_ngan_han: params.tri_nho_ngan_han,
    },
    params.signal,
  );
  if (!data.compressedMemory) {
    throw new Error('API nén ngữ cảnh không trả về compressedMemory.');
  }
  return String(data.compressedMemory);
}

export async function writeChapterAction(params: WriteChapterParams): Promise<WriteChapterResult> {
  const {
    ten_tac_pham,
    dan_y_tong_the,
    lorebook,
    tom_tat_cuon_chieu,
    tri_nho_ngan_han,
    nhan_vat,
    nhan_vat_prompts,
    chuong_hien_tai,
    so_chuong,
    so_tu_chuong,
    ngon_ngu,
    noi_dung_hien_tai,
    userRules,
    da_dien_ra_entities,
    world_state,
    current_beat_type,
    intervention_directive,
    force_word_gate_continue,
    signal,
  } = params;

  let compressedMemory = tom_tat_cuon_chieu;
  if (tom_tat_cuon_chieu && tom_tat_cuon_chieu.length > 5000) {
    compressedMemory = await compressContextAction({
      apiKeys: params.apiKeys,
      apiKey: params.apiKey,
      tom_tat_cuon_chieu,
      tri_nho_ngan_han,
      signal,
    });
  }

  const storeYt = useNovelStore.getState().youtubeSafe;
  const data = await postGenerate(
    'WRITE_CHAPTER',
    {
      ten_tac_pham,
      dan_y_tong_the,
      lorebook,
      tom_tat_cuon_chieu: compressedMemory,
      tri_nho_ngan_han,
      nhan_vat,
      nhan_vat_prompts,
      chuong_hien_tai,
      so_chuong,
      so_tu_chuong,
      ngon_ngu,
      noi_dung_hien_tai,
      userRules: resolveUserRules(userRules),
      da_dien_ra_entities,
      world_state,
      current_beat_type,
      intervention_directive,
      force_word_gate_continue,
      humanize_script: storeYt?.humanizeScript !== false,
    },
    signal,
  );

  return {
    noi_dung: String(data.noi_dung || 'Không có nội dung trả về.').normalize('NFC'),
    wordCount: typeof data.wordCount === 'number' ? data.wordCount : undefined,
    sceneCount: typeof data.sceneCount === 'number' ? data.sceneCount : undefined,
    wordMin: typeof data.wordMin === 'number' ? data.wordMin : undefined,
    wordGoal: typeof data.wordGoal === 'number' ? data.wordGoal : undefined,
    needsContinue: Boolean(data.needsContinue),
    wordsOk: data.wordsOk !== false,
    scenesOk: data.scenesOk !== false,
  };
}

export async function reviseChapterAction(params: {
  ten_tac_pham: string;
  chuong_hien_tai: Chuong;
  noi_dung_kich_ban: string;
  lorebook: string;
  userRules: { forbidden_words: string; fatigue_words: string };
  review: {
    dimensions?: { dimension: string; score: number; comment: string }[];
    verdict?: string;
    summary?: string;
  };
  mode: 'rewrite' | 'polish' | 'audio_readability';
  ngon_ngu?: string;
  so_tu_chuong?: number;
  nhan_vat?: string[];
  nhan_vat_prompts?: WriteChapterParams['nhan_vat_prompts'];
  signal?: AbortSignal;
}): Promise<WriteChapterResult> {
  const storeYt = useNovelStore.getState().youtubeSafe;
  const data = await postGenerate(
    'REVISE_CHAPTER',
    {
      ten_tac_pham: params.ten_tac_pham,
      chuong_hien_tai: params.chuong_hien_tai,
      noi_dung_kich_ban: params.noi_dung_kich_ban,
      lorebook: params.lorebook,
      userRules: resolveUserRules(params.userRules),
      review: params.review,
      mode: params.mode,
      ngon_ngu: params.ngon_ngu,
      so_tu_chuong: params.so_tu_chuong,
      nhan_vat: params.nhan_vat,
      nhan_vat_prompts: params.nhan_vat_prompts,
      humanize_script: storeYt?.humanizeScript !== false,
    },
    params.signal,
  );

  return {
    noi_dung: String(data.noi_dung || 'Không có nội dung trả về.').normalize('NFC'),
    wordCount: typeof data.wordCount === 'number' ? data.wordCount : undefined,
    sceneCount: typeof data.sceneCount === 'number' ? data.sceneCount : undefined,
    needsContinue: Boolean(data.needsContinue),
    wordsOk: data.wordsOk !== false,
    scenesOk: data.scenesOk !== false,
  };
}

export async function evaluateChapterAction(params: {
  apiKey: string;
  apiKeys: string[];
  chuong_hien_tai: Chuong;
  noi_dung_kich_ban: string;
  userRules: { forbidden_words: string; fatigue_words: string };
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  return postGenerate(
    'EVALUATE_CHAPTER',
    {
      chuong_hien_tai: params.chuong_hien_tai,
      noi_dung_kich_ban: params.noi_dung_kich_ban,
      userRules: resolveUserRules(params.userRules),
    },
    params.signal,
  );
}

export async function planArcAction(params: {
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  lorebook: string;
  danh_sach_chuong_da_viet: string;
  cung_hien_tai: number;
  so_chuong_moi_cung: number;
  chuong_bat_dau: number;
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  const { signal, apiKey: _a, apiKeys: _b, ...payload } = params;
  return postGenerate('PLAN_ARC', payload as unknown as Record<string, unknown>, signal);
}

export async function commitMemoryAction(params: {
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  chuong_hien_tai: Chuong;
  noi_dung_kich_ban: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  lorebook: string;
  world_state?: {
    inventory: string[];
    discovered_clues: string[];
    current_location: string;
  };
  da_dien_ra_entities?: {
    dia_diem: string[];
    vat_pham: string[];
    motifs: string[];
  };
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  return postGenerate(
    'COMMIT_MEMORY',
    {
      ten_tac_pham: params.ten_tac_pham,
      chuong_hien_tai: params.chuong_hien_tai,
      noi_dung_kich_ban: params.noi_dung_kich_ban,
      tom_tat_cuon_chieu: params.tom_tat_cuon_chieu,
      tri_nho_ngan_han: params.tri_nho_ngan_han,
      lorebook: params.lorebook,
      world_state: params.world_state,
      da_dien_ra_entities: params.da_dien_ra_entities,
    },
    params.signal,
  );
}
