import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import { resolveUserRules } from '@/lib/youtubeSafe';
import type { NhanVatProfile } from '@/lib/characterProfile';
import { postGenerate } from './apiClient';
import { lorebookWithMemoryPack } from '@/lib/pipeline';

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
    { signal: params.signal },
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

  const store = useNovelStore.getState();
  const storeYt = store.youtubeSafe;
  const chu_de = String(store.setup?.chu_de || '').trim();
  const phong_cach = String(store.setup?.phong_cach || '').trim();
  const mo_ta = String(store.setup?.mo_ta || '').trim();
  if (!chu_de && !phong_cach) {
    throw new Error(
      'Chưa chọn Setup Chủ đề + Phong cách. Mở nút Setup (sidebar) chọn cả hai trước khi viết chương. App không tự gán thể loại mặc định.',
    );
  }
  // Preflight fingerprint (speech) — clear toast, no unhandledRejection / silent invent
  {
    const { validateSpeechFingerprints } = await import('@/lib/youtubeSafe');
    const fpErr = validateSpeechFingerprints(nhan_vat, nhan_vat_prompts);
    if (fpErr) throw new Error(fpErr);
  }
  // P0 — inject foreshadow ledger into lorebook (no invented world rules)
  const lorebookEnriched = lorebookWithMemoryPack(lorebook);

  const data = await postGenerate(
    'WRITE_CHAPTER',
    {
      ten_tac_pham,
      dan_y_tong_the,
      lorebook: lorebookEnriched,
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
      chu_de,
      phong_cach,
      mo_ta,
      genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      scriptMode: store.scriptMode,
      wpm: store.wpm,
    },
    { signal },
  );

  const noi_dung = String(data.noi_dung || '').trim();
  if (!noi_dung) {
    throw new Error(
      'WRITE_CHAPTER trả nội dung rỗng. Không dùng fill cục bộ — thử lại hoặc kiểm tra API key.',
    );
  }
  return {
    noi_dung: noi_dung.normalize('NFC'),
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
  const store = useNovelStore.getState();
  const storeYt = store.youtubeSafe;
  const chu_de = String(store.setup?.chu_de || '').trim();
  const phong_cach = String(store.setup?.phong_cach || '').trim();
  const mo_ta = String(store.setup?.mo_ta || '').trim();
  if (!chu_de && !phong_cach) {
    throw new Error(
      'Chưa chọn Setup Chủ đề + Phong cách. Mở nút Setup (sidebar) chọn cả hai trước khi sửa chương. App không tự gán thể loại mặc định.',
    );
  }
  {
    const { validateSpeechFingerprints } = await import('@/lib/youtubeSafe');
    const fpErr = validateSpeechFingerprints(
      params.nhan_vat,
      params.nhan_vat_prompts,
    );
    if (fpErr) throw new Error(fpErr);
  }
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
      chu_de,
      phong_cach,
      mo_ta,
      genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      scriptMode: store.scriptMode,
      wpm: store.wpm,
    },
    { signal: params.signal },
  );

  const noi_dung = String(data.noi_dung || '').trim();
  if (!noi_dung) {
    throw new Error(
      'REVISE_CHAPTER trả nội dung rỗng. Không dùng fill cục bộ — thử lại hoặc kiểm tra API key.',
    );
  }
  return {
    noi_dung: noi_dung.normalize('NFC'),
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
  const store = useNovelStore.getState();
  const chu_de = String(store.setup?.chu_de || '').trim();
  const phong_cach = String(store.setup?.phong_cach || '').trim();
  if (!chu_de && !phong_cach) {
    throw new Error(
      'Chưa chọn Setup Chủ đề + Phong cách. Mở nút Setup (sidebar) chọn cả hai trước khi chấm chương. App không tự gán thể loại mặc định.',
    );
  }
  return postGenerate(
    'EVALUATE_CHAPTER',
    {
      chuong_hien_tai: params.chuong_hien_tai,
      noi_dung_kich_ban: params.noi_dung_kich_ban,
      userRules: resolveUserRules(params.userRules),
      chu_de,
      phong_cach,
      genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      scriptMode: store.scriptMode,
    },
    { signal: params.signal },
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
  const setup = useNovelStore.getState().setup;
  const chu_de = String(setup?.chu_de || '').trim();
  const phong_cach = String(setup?.phong_cach || '').trim();
  if (!chu_de && !phong_cach) {
    throw new Error(
      'Chưa chọn Setup Chủ đề + Phong cách. Mở nút Setup (sidebar) chọn cả hai trước khi plan arc. App không tự gán thể loại mặc định.',
    );
  }
  const result = await postGenerate(
    'PLAN_ARC',
    {
      ...(payload as Record<string, unknown>),
      chu_de,
      phong_cach,
      genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      scriptMode: useNovelStore.getState().scriptMode,
    },
    { signal },
  );
  // P2: MiroFish only after arc plan — enrich lorebook hooks (silent)
  try {
    const { silentEnrichArcHooks } = await import('./integrationsModule');
    void silentEnrichArcHooks({
      context: 'plan_arc',
      hypothesis: `Arc kế tiếp sau plan (cung ${params.cung_hien_tai}): ${params.ten_tac_pham}`,
    });
  } catch {
    /* never block planArc */
  }
  return result;
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
  // Always forward keys — do not rely solely on store auto-resolve
  const keys =
    Array.isArray(params.apiKeys) && params.apiKeys.length > 0
      ? params.apiKeys.filter(Boolean)
      : params.apiKey
        ? [params.apiKey]
        : undefined;
  const setup = useNovelStore.getState().setup;
  const chu_de = String(setup?.chu_de || '').trim();
  const phong_cach = String(setup?.phong_cach || '').trim();
  return postGenerate(
    'COMMIT_MEMORY',
    {
      ten_tac_pham: params.ten_tac_pham,
      chuong_hien_tai: params.chuong_hien_tai,
      noi_dung_kich_ban: params.noi_dung_kich_ban,
      tom_tat_cuon_chieu: params.tom_tat_cuon_chieu,
      tri_nho_ngan_han: params.tri_nho_ngan_han,
      chu_de,
      phong_cach,
      genre: [chu_de, phong_cach].filter(Boolean).join(' / '),
      scriptMode: useNovelStore.getState().scriptMode,
      lorebook: params.lorebook,
      world_state: params.world_state,
      da_dien_ra_entities: params.da_dien_ra_entities,
    },
    { signal: params.signal, apiKeys: keys, autoKeys: true },
  );
}


