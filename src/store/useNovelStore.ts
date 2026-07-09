import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { filterOutChapterKeys } from '@/lib/storyWriting';
import { mergeYoutubeSafe as mergeYoutubeSafeConfig } from '@/lib/youtubeSafe';
import {
  emptyNhanVatProfile,
  normalizeNhanVatProfile,
  type NhanVatProfile,
  type NhanVatPromptsMap,
} from '@/lib/characterProfile';
import {
  EMPTY_VOICE_CAST,
  characterRoleId,
  findRoleByCharacter,
  maxVinaRoleIndex,
  normalizeVoiceCast,
  type CastSegment,
  type ProjectVoiceCast,
  type VoiceRole,
  NARRATOR_ROLE_ID,
} from '@/lib/voiceCast';
import {
  ensureSeededCast,
  migrateRolesForPlatform,
} from '@/lib/castSeed';
import { suggestProsodyFromProfile } from '@/lib/characterVoice';

export type { NhanVatProfile, NhanVatPromptsMap, ProjectVoiceCast, VoiceRole };

const STORE_KEY = 'novel_generator_v2_store';

type AinovelPersistApi = {
  storeKey: string;
  getStoreSync: () => string | null;
  setStore: (raw: string) => Promise<unknown>;
  setStoreSync: (raw: string) => { ok?: boolean } | null;
  flush: () => Promise<unknown>;
  getPaths: () => Promise<unknown>;
  getBootInfo: () => unknown;
  isElectron: boolean;
};

function getPersistApi(): AinovelPersistApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ainovelPersist?: AinovelPersistApi }).ainovelPersist || null;
}

/** Score a raw zustand persist payload (sync, browser-safe). */
function scoreStoreRaw(raw: string | null | undefined): number {
  if (!raw || typeof raw !== 'string') return 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const chapters = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    const chapterContentChars = chapters.reduce(
      (sum: number, c: { noi_dung?: string }) => sum + String(c?.noi_dung || '').trim().length,
      0,
    );
    const readyChapters = chapters.filter(
      (c: { noi_dung?: string }) => String(c?.noi_dung || '').trim().length > 0,
    ).length;
    const keyCount = [
      state?.apiKey,
      state?.openaiApiKey,
      state?.grokApiKey,
      state?.lumaApiKey,
      state?.runwayApiKey,
      state?.falaiApiKey,
      state?.imageApiKey,
      state?.videoApiKey,
      state?.aiMasterApiKey,
      state?.googleStudioCookie,
      ...(Array.isArray(state?.apiKeys) ? state.apiKeys : []),
      ...(Array.isArray(state?.openaiApiKeys) ? state.openaiApiKeys : []),
      ...(Array.isArray(state?.grokApiKeys) ? state.grokApiKeys : []),
      ...(Array.isArray(state?.lumaApiKeys) ? state.lumaApiKeys : []),
      ...(Array.isArray(state?.runwayApiKeys) ? state.runwayApiKeys : []),
      ...(Array.isArray(state?.falaiApiKeys) ? state.falaiApiKeys : []),
      ...(Array.isArray(state?.googleStudioCookies) ? state.googleStudioCookies : []),
    ].filter(Boolean).length;
    const generatedAssets =
      Object.keys(state?.generatedAudioPaths || {}).length +
      Object.keys(state?.generatedPrompts || {}).length +
      Object.keys(state?.generatedImages || {}).length +
      Object.keys(state?.generatedVideos || {}).length;
    const loreLen = String(state?.lorebook || '').trim().length;
    const outlineLen = String(state?.dan_y_tong_the || '').trim().length;
    return (
      chapterContentChars +
      readyChapters * 5000 +
      keyCount * 1000 +
      generatedAssets * 100 +
      (state?.giai_doan === 2 ? 2000 : 0) +
      Math.min(loreLen, 2000) +
      Math.min(outlineLen, 2000)
    );
  } catch {
    return 0;
  }
}

let lastDiskPayload = '';
let diskBackupTimer: ReturnType<typeof setTimeout> | null = null;
let hydrationLockedUntil = 0;

function pickRichest(...candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreStoreRaw(c);
    if (c && s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** Triple-write: Electron IPC (primary) + localStorage + HTTP API fallback */
function durableWrite(value: string, { sync = false } = {}) {
  if (typeof window === 'undefined') return;
  if (!value || scoreStoreRaw(value) <= 0) return;
  lastDiskPayload = value;

  const api = getPersistApi();
  if (api) {
    try {
      if (sync && api.setStoreSync) {
        api.setStoreSync(value);
      } else {
        void api.setStore(value);
      }
    } catch {
      // fall through to HTTP
    }
  }

  // HTTP API always as secondary path (works for pure next + electron)
  if (diskBackupTimer) clearTimeout(diskBackupTimer);
  diskBackupTimer = setTimeout(() => {
    diskBackupTimer = null;
    const payload = lastDiskPayload;
    if (!payload || scoreStoreRaw(payload) <= 0) return;
    fetch('/api/persist-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: STORE_KEY, value: payload }),
      keepalive: true,
    }).catch(() => undefined);
  }, sync ? 0 : 500);
}

function flushDurableNow() {
  if (!lastDiskPayload || scoreStoreRaw(lastDiskPayload) <= 0) return;
  const api = getPersistApi();
  try {
    api?.setStoreSync?.(lastDiskPayload);
  } catch {
    // ignore
  }
  try {
    // keepalive beacon for last chance HTTP write
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob(
        [JSON.stringify({ name: STORE_KEY, value: lastDiskPayload })],
        { type: 'application/json' },
      );
      navigator.sendBeacon('/api/persist-store', blob);
    } else {
      fetch('/api/persist-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: STORE_KEY, value: lastDiskPayload }),
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // ignore
  }
}

/**
 * Triple storage:
 * 1. Electron IPC disk (multi-path + secrets) — primary durable
 * 2. localStorage — fast session cache (may wipe)
 * 3. HTTP /api/persist-store — same disk files when not in Electron bridge
 *
 * Preload already injects disk → localStorage before this module runs in Electron.
 */
const dualStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    let local: string | null = null;
    try {
      local = window.localStorage.getItem(name);
    } catch {
      local = null;
    }

    let ipcRaw: string | null = null;
    try {
      ipcRaw = getPersistApi()?.getStoreSync?.() || null;
    } catch {
      ipcRaw = null;
    }

    let httpRaw: string | null = null;
    // Only hit HTTP if local+ipc weak (avoid delaying hydrate)
    const quickBest = pickRichest(local, ipcRaw);
    const quickScore = scoreStoreRaw(quickBest);
    if (quickScore < 500) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`/api/persist-store?name=${encodeURIComponent(name)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = (await res.json()) as { value?: string | null };
          httpRaw = data?.value || null;
        }
      } catch {
        // ignore
      }
    }

    const best = pickRichest(local, ipcRaw, httpRaw);
    if (best) {
      // Mirror winner into localStorage for next paint
      try {
        if (best !== local) window.localStorage.setItem(name, best);
      } catch {
        // quota
      }
      // Refresh durable mirrors (non-blocking)
      durableWrite(best);
      if (scoreStoreRaw(best) > scoreStoreRaw(local)) {
        console.info(
          `[NovelStore] Hydrate từ durable score=${scoreStoreRaw(best)} (local was ${scoreStoreRaw(local)})`,
        );
      }
    }

    // Lock weak writes briefly after hydrate to kill race with INITIAL_STATE
    hydrationLockedUntil = Date.now() + 2500;
    return best;
  },

  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return;

    const newScore = scoreStoreRaw(value);
    try {
      const existing = window.localStorage.getItem(name);
      const existingScore = scoreStoreRaw(existing);
      const ipcScore = scoreStoreRaw(getPersistApi()?.getStoreSync?.() || null);
      const guardScore = Math.max(existingScore, ipcScore);

      // Block catastrophic wipe (empty default overwriting real progress)
      if (guardScore > 500 && newScore < guardScore * 0.25 && newScore < 500) {
        console.warn(
          `[NovelStore] Chặn wipe score ${newScore} (guard ${guardScore}).`,
        );
        if (existing && existingScore >= ipcScore) durableWrite(existing);
        return;
      }

      // During post-hydrate lock, reject weaker writes than what we just loaded
      if (Date.now() < hydrationLockedUntil && guardScore > 0 && newScore < guardScore * 0.9) {
        // Allow minor diffs; only block significant regressions
        if (newScore < guardScore * 0.5) {
          console.warn('[NovelStore] Chặn regression trong hydration lock.');
          return;
        }
      }
    } catch {
      // continue
    }

    try {
      window.localStorage.setItem(name, value);
    } catch (err) {
      console.warn('[NovelStore] localStorage.setItem thất bại:', err);
    }
    durableWrite(value);
  },

  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

// Crash / close safety nets
if (typeof window !== 'undefined') {
  const onLeave = () => flushDurableNow();
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDurableNow();
  });
  // Periodic flush every 20s
  setInterval(() => {
    if (lastDiskPayload && scoreStoreRaw(lastDiskPayload) > 0) {
      durableWrite(lastDiskPayload);
    }
  }, 20_000);
}

export interface PromptAsset {
  timestamp: string;
  prompt: string;
  sentence?: string;
  script_prompt?: string;
  image_prompt?: string;
  video_prompt?: string;
  emotion?: string;
}

export interface Chuong {
  so_chuong: number;
  tieu_de: string;
  dan_y: string;
  noi_dung: string;
  trang_thai: 'empty' | 'writing' | 'ready';
}

export interface SetupData {
  chu_de: string;
  phong_cach: string;
  mo_ta: string;
  so_chuong: number;
  so_tu_chuong?: number; // S? lu?ng t? m?c ti�u m?i chuong (m?c d?nh 4250)
  ngon_ngu?: string; // Ng�n ng? mu?n vi?t (m?c d?nh Ti?ng Vi?t)
}

export interface TTSConfig {
  platform:
    | 'tiktok_tts'
    | 'edge_tts'
    | 'capcut_tts'
    | 'piper'
    | 'gemini_tts'
    | 'omnivoice_local'
    | 'openai_tts'
    | 'hotai_tts'
    | 'vieneu_tts'
    | 'vina_voice';
  language: string;
  voice: string;
  speed: number;
  pitch: number; // Pitch shift in semitones (-12 to 12)
  tiktokSessionId: string;
  api_url_vieneu: string; // Base URL for VieNeu-TTS API
  syncMode?: 'default' | 'force_sync' | 'pro'; // Ch? d? d?ng b? Timestamp
  /** VinaVoice independent engine (optional extras) */
  vinaGender?: 'male' | 'female';
  vinaArea?: 'northern' | 'central' | 'southern';
  vinaGroup?: string;
  vinaEmotion?: string;
  vinaUseClone?: boolean;
  vinaReferenceAudio?: string;
  vinaReferenceAudioB64?: string;
  vinaReferenceText?: string;
  vinaSpeakerSeed?: number;
  vinaStyleSeed?: number;
  vinaEngineUrl?: string;
}

/** YouTube anti low-quality / reused-content production gates */
export interface YoutubeSafeConfig {
  enforceEditorGate: boolean;
  applyLoudnorm: boolean;
  humanizeScript: boolean;
  lockSeriesVoice: boolean;
  requireHumanEdit: boolean;
  injectBreathPauses: boolean;
  roomTone: boolean;
  bgmMix: boolean;
  bgmPath: string;
  emotionTts: boolean;
  autoAudioReadability: boolean;
  enforceShotGraph: boolean;
  enforceAntiReuse: boolean;
  motionBudgetPct: number;
}

export interface ChapterHookAsset {
  /** Spoken cold-open ~30s (narration / VO) */
  hook: string;
  /** Short line for thumbnail text overlay */
  thumbnailLine: string;
  /** YouTube SEO title */
  seoTitle?: string;
  /** YouTube description body */
  seoDescription?: string;
  /** Tags / hashtags comma or space separated */
  seoTags?: string;
  /** English image prompt for thumbnail art */
  thumbnailPrompt?: string;
}

export interface HumanEditFlag {
  edited: boolean;
  at?: string;
  note?: string;
}

export interface NovelState {
  giai_doan: 1 | 2; // 1: Setup, 2: Workspace
  setup: SetupData;
  ten_tac_pham: string;
  dan_y_tong_the: string;
  nhan_vat: string[]; // H? so nh�n v?t tinh
  danh_sach_chuong: Chuong[];
  chuong_dang_chon: number; // 1-indexed
  tab_hien_tai: 'dan_y' | 'noi_dung';
  workspaceTab: 'script' | 'ainovel';
  dang_tai: boolean;
  apiKey: string;
  apiKeys: string[]; // M?ng ch?a nhi?u API Key d? xoay v�ng
  googleStudioCookie: string; // Cookie Google Studio cho c�c d�ng flow v� TTS t? d?ng
  googleStudioCookies: string[]; // M?ng nhi?u cookie cho da lu?ng
  isHydrated: boolean;

  // --- H? TH?NG LUU TR? GOOGLE DRIVE ---
  googleDrivePath: string; // �u?ng d?n thu m?c Google Drive Desktop c?c b? tr�n Windows
  googleDriveConnected: boolean; // Tr?ng th�i k?t n?i Google Drive
  googleLoggedIn: boolean; // Tr?ng th�i dang nh?p Google Drive Cloud
  googleUser: { name: string; email: string; avatar: string } | null; // Th�ng tin t�i kho?n ngu?i d�ng Google
  generatedAudioPaths: Record<string, { path: string; duration: number }>; // Qu?n l� audio d� sinh: { chapter_scene: { path, duration } }
  generatedPrompts: Record<string, PromptAsset[]>; // Qu?n l� prompts d� sinh theo th?i lu?ng: { chapter_scene: [{ timestamp, prompt }] }
  generatedPromptsAnalysis: Record<string, string>; // Ph�n t�ch k?ch b?n h�nh ?nh: { chapter_scene: markdown_string }
  generatedImages: Record<string, string>; // Qu?n l� ?nh d� sinh: { chapter_scene_prompt: path }
  generatedImageVariants: Record<string, string[]>; // Qu?n l� c�c bi?n th? ?nh d� sinh: { chapter_scene_prompt: [path] }
  generatedVideos: Record<string, string>; // Qu?n l� video d� sinh: { chapter_scene_prompt_video: path }
  
  savePathTTS: string; // Thu m?c luu audio ri�ng bi?t
  savePathImage: string; // Thu m?c luu ?nh ri�ng bi?t
  savePathCharacter: string; // Thu m?c luu ?nh nh�n v?t ri�ng bi?t
  savePathVideo: string; // Thu m?c luu video ri�ng bi?t
  projectUrls: Record<string, string>; // Qu?n l� link d? �n cho t?ng prompt: { chapter_scene_prompt: url }

  // --- H? TH?NG B? NH? 3 T?NG & PIPELINE STEPPER ---
  lorebook: string; // T?ng 1: L�i B?t Bi?n
  tom_tat_cuon_chieu: string; // T?ng 2: N�n du?i 500 t?
  tri_nho_ngan_han: string[]; // T?ng 3: T�m t?t c?c ng?n 3 chuong g?n nh?t
  pipeline_step: 'outline' | 'script' | 'commit'; // Stepper di?u hu?ng 3 bu?c
  nhan_vat_prompts: NhanVatPromptsMap;
  imageModel: string;
  videoModel: string;
  
  // --- H? TH?NG C?U H�NH �?U RA MEDIA ---
  aiMasterModel: string;
  aiMasterApiKey: string;
  visualDnaPrompt: string;
  mediaStylePreset: string;
  imageProvider: string;
  imageApiKey: string;
  imageAspectRatio: string;
  imageCount: number;
  videoProvider: string;
  videoApiKey: string;
  videoAspectRatio: string;
  videoDuration: number;
  wpm?: number;
  secondsPerBeat?: number;

  // --- H? TH?NG THUONG M?I H�A (VIP/PRO) ---
  is_vip: boolean;
  is_pro: boolean;
  credits: number;
  
  // --- H? TH?NG C?U H�NH GI?NG �?C TO�N C?C ---
  ttsConfig: TTSConfig;

  /** Multi-character Role Casting Studio (project-level) */
  voiceCast: ProjectVoiceCast;

  /** YouTube-safe production settings */
  youtubeSafe: YoutubeSafeConfig;
  /** Author human-pass flags per chapter */
  humanEditFlags: Record<number, HumanEditFlag>;
  /** Hook 0–8s + thumbnail line per chapter */
  chapterHooks: Record<number, ChapterHookAsset>;

  // --- H? TH?NG LU?T L? & CH?NG VAN PHONG AI ---
  userRules: {
    forbidden_words: string;
    fatigue_words: string;
  };

  // --- H? TH?NG �A AGENT (EDITOR & ARCHITECT) ---
  editorReviews: Record<number, {
    dimensions: { dimension: string; score: number; comment: string }[];
    verdict: 'accept' | 'rewrite' | 'polish';
    summary: string;
  }>;
  cung_hien_tai: number; // ��nh d?u Arc hi?n t?i

  // --- H? TH?NG LUU TR? TR?NG TH�I C?NG & CH?NG L?P ---
  da_dien_ra_entities: {
    dia_diem: string[];
    vat_pham: string[];
    motifs: string[];
  };
  world_state: {
    inventory: string[];
    discovered_clues: string[];
    current_location: string;
  };
  current_beat_type: string;

  /** Trạng thái commit bộ nhớ sau khi viết chương */
  memoryPipelineStatus: {
    status: 'idle' | 'pending' | 'ok' | 'failed';
    chapter?: number;
    message?: string;
  };

  // --- H? TH?NG API KEYS CHO T?NG NH� CUNG C?P ---
  openaiApiKey: string;
  openaiApiKeys: string[];
  grokApiKey: string;
  grokApiKeys: string[];
  lumaApiKey: string;
  lumaApiKeys: string[];
  runwayApiKey: string;
  runwayApiKeys: string[];
  falaiApiKey: string;
  falaiApiKeys: string[];
  useGpuAcceleration: boolean;
}

export interface NovelActions {
  setSetup: (data: Partial<SetupData>) => void;
  setGiaiDoan: (giai_doan: 1 | 2) => void;
  updateTenTacPham: (name: string) => void;
  updateDanYTongThe: (outline: string) => void;
  updateNhanVat: (chars: string[]) => void;
  /** Đổi tên nhân vật: hồ sơ + key ảnh + (tuỳ chọn) thay trong kịch bản/lore */
  renameNhanVat: (
    oldName: string,
    newName: string,
    options?: { replaceInText?: boolean },
  ) => { ok: true; newName: string } | { ok: false; error: string };
  updateSavePathTTS: (path: string) => void;
  updateSavePathImage: (path: string) => void;
  updateSavePathCharacter: (path: string) => void;
  updateSavePathVideo: (path: string) => void;
  addProjectUrl: (key: string, url: string) => void;
  setDanhSachChuong: (chapters: Chuong[]) => void;
  updateChuong: (so_chuong: number, update: Partial<Chuong>) => void;
  selectChuong: (so_chuong: number) => void;
  setTabHienTai: (tab: 'dan_y' | 'noi_dung') => void;
  setWorkspaceTab: (tab: 'script' | 'ainovel') => void;
  setDangTai: (loading: boolean) => void;
  setApiKey: (key: string) => void;
  setApiKeys: (keys: string[]) => void; // Action c?p nh?t danh s�ch nhi?u kh�a
  prioritizeApiKey: (key: string) => void;
  setGoogleStudioCookie: (cookie: string) => void; // Action c?p nh?t Cookie Google Studio
  addGoogleCookie: (cookie: string) => void; // Th�m 1 cookie m?i v�o m?ng
  removeGoogleCookie: (index: number) => void; // X�a cookie theo index
  setHydrated: (hydrated: boolean) => void;
  resetStore: () => void;

  // Actions cho luu tr? Google Drive & Assets
  updateGoogleDrivePath: (path: string) => void;
  setGoogleDriveConnected: (connected: boolean) => void;
  setGoogleLoggedIn: (loggedIn: boolean) => void;
  setGoogleUser: (user: { name: string; email: string; avatar: string } | null) => void;
  addGeneratedAudio: (key: string, path: string, duration: number) => void;
  addGeneratedPrompts: (key: string, prompts: PromptAsset[]) => void;
  addGeneratedPromptsAnalysis: (key: string, analysis: string) => void;
  addGeneratedImage: (key: string, path: string) => void;
  addGeneratedImageVariants: (key: string, paths: string[]) => void;
  addGeneratedVideo: (key: string, path: string) => void;

  // Actions m?i cho Stepper & B? nh? 3 t?ng
  setPipelineStep: (step: 'outline' | 'script' | 'commit') => void;
  updateLorebook: (lorebook: string) => void;
  updateTomTatCuonChieu: (summary: string) => void;
  updateTriNhoNganHan: (shortTerm: string[]) => void;
  updateNhanVatPrompt: (charName: string, data: Partial<NhanVatProfile>) => void;
  setImageModel: (model: string) => void;
  setVideoModel: (model: string) => void;

  setAiMasterModel: (model: string) => void;
  setAiMasterApiKey: (key: string) => void;
  setVisualDnaPrompt: (prompt: string) => void;
  setMediaStylePreset: (preset: string) => void;
  setImageProvider: (provider: string) => void;
  setImageApiKey: (key: string) => void;
  setImageAspectRatio: (ratio: string) => void;
  setImageCount: (count: number) => void;
  setVideoProvider: (provider: string) => void;
  setVideoApiKey: (key: string) => void;
  setVideoAspectRatio: (ratio: string) => void;
  setVideoDuration: (duration: number) => void;
  setWpm: (wpm: number) => void;
  setSecondsPerBeat: (secs: number) => void;

  // Actions cho Thuong m?i h�a (VIP/PRO)
  setVipStatus: (is_vip: boolean, is_pro: boolean) => void;
  setCredits: (credits: number) => void;
  deductCredits: (amount: number) => boolean;

  // C?u h�nh TTS To�n c?c
  updateTTSConfig: (config: Partial<TTSConfig>) => void;

  // Role Casting Studio
  setVoiceCast: (cast: ProjectVoiceCast) => void;
  updateVoiceCast: (partial: Partial<ProjectVoiceCast>) => void;
  upsertVoiceRole: (role: VoiceRole) => void;
  removeVoiceRole: (roleId: string) => void;
  setSegmentOverride: (
    segmentId: string,
    override: Partial<CastSegment> | null,
  ) => void;
  clearSegmentOverridesForScene: (chapter: number, sceneIndex: number) => void;
  ensureVoiceCastSeeded: () => void;
  setCharacterVoice: (characterName: string, voiceId: string) => void;
  /**
   * Gán profile USER clone vừa tạo vào:
   * - global TTS / narrator / 1 nhân vật + Role Cast
   */
  assignCloneProfile: (params: {
    profileName: string;
    refPath?: string;
    refText?: string;
    /** 'global' | 'narrator' | tên NV */
    target: string;
    speed?: number;
    pitch?: number;
    emotion?: string;
  }) => void;
  migrateCastVoicesForPlatform: (newPlatform: string, language?: string) => void;

  updateYoutubeSafe: (config: Partial<YoutubeSafeConfig>) => void;
  setHumanEditFlag: (chapter: number, flag: Partial<HumanEditFlag>) => void;
  setChapterHook: (chapter: number, hook: Partial<ChapterHookAsset>) => void;
  updateUserRules: (rules: Partial<NovelState['userRules']>) => void;
  updateEditorReview: (chapterIndex: number, review: NovelState['editorReviews'][number]) => void;
  setCungHienTai: (arc: number) => void;
  addChuongMoi: (chuongList: Chuong[]) => void; // Architect th�m chuong v�o cu?i

  // Actions c?p nh?t API Keys cho t?ng nh� cung c?p
  setOpenaiApiKey: (key: string) => void;
  setOpenaiApiKeys: (keys: string[]) => void;
  setGrokApiKey: (key: string) => void;
  setGrokApiKeys: (keys: string[]) => void;
  setLumaApiKey: (key: string) => void;
  setLumaApiKeys: (keys: string[]) => void;
  setRunwayApiKey: (key: string) => void;
  setRunwayApiKeys: (keys: string[]) => void;
  setFalaiApiKey: (key: string) => void;
  setFalaiApiKeys: (keys: string[]) => void;
  setUseGpuAcceleration: (use: boolean) => void;
  updateWorldState: (data: Partial<NovelState['world_state']>) => void;
  updateSpentEntities: (data: Partial<NovelState['da_dien_ra_entities']>) => void;
  setNextBeatType: (beat: string) => void;
  setMemoryPipelineStatus: (status: NovelState['memoryPipelineStatus']) => void;
  /** Xóa media/prompts gắn chương khi overwrite kịch bản */
  clearChapterMedia: (chapterNum: number) => void;
}

export type NovelStore = NovelState & NovelActions;

const INITIAL_SETUP: SetupData = {
  chu_de: 'Trinh Th�m',
  phong_cach: 'Vi?n Tu?ng',
  mo_ta: '',
  so_chuong: 2,
  so_tu_chuong: 4250,
  ngon_ngu: 'Ti?ng Vi?t',
};

const INITIAL_LOREBOOK = `?? L�I B?T BI?N (LOREBOOK) - K� ?C PHAI T�N: M?NG LU?I HU V�

1. TH? GI?I & C�NG NGH?:
- Neo-Veridia: �� th? tuong lai ng?p trong �nh d�n neon r?c r? v� nh?ng t�a nh� ch?c tr?i vuon t?i m�y. M?t x� h?i c� v? ngo�i ho�n h?o nhung th?c ch?t b? ki?m so�t ho�n to�n b?i k� ?c t?p th?.
- M?ng Lu?i Th?u C?m (Empathic Net): H? th?ng th?n kinh t?p th? s? h�a m?i k� ?c, tr?i nghi?m, v� c?m x�c c� nh�n. M?i ngu?i chia s? c?m x�c d? th?u hi?u l?n nhau tuy?t d?i, tri?t ti�u xung d?t x� h?i.
- M?t tr�i: S? ph? thu?c ho�n to�n v�o M?ng Lu?i bi?n k� ?c th�nh t�i s?n c�ng, x�a nh�a ranh gi?i c� nh�n v� tri?t ti�u s? ri�ng tu. K� ?c c� th? b? mua b�n, s?a d?i ho?c x�a b? ho�n to�n.

2. C�C KH�I NI?M QUAN TR?NG:
- V? �n "x�a b? hi?n th?c": Nh?ng hi?n tu?ng k? l? khi k� ?c v� l?ch s? c?a m?t c� nh�n, t?p th?, ho?c th?m ch� c? m?t khu ph? b? b�p m�o, ch?nh s?a ho?c bi?n m?t kh�ng d?u v?t kh?i M?ng Lu?i.
- Th? San K� ?c (Memory Hunter): Nh?ng th�m t? ki�m k? thu?t vi�n du?c c?p ph�p, c� kh? nang x�m nh?p s�u v�o M?ng Lu?i Th?u C?m ho?c tr?c ti?p v�o n�o b? d?i tu?ng d? truy v?t, ph?c h?i ho?c di?u tra c�c k� ?c b? d�nh c?p/x�a b?.

3. NH�N V?T CH�NH:
- Kh?i �ang: M?t Th? San K� ?c t�i nang nhung c� d?c. Anh c� qu� kh? b� ?n v� lu�n ho�i nghi v? s? ho�n h?o c?a M?ng Lu?i Th?u C?m. Kh?i �ang s? d?ng c�c thi?t b? gi?i m� k� ?c chuy�n nghi?p d? l?t m? nh?ng m?ng t?i c?a Neo-Veridia.`;

const INITIAL_STATE: NovelState = {
  giai_doan: 1,
  setup: INITIAL_SETUP,
  ten_tac_pham: 'K� ?c Phai T�n: M?ng Lu?i Hu V�',
  dan_y_tong_the: `# D�N � T?NG QUAN TRUY?N: K� ?C PHAI T�N: M?NG LU?I HU V�

## I. D�N � T?NG TH?

### 1. B?i c?nh th? gi?i: Th�nh ph? "Qu�n" v� M?ng Lu?i Th?u C?m
Trong m?t d� th? tuong lai mang t�n Neo-Veridia, noi nh?ng t�a nh� ch?c tr?i vuon t?i m�y v� �nh d�n neon l?p l�nh kh�ng ng?ng, cu?c s?ng du?c d?nh nghia b?i "M?ng Lu?i Th?u C?m" (Empathic Net). ��y kh�ng ch? l� m?t m?ng internet, m� l� m?t h? th?ng th?n kinh t?p th?, noi m?i k� ?c, tr?i nghi?m, v� c?m x�c c� nh�n du?c s? h�a, chia s? v� h?p nh?t th�nh m?t d�ng ch?y d? li?u kh?ng l?. M?c d�ch ban d?u l� t?o ra m?t x� h?i h�a b�nh, kh�ng xung d?t nh? s? d?ng c?m tuy?t d?i. Tuy nhi�n, s? ph? thu?c ho�n to�n v�o M?ng Lu?i d� bi?n k� ?c th�nh t�i s?n c�ng, v� s? ri�ng tu tr? th�nh m?t kh�i ni?m l?i th?i.

### 2. Nh�n v?t ch�nh
Kh?i �ang l� m?t "Th? San K� ?c" (Memory Hunter), m?t th�m t? ki�m k? thu?t vi�n du?c c?p ph�p d? di?u tra c�c v? �n "x�a b? hi?n th?c" - nh?ng s? ki?n m� qu� kh? c?a c? m?t khu ph?, m?t t?p th?, ho?c th?m ch� ch? m?t c� nh�n b? b�p m�o.

### 3. Di?n bi?n 2 chuong d?u m� ph?ng:
- **Chuong 1: K� ?c bi?n m?t**: Kh?i �ang nh?n m?t v? �n k? l? t?i khu ph? ? chu?t c?a Neo-Veridia, noi to�n b? cu d�n qu�n m?t s? t?n t?i c?a m?t c� g�i tr?. Anh ph?i k?t n?i tr?c ti?p v�o M?ng Lu?i Th?u C?m d? t�m l?i nh?ng m?nh v?n k� ?c b? x�a b?.
- **Chuong 2: L?n theo d?u v?t**: Kh?i �ang ph�t hi?n ra m?t l? h?ng b?o m?t ch?t ngu?i trong M?ng Lu?i Th?u C?m, cho ph�p m?t th? l?c ?n danh x�a s?ch s? t?n t?i c?a b?t k? ai. Anh b? truy du?i b?i c�c th?c th? b?o v? h? th?ng.`,
  nhan_vat: ['Kh?i �ang'],
  danh_sach_chuong: [
    {
      so_chuong: 1,
      tieu_de: 'Chuong 1: K� ?c bi?n m?t',
      dan_y: 'Kh?i �ang nh?n m?t v? �n k? l? t?i khu ph? ? chu?t c?a Neo-Veridia, noi to�n b? cu d�n qu�n m?t s? t?n t?i c?a m?t c� g�i tr?. Anh ph?i k?t n?i tr?c ti?p v�o M?ng Lu?i Th?u C?m d? t�m l?i nh?ng m?nh v?n k� ?c b? x�a b?.',
      noi_dung: '',
      trang_thai: 'empty'
    },
    {
      so_chuong: 2,
      tieu_de: 'Chuong 2: L?n theo d?u v?t',
      dan_y: 'Kh?i �ang ph�t hi?n ra m?t l? h?ng b?o m?t ch?t ngu?i trong M?ng Lu?i Th?u C?m, cho ph�p m?t th? l?c ?n danh x�a s?ch s? t?n t?i c?a b?t k? ai. Anh b? truy du?i b?i c�c th?c th? b?o v? h? th?ng.',
      noi_dung: '',
      trang_thai: 'empty'
    }
  ],
  chuong_dang_chon: 1,
  tab_hien_tai: 'dan_y',
  workspaceTab: 'script',
  dang_tai: false,
  apiKey: '',
  apiKeys: [], // M?ng kh�a tr?ng m?c d?nh
  openaiApiKey: '',
  openaiApiKeys: [],
  grokApiKey: '',
  grokApiKeys: [],
  lumaApiKey: '',
  lumaApiKeys: [],
  runwayApiKey: '',
  runwayApiKeys: [],
  falaiApiKey: '',
  falaiApiKeys: [],
  useGpuAcceleration: false,
  googleStudioCookie: '', // Kh?i t?o chu?i cookie r?ng
  googleStudioCookies: [], // M?ng cookie r?ng m?c d?nh
  isHydrated: false,

  // M?c d?nh luu tr? Google Drive
  googleDrivePath: '',
  googleDriveConnected: false,
  googleLoggedIn: false,
  googleUser: null,
  generatedAudioPaths: {},
  generatedPrompts: {},
  generatedPromptsAnalysis: {},
  generatedImages: {},
  generatedImageVariants: {},
  generatedVideos: {},
  
  savePathTTS: '',
  savePathImage: '',
  savePathCharacter: '',
  savePathVideo: '',
  projectUrls: {},

  // B? nh? 3 t?ng & Stepper
  lorebook: INITIAL_LOREBOOK,
  tom_tat_cuon_chieu: 'Chua c� t�m t?t c?t truy?n. H? th?ng s? t? d?ng n�n sau khi ho�n th�nh Chuong 1.',
  tri_nho_ngan_han: [],
  pipeline_step: 'outline',
  nhan_vat_prompts: {},
  imageModel: 'banana',
  videoModel: 'veo',
  
  aiMasterModel: 'aistudio',
  aiMasterApiKey: '',
  visualDnaPrompt: '',
  mediaStylePreset:
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials, varied shot scale (wide medium close insert), no generic quality tags, no stock-photo look',
  imageProvider: 'gemini',
  imageApiKey: '',
  imageAspectRatio: '16:9',
  imageCount: 1,
  videoProvider: 'veo',
  videoApiKey: '',
  videoAspectRatio: '16:9',
  videoDuration: 6,
  wpm: 140,
  secondsPerBeat: 6,

  // Thuong m?i h�a
  is_vip: false,
  is_pro: false,
  credits: 0,
  ttsConfig: {
    // Mặc định: VinaVoice / Clone Voice catalog
    platform: 'vina_voice',
    language: 'vi',
    voice: '',
    speed: 1.0,
    pitch: 0,
    tiktokSessionId: '',
    api_url_vieneu: 'https://api.vieneu.com/tts',
    syncMode: 'default',
    vinaUseClone: true,
    vinaGender: 'male',
    vinaArea: 'southern',
    vinaGroup: 'story',
    vinaEmotion: 'neutral',
    vinaSpeakerSeed: 2336,
    vinaStyleSeed: 4125,
  },
  voiceCast: { ...EMPTY_VOICE_CAST },
  youtubeSafe: {
    enforceEditorGate: true,
    applyLoudnorm: true,
    humanizeScript: true,
    lockSeriesVoice: true,
    requireHumanEdit: true,
    injectBreathPauses: true,
    roomTone: true,
    bgmMix: false,
    bgmPath: '',
    emotionTts: true,
    autoAudioReadability: true,
    enforceShotGraph: true,
    enforceAntiReuse: true,
    motionBudgetPct: 25,
  },
  humanEditFlags: {},
  chapterHooks: {},
  userRules: {
    forbidden_words:
      'đáng chú ý là, nhìn chung, có thể nói rằng, không thể phủ nhận, trong bối cảnh hiện nay, nói một cách dễ hiểu, tóm lại là, nói tóm lại',
    fatigue_words:
      'không khỏi, dường như, bất chợt, bỗng nhiên, ánh mắt sâu thẳm, trái tim thắt lại, không khí như đông đặc, trong tích tắc, lướt qua tâm trí, một cảm giác khó tả, ánh lên quyết tâm, nuốt nước bọt, siết chặt nắm đấm',
  },
  editorReviews: {},
  cung_hien_tai: 1,
  da_dien_ra_entities: {
    dia_diem: [],
    vat_pham: [],
    motifs: []
  },
  world_state: {
    inventory: [],
    discovered_clues: [],
    current_location: ''
  },
  current_beat_type: 'Beat A (Discovery)',
  memoryPipelineStatus: { status: 'idle' },
};

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      setSetup: (data) =>
        set((state) => {
          const newSetup = { ...state.setup, ...data };
          const generatedName = `${newSetup.chu_de} - ${newSetup.phong_cach}`;
          return {
            setup: newSetup,
            ten_tac_pham: state.giai_doan === 1 ? generatedName : state.ten_tac_pham,
          };
        }),

      setGiaiDoan: (giai_doan) => set({ giai_doan }),

      updateTenTacPham: (ten_tac_pham) => set({ ten_tac_pham }),

      updateDanYTongThe: (dan_y_tong_the) => set({ dan_y_tong_the }),

      updateNhanVat: (nhan_vat) => set({ nhan_vat }),

      renameNhanVat: (oldName, newName, options) => {
        const from = (oldName || '').trim();
        const to = (newName || '').trim().normalize('NFC');
        if (!from) return { ok: false as const, error: 'Tên cũ không hợp lệ.' };
        if (!to) return { ok: false as const, error: 'Tên mới không được để trống.' };
        if (from === to) return { ok: false as const, error: 'Tên mới trùng tên hiện tại.' };

        const state = get();
        if (!state.nhan_vat.includes(from)) {
          return { ok: false as const, error: `Không tìm thấy nhân vật "${from}".` };
        }
        if (state.nhan_vat.some((c) => c !== from && c === to)) {
          return { ok: false as const, error: `Tên "${to}" đã tồn tại trong hồ sơ.` };
        }

        const replaceInText = options?.replaceInText !== false;
        const swapText = (text: string | undefined | null) => {
          if (!text || !replaceInText) return text || '';
          return text.split(from).join(to);
        };

        const remapAssetKeys = <T,>(record: Record<string, T> | undefined): Record<string, T> => {
          const src = record || {};
          const out: Record<string, T> = {};
          const oldPrefix = `char_${from}`;
          const newPrefix = `char_${to}`;
          for (const [key, value] of Object.entries(src)) {
            if (key === oldPrefix || key.startsWith(`${oldPrefix}_`)) {
              out[`${newPrefix}${key.slice(oldPrefix.length)}`] = value;
            } else {
              out[key] = value;
            }
          }
          return out;
        };

        const prompts = { ...(state.nhan_vat_prompts || {}) };
        if (prompts[from] !== undefined) {
          prompts[to] = prompts[from];
          delete prompts[from];
        }

        const cast = normalizeVoiceCast(state.voiceCast);
        const oldRoleId = characterRoleId(from);
        const newRoleId = characterRoleId(to);
        const roles = cast.roles.map((r) => {
          if (r.kind === 'character' && (r.characterName === from || r.id === oldRoleId)) {
            return {
              ...r,
              id: newRoleId,
              characterName: to,
              label: r.label === from ? to : r.label,
              // sticky vinaRoleIndex kept
            };
          }
          return r;
        });
        const segmentOverrides = { ...cast.segmentOverrides };
        for (const [sid, ov] of Object.entries(segmentOverrides)) {
          if (ov.speakerRoleId === oldRoleId) {
            segmentOverrides[sid] = { ...ov, speakerRoleId: newRoleId };
          }
        }

        set({
          nhan_vat: state.nhan_vat.map((c) => (c === from ? to : c)),
          nhan_vat_prompts: prompts,
          voiceCast: normalizeVoiceCast({ ...cast, roles, segmentOverrides }),
          generatedImages: remapAssetKeys(state.generatedImages),
          generatedImageVariants: remapAssetKeys(state.generatedImageVariants),
          projectUrls: remapAssetKeys(state.projectUrls),
          dan_y_tong_the: swapText(state.dan_y_tong_the),
          lorebook: swapText(state.lorebook),
          tom_tat_cuon_chieu: swapText(state.tom_tat_cuon_chieu),
          tri_nho_ngan_han: (state.tri_nho_ngan_han || []).map((s) => swapText(s)),
          danh_sach_chuong: state.danh_sach_chuong.map((c) => ({
            ...c,
            tieu_de: swapText(c.tieu_de),
            dan_y: swapText(c.dan_y),
            noi_dung: swapText(c.noi_dung),
          })),
        });

        return { ok: true as const, newName: to };
      },

      setDanhSachChuong: (danh_sach_chuong) => set({ danh_sach_chuong }),

      updateChuong: (so_chuong, update) =>
        set((state) => ({
          danh_sach_chuong: state.danh_sach_chuong.map((c) =>
            c.so_chuong === so_chuong ? { ...c, ...update } : c
          ),
        })),

      selectChuong: (chuong_dang_chon) => set({ chuong_dang_chon }),

      setTabHienTai: (tab_hien_tai) => set({ tab_hien_tai }),
      setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),

      setDangTai: (dang_tai) => set({ dang_tai }),

      setApiKey: (apiKey) => set({ apiKey }),

      setApiKeys: (apiKeys) => set({ apiKeys }),

      setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),
      setOpenaiApiKeys: (openaiApiKeys) => set({ openaiApiKeys }),
      setGrokApiKey: (grokApiKey) => set({ grokApiKey }),
      setGrokApiKeys: (grokApiKeys) => set({ grokApiKeys }),
      setLumaApiKey: (lumaApiKey) => set({ lumaApiKey }),
      setLumaApiKeys: (lumaApiKeys) => set({ lumaApiKeys }),
      setRunwayApiKey: (runwayApiKey) => set({ runwayApiKey }),
      setRunwayApiKeys: (runwayApiKeys) => set({ runwayApiKeys }),
      setFalaiApiKey: (falaiApiKey) => set({ falaiApiKey }),
      setFalaiApiKeys: (falaiApiKeys) => set({ falaiApiKeys }),

      prioritizeApiKey: (apiKey: string) => set((state) => {
        if (!apiKey || !state.apiKeys.includes(apiKey)) return state;
        const keys = [apiKey, ...state.apiKeys.filter(k => k !== apiKey)];
        return { apiKeys: keys };
      }),

      setGoogleStudioCookie: (googleStudioCookie) => set({ googleStudioCookie }),

      addGoogleCookie: (cookie: string) => set((state) => ({
        googleStudioCookies: [...state.googleStudioCookies, cookie]
      })),

      removeGoogleCookie: (index: number) => set((state) => ({
        googleStudioCookies: state.googleStudioCookies.filter((_, i) => i !== index)
      })),

      setHydrated: (isHydrated) => set({ isHydrated }),

      resetStore: () => set((state) => ({
        ...INITIAL_STATE,
        isHydrated: true,
        apiKey: state.apiKey,
        apiKeys: state.apiKeys,
        openaiApiKey: state.openaiApiKey,
        openaiApiKeys: state.openaiApiKeys,
        grokApiKey: state.grokApiKey,
        grokApiKeys: state.grokApiKeys,
        lumaApiKey: state.lumaApiKey,
        lumaApiKeys: state.lumaApiKeys,
        runwayApiKey: state.runwayApiKey,
        runwayApiKeys: state.runwayApiKeys,
        falaiApiKey: state.falaiApiKey,
        falaiApiKeys: state.falaiApiKeys,
        googleStudioCookie: state.googleStudioCookie,
        googleStudioCookies: state.googleStudioCookies,
        googleDrivePath: state.googleDrivePath,
        googleDriveConnected: state.googleDriveConnected,
        googleLoggedIn: state.googleLoggedIn,
        googleUser: state.googleUser,
        generatedAudioPaths: state.generatedAudioPaths,
        generatedPrompts: state.generatedPrompts,
        generatedPromptsAnalysis: state.generatedPromptsAnalysis,
        generatedImages: state.generatedImages,
        generatedImageVariants: state.generatedImageVariants,
        generatedVideos: state.generatedVideos,
        nhan_vat_prompts: {}
      })),

      // Actions cho luu tr? Google Drive & Assets
      updateGoogleDrivePath: (googleDrivePath) => set({ googleDrivePath }),
      setGoogleDriveConnected: (googleDriveConnected) => set({ googleDriveConnected }),
      setGoogleLoggedIn: (googleLoggedIn) => set({ googleLoggedIn }),
      setGoogleUser: (googleUser) => set({ googleUser }),
      addGeneratedAudio: (key, path, duration) => set((state) => ({
        generatedAudioPaths: { ...state.generatedAudioPaths, [key]: { path, duration } }
      })),
      addGeneratedPrompts: (key, prompts) => set((state) => ({
        generatedPrompts: { ...state.generatedPrompts, [key]: prompts }
      })),
      addGeneratedPromptsAnalysis: (key, analysis) => set((state) => ({
        generatedPromptsAnalysis: { ...state.generatedPromptsAnalysis, [key]: analysis }
      })),
      addGeneratedImage: (key, path) => set((state) => ({
        generatedImages: { ...(state.generatedImages || {}), [key]: path }
      })),
      addGeneratedImageVariants: (key, paths) => set((state) => ({
        generatedImageVariants: { ...(state.generatedImageVariants || {}), [key]: paths }
      })),
      addGeneratedVideo: (key, path) => set((state) => ({
        generatedVideos: { ...(state.generatedVideos || {}), [key]: path }
      })),

      // Actions cho luu tr? ri�ng bi?t c?a t?ng m�-dun
      updateSavePathTTS: (savePathTTS) => set({ savePathTTS }),
      updateSavePathImage: (savePathImage) => set({ savePathImage }),
      updateSavePathCharacter: (savePathCharacter) => set({ savePathCharacter }),
      updateSavePathVideo: (savePathVideo) => set({ savePathVideo }),
      addProjectUrl: (key, url) => set((state) => ({
        projectUrls: { ...(state.projectUrls || {}), [key]: url }
      })),

      // Actions cho Stepper & B? nh? 3 t?ng
      setPipelineStep: (pipeline_step) => set({ pipeline_step }),
      updateLorebook: (lorebook) => set({ lorebook }),
      updateTomTatCuonChieu: (tom_tat_cuon_chieu) => set({ tom_tat_cuon_chieu }),
      updateTriNhoNganHan: (tri_nho_ngan_han) => set({ tri_nho_ngan_han }),
      updateNhanVatPrompt: (charName, data) => set((state) => {
        const current = state.nhan_vat_prompts || {};
        const oldVal = normalizeNhanVatProfile(current[charName] || emptyNhanVatProfile());
        const merged = normalizeNhanVatProfile({
          ...oldVal,
          ...data,
          angle_prompts: {
            ...(oldVal.angle_prompts || {}),
            ...(data.angle_prompts || {}),
          },
          expression_prompts: {
            ...(oldVal.expression_prompts || {}),
            ...(data.expression_prompts || {}),
          },
        });
        return {
          nhan_vat_prompts: {
            ...current,
            [charName]: merged,
          },
        };
      }),
      setImageModel: (model) => set({ imageModel: model }),
      setVideoModel: (model) => set({ videoModel: model }),

      setAiMasterModel: (model) => set({ aiMasterModel: model }),
      setAiMasterApiKey: (key) => set({ aiMasterApiKey: key }),
      setVisualDnaPrompt: (prompt) => set({ visualDnaPrompt: prompt }),
      setMediaStylePreset: (mediaStylePreset) => set({ mediaStylePreset }),
      setImageProvider: (imageProvider) => set({ imageProvider }),
      setImageApiKey: (imageApiKey) => set({ imageApiKey }),
      setImageAspectRatio: (imageAspectRatio) => set({ imageAspectRatio }),
      setImageCount: (imageCount) => set({ imageCount: Math.max(1, Math.min(4, Number(imageCount) || 1)) }),
      setVideoProvider: (videoProvider) => set({ videoProvider }),
      setVideoApiKey: (videoApiKey) => set({ videoApiKey }),
      setVideoAspectRatio: (videoAspectRatio) => set({ videoAspectRatio }),
      setVideoDuration: (videoDuration) => set({ videoDuration: Math.max(1, Math.min(15, Number(videoDuration) || 6)) }),
      setWpm: (wpm) => set({ wpm }),
      setSecondsPerBeat: (secondsPerBeat) => set({ secondsPerBeat }),
      // Actions cho Thuong m?i h�a (VIP/PRO)
      setVipStatus: (is_vip, is_pro) => set({ is_vip, is_pro }),
      setCredits: (credits) => set({ credits }),
      deductCredits: (amount) => {
        let success = false;
        set((state) => {
          if (state.is_vip || state.is_pro) {
            success = true; // VIP/Pro kh�ng b? gi?i h?n credit (ho?c c� gi?i h?n ri�ng)
            return state;
          }
          if (state.credits >= amount) {
            success = true;
            return { credits: state.credits - amount };
          }
          return state;
        });
        return success;
      },
      updateTTSConfig: (config) =>
        set((state) => {
          const next = { ...state.ttsConfig, ...config };
          const platformChanged =
            typeof config.platform === 'string' &&
            config.platform !== state.ttsConfig.platform;
          if (!platformChanged) return { ttsConfig: next };

          const language = next.language || state.ttsConfig.language || 'vi';
          const cast = normalizeVoiceCast(state.voiceCast);
          if (!cast.roles.length) return { ttsConfig: next };

          const roles = migrateRolesForPlatform(
            cast.roles,
            config.platform!,
            language,
            state.nhan_vat_prompts || {},
            next.voice || '',
          );
          // Dual-write character tts_voice from migrated roles
          const prompts = { ...(state.nhan_vat_prompts || {}) };
          for (const r of roles) {
            if (r.kind === 'character' && r.characterName) {
              const prev = normalizeNhanVatProfile(prompts[r.characterName]);
              prompts[r.characterName] = normalizeNhanVatProfile({
                ...prev,
                tts_voice: r.voiceId,
              });
            }
          }
          return {
            ttsConfig: next,
            voiceCast: normalizeVoiceCast({ ...cast, roles }),
            nhan_vat_prompts: prompts,
          };
        }),

      setVoiceCast: (cast) => set({ voiceCast: normalizeVoiceCast(cast) }),
      updateVoiceCast: (partial) =>
        set((state) => ({
          voiceCast: normalizeVoiceCast({
            ...normalizeVoiceCast(state.voiceCast),
            ...partial,
          }),
        })),
      upsertVoiceRole: (role) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          const idx = cast.roles.findIndex((r) => r.id === role.id);
          const roles = [...cast.roles];
          if (idx >= 0) roles[idx] = { ...roles[idx], ...role, id: role.id };
          else roles.push(role);
          return { voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: cast.enabled || roles.length > 0 }) };
        }),
      removeVoiceRole: (roleId) =>
        set((state) => {
          if (roleId === NARRATOR_ROLE_ID) return state;
          const cast = normalizeVoiceCast(state.voiceCast);
          const roles = cast.roles.filter((r) => r.id !== roleId);
          // sticky holes — do not renumber vinaRoleIndex
          const overrides = { ...cast.segmentOverrides };
          for (const [sid, ov] of Object.entries(overrides)) {
            if (ov.speakerRoleId === roleId) {
              overrides[sid] = { ...ov, speakerRoleId: NARRATOR_ROLE_ID };
            }
          }
          return {
            voiceCast: normalizeVoiceCast({
              ...cast,
              roles,
              segmentOverrides: overrides,
              enabled: cast.enabled && roles.length > 0,
            }),
          };
        }),
      setSegmentOverride: (segmentId, override) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          const segmentOverrides = { ...cast.segmentOverrides };
          if (override == null) delete segmentOverrides[segmentId];
          else {
            segmentOverrides[segmentId] = {
              ...(segmentOverrides[segmentId] || {}),
              ...override,
            };
          }
          return { voiceCast: normalizeVoiceCast({ ...cast, segmentOverrides }) };
        }),
      clearSegmentOverridesForScene: (chapter, sceneIndex) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          // Segment ids embed chapter|scene in hash input but not as prefix;
          // prune by matching overrides that reference scene via sceneTextHashes key only
          // MVP: clear all unlocked overrides when user requests scene clear
          const segmentOverrides = { ...cast.segmentOverrides };
          for (const [id, ov] of Object.entries(segmentOverrides)) {
            if (!ov.locked) delete segmentOverrides[id];
          }
          const sceneTextHashes = { ...(cast.sceneTextHashes || {}) };
          delete sceneTextHashes[`${chapter}_${sceneIndex}`];
          return {
            voiceCast: normalizeVoiceCast({
              ...cast,
              segmentOverrides,
              sceneTextHashes,
            }),
          };
        }),
      ensureVoiceCastSeeded: () =>
        set((state) => {
          const next = ensureSeededCast({
            nhan_vat: state.nhan_vat || [],
            nhan_vat_prompts: state.nhan_vat_prompts || {},
            ttsConfig: state.ttsConfig,
            voiceCast: state.voiceCast,
          });
          return { voiceCast: next };
        }),
      setCharacterVoice: (characterName, voiceId) =>
        set((state) => {
          const name = (characterName || '').trim().normalize('NFC');
          if (!name) return state;
          const platform = state.ttsConfig.platform || 'edge_tts';
          const prompts = { ...(state.nhan_vat_prompts || {}) };
          const prev = normalizeNhanVatProfile(prompts[name]);
          prompts[name] = normalizeNhanVatProfile({
            ...prev,
            tts_voice: voiceId,
          });

          const cast = normalizeVoiceCast(state.voiceCast);
          let roles = [...cast.roles];
          const existing = findRoleByCharacter(roles, name);
          if (existing) {
            roles = roles.map((r) =>
              r.id === existing.id
                ? {
                    ...r,
                    voiceId,
                    voicesByPlatform: {
                      ...(r.voicesByPlatform || {}),
                      [platform]: voiceId,
                    },
                  }
                : r,
            );
          } else if (roles.length > 0) {
            // seeded cast: upsert character role
            const nextIdx = maxVinaRoleIndex(roles) + 1;
            roles.push({
              id: characterRoleId(name),
              label: name,
              kind: 'character',
              characterName: name,
              voiceId,
              voicesByPlatform: { [platform]: voiceId },
              vinaRoleIndex: nextIdx,
            });
          }

          return {
            nhan_vat_prompts: prompts,
            voiceCast: roles.length
              ? normalizeVoiceCast({ ...cast, roles })
              : cast,
          };
        }),

      assignCloneProfile: (params) =>
        set((state) => {
          const profileName = (params.profileName || '').trim();
          if (!profileName) return state;
          const target = (params.target || 'global').trim().normalize('NFC');
          const platform = 'vina_voice' as const;
          const ttsConfig = {
            ...state.ttsConfig,
            platform,
            vinaUseClone: true as const,
            voice: profileName,
            ...(params.refPath
              ? { vinaReferenceAudio: params.refPath }
              : {}),
            ...(params.refText != null
              ? { vinaReferenceText: params.refText }
              : {}),
            ...(typeof params.speed === 'number' ? { speed: params.speed } : {}),
            ...(typeof params.pitch === 'number' ? { pitch: params.pitch } : {}),
          };

          // Seed cast nếu chưa có roles
          let cast = ensureSeededCast({
            nhan_vat: state.nhan_vat || [],
            nhan_vat_prompts: state.nhan_vat_prompts || {},
            ttsConfig,
            voiceCast: state.voiceCast,
          });
          cast = { ...cast, enabled: true };
          let roles = [...cast.roles];
          const prompts = { ...(state.nhan_vat_prompts || {}) };

          const patchRole = (
            role: VoiceRole,
            extra?: { speed?: number; pitch?: number; emotion?: string },
          ): VoiceRole => ({
            ...role,
            voiceId: profileName,
            voicesByPlatform: {
              ...(role.voicesByPlatform || {}),
              [platform]: profileName,
            },
            speed:
              typeof extra?.speed === 'number'
                ? extra.speed
                : typeof params.speed === 'number'
                  ? params.speed
                  : role.speed,
            pitch:
              typeof extra?.pitch === 'number'
                ? extra.pitch
                : typeof params.pitch === 'number'
                  ? params.pitch
                  : role.pitch,
            emotion: extra?.emotion ?? params.emotion ?? role.emotion,
          });

          if (target === 'global' || target === 'narrator' || target === '') {
            roles = roles.map((r) =>
              r.id === NARRATOR_ROLE_ID || r.kind === 'narrator'
                ? patchRole(r)
                : r,
            );
            // global: narrator + default tts voice
            return {
              ttsConfig,
              voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: true }),
            };
          }

          // Character target
          const name = target;
          const prev = normalizeNhanVatProfile(prompts[name]);
          prompts[name] = normalizeNhanVatProfile({
            ...prev,
            tts_voice: profileName,
          });

          // Prosody from quirk hồ sơ nếu chưa truyền
          let speed = params.speed;
          let pitch = params.pitch;
          let emotion = params.emotion;
          const pr = suggestProsodyFromProfile(prompts[name], {
            baseSpeed: ttsConfig.speed,
            basePitch: ttsConfig.pitch,
          });
          if (speed == null) speed = pr.speed;
          if (pitch == null) pitch = pr.pitch;
          if (!emotion) emotion = pr.emotion;

          const existing = findRoleByCharacter(roles, name);
          if (existing) {
            roles = roles.map((r) =>
              r.id === existing.id
                ? patchRole(r, { speed, pitch, emotion })
                : r,
            );
          } else {
            const nextIdx = maxVinaRoleIndex(roles) + 1;
            roles.push(
              patchRole(
                {
                  id: characterRoleId(name),
                  label: name,
                  kind: 'character',
                  characterName: name,
                  voiceId: profileName,
                  voicesByPlatform: { [platform]: profileName },
                  vinaRoleIndex: nextIdx,
                },
                { speed, pitch, emotion },
              ),
            );
          }

          return {
            ttsConfig,
            nhan_vat_prompts: prompts,
            voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: true }),
          };
        }),

      migrateCastVoicesForPlatform: (newPlatform, language) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          if (!cast.roles.length) return state;
          const lang = language || state.ttsConfig.language || 'vi';
          const roles = migrateRolesForPlatform(
            cast.roles,
            newPlatform,
            lang,
            state.nhan_vat_prompts || {},
            state.ttsConfig.voice || '',
            {
              baseSpeed: state.ttsConfig.speed,
              basePitch: state.ttsConfig.pitch,
            },
          );
          return { voiceCast: normalizeVoiceCast({ ...cast, roles }) };
        }),

      updateYoutubeSafe: (config) =>
        set((state) => ({
          youtubeSafe: mergeYoutubeSafeConfig({ ...(state.youtubeSafe || {}), ...config }),
        })),
      setHumanEditFlag: (chapter, flag) =>
        set((state) => {
          const prev = state.humanEditFlags?.[chapter] || { edited: false };
          return {
            humanEditFlags: {
              ...state.humanEditFlags,
              [chapter]: {
                ...prev,
                ...flag,
                at: flag.edited ? new Date().toISOString() : prev.at,
              },
            },
          };
        }),
      setChapterHook: (chapter, hook) =>
        set((state) => {
          const prev = state.chapterHooks?.[chapter] || {
            hook: '',
            thumbnailLine: '',
          };
          return {
            chapterHooks: {
              ...(state.chapterHooks || {}),
              [chapter]: { ...prev, ...hook },
            },
          };
        }),
      updateUserRules: (rules) => set((state) => ({ userRules: { ...state.userRules, ...rules } })),
      updateEditorReview: (chapterIndex, review) => set((state) => ({
        editorReviews: { ...state.editorReviews, [chapterIndex]: review }
      })),
      setCungHienTai: (arc) => set({ cung_hien_tai: arc }),
      addChuongMoi: (chuongList) => set((state) => ({ danh_sach_chuong: [...state.danh_sach_chuong, ...chuongList] })),
      setUseGpuAcceleration: (useGpuAcceleration) => set({ useGpuAcceleration }),
      updateWorldState: (data) => set((state) => ({ world_state: { ...state.world_state, ...data } })),
      updateSpentEntities: (data) => set((state) => ({
        da_dien_ra_entities: {
          dia_diem: Array.from(new Set([...state.da_dien_ra_entities.dia_diem, ...(data.dia_diem || [])])),
          vat_pham: Array.from(new Set([...state.da_dien_ra_entities.vat_pham, ...(data.vat_pham || [])])),
          motifs: Array.from(new Set([...state.da_dien_ra_entities.motifs, ...(data.motifs || [])]))
        }
      })),
      setNextBeatType: (current_beat_type) => set({ current_beat_type }),
      setMemoryPipelineStatus: (memoryPipelineStatus) => set({ memoryPipelineStatus }),
      clearChapterMedia: (chapterNum) =>
        set((state) => {
          const strip = <T,>(rec: Record<string, T> | undefined) =>
            filterOutChapterKeys(rec, chapterNum);
          const nextReviews = { ...state.editorReviews };
          delete nextReviews[chapterNum];
          return {
            generatedAudioPaths: strip(state.generatedAudioPaths),
            generatedPrompts: strip(state.generatedPrompts),
            generatedPromptsAnalysis: strip(state.generatedPromptsAnalysis),
            generatedImages: strip(state.generatedImages),
            generatedImageVariants: strip(state.generatedImageVariants),
            generatedVideos: strip(state.generatedVideos),
            projectUrls: strip(state.projectUrls),
            editorReviews: nextReviews,
          };
        }),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => dualStorage),
      version: 2,
      // Accept v0/v1 snapshots without discarding (critical — missing migrate drops all state)
      migrate: (persistedState, _fromVersion) => persistedState as NovelState,
      // Deep-ish merge: never drop nested config when partial older snapshots rehydrate
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<NovelState>;
        return {
          ...current,
          ...p,
          setup: { ...current.setup, ...(p.setup || {}) },
          ttsConfig: (() => {
            const merged = { ...current.ttsConfig, ...(p.ttsConfig || {}) };
            // One-time YouTube-safe upgrade: legacy mass-TTS default (tiktok + flat pitch)
            const isLegacyMassTts =
              merged.platform === 'tiktok_tts' &&
              (merged.voice === 'vocal_1' || !merged.voice) &&
              Number(merged.pitch || 0) === 0 &&
              Number(merged.speed || 1) === 1;
            if (isLegacyMassTts) {
              return {
                ...merged,
                platform: current.ttsConfig.platform,
                language: current.ttsConfig.language,
                voice: current.ttsConfig.voice,
                speed: current.ttsConfig.speed,
                pitch: current.ttsConfig.pitch,
              };
            }
            return merged;
          })(),
          youtubeSafe: mergeYoutubeSafeConfig({
            ...(current.youtubeSafe || {}),
            ...((p as { youtubeSafe?: Partial<YoutubeSafeConfig> }).youtubeSafe || {}),
          }),
          humanEditFlags: {
            ...(current.humanEditFlags || {}),
            ...((p as { humanEditFlags?: NovelState['humanEditFlags'] }).humanEditFlags || {}),
          },
          chapterHooks: {
            ...(current.chapterHooks || {}),
            ...((p as { chapterHooks?: NovelState['chapterHooks'] }).chapterHooks || {}),
          },
          userRules: {
            forbidden_words:
              (p.userRules?.forbidden_words || '').trim() || current.userRules.forbidden_words,
            fatigue_words:
              (p.userRules?.fatigue_words || '').trim() || current.userRules.fatigue_words,
          },
          world_state: { ...current.world_state, ...(p.world_state || {}) },
          da_dien_ra_entities: {
            dia_diem: p.da_dien_ra_entities?.dia_diem ?? current.da_dien_ra_entities.dia_diem,
            vat_pham: p.da_dien_ra_entities?.vat_pham ?? current.da_dien_ra_entities.vat_pham,
            motifs: p.da_dien_ra_entities?.motifs ?? current.da_dien_ra_entities.motifs,
          },
          generatedAudioPaths: { ...current.generatedAudioPaths, ...(p.generatedAudioPaths || {}) },
          generatedPrompts: { ...current.generatedPrompts, ...(p.generatedPrompts || {}) },
          generatedPromptsAnalysis: {
            ...current.generatedPromptsAnalysis,
            ...(p.generatedPromptsAnalysis || {}),
          },
          generatedImages: { ...current.generatedImages, ...(p.generatedImages || {}) },
          generatedImageVariants: {
            ...current.generatedImageVariants,
            ...(p.generatedImageVariants || {}),
          },
          generatedVideos: { ...current.generatedVideos, ...(p.generatedVideos || {}) },
          projectUrls: { ...current.projectUrls, ...(p.projectUrls || {}) },
          nhan_vat_prompts: { ...current.nhan_vat_prompts, ...(p.nhan_vat_prompts || {}) },
          voiceCast: normalizeVoiceCast(
            (p as { voiceCast?: ProjectVoiceCast }).voiceCast ?? current.voiceCast,
          ),
          editorReviews: { ...current.editorReviews, ...(p.editorReviews || {}) },
          // Prefer non-empty secret fields from either side
          apiKey: p.apiKey || current.apiKey,
          apiKeys:
            Array.isArray(p.apiKeys) && p.apiKeys.length ? p.apiKeys : current.apiKeys,
          openaiApiKey: p.openaiApiKey || current.openaiApiKey,
          openaiApiKeys:
            Array.isArray(p.openaiApiKeys) && p.openaiApiKeys.length
              ? p.openaiApiKeys
              : current.openaiApiKeys,
          grokApiKey: p.grokApiKey || current.grokApiKey,
          grokApiKeys:
            Array.isArray(p.grokApiKeys) && p.grokApiKeys.length
              ? p.grokApiKeys
              : current.grokApiKeys,
          lumaApiKey: p.lumaApiKey || current.lumaApiKey,
          lumaApiKeys:
            Array.isArray(p.lumaApiKeys) && p.lumaApiKeys.length
              ? p.lumaApiKeys
              : current.lumaApiKeys,
          runwayApiKey: p.runwayApiKey || current.runwayApiKey,
          runwayApiKeys:
            Array.isArray(p.runwayApiKeys) && p.runwayApiKeys.length
              ? p.runwayApiKeys
              : current.runwayApiKeys,
          falaiApiKey: p.falaiApiKey || current.falaiApiKey,
          falaiApiKeys:
            Array.isArray(p.falaiApiKeys) && p.falaiApiKeys.length
              ? p.falaiApiKeys
              : current.falaiApiKeys,
          imageApiKey: p.imageApiKey || current.imageApiKey,
          videoApiKey: p.videoApiKey || current.videoApiKey,
          aiMasterApiKey: p.aiMasterApiKey || current.aiMasterApiKey,
          googleStudioCookie: p.googleStudioCookie || current.googleStudioCookie,
          googleStudioCookies:
            Array.isArray(p.googleStudioCookies) && p.googleStudioCookies.length
              ? p.googleStudioCookies
              : current.googleStudioCookies,
          isHydrated: false,
        } as NovelStore;
      },
      partialize: (state) => ({
        giai_doan: state.giai_doan,
        setup: state.setup,
        ten_tac_pham: state.ten_tac_pham,
        dan_y_tong_the: state.dan_y_tong_the,
        nhan_vat: state.nhan_vat,
        danh_sach_chuong: state.danh_sach_chuong,
        chuong_dang_chon: state.chuong_dang_chon,
        tab_hien_tai: state.tab_hien_tai,
        apiKey: state.apiKey,
        apiKeys: state.apiKeys,
        openaiApiKey: state.openaiApiKey,
        openaiApiKeys: state.openaiApiKeys,
        grokApiKey: state.grokApiKey,
        grokApiKeys: state.grokApiKeys,
        lumaApiKey: state.lumaApiKey,
        lumaApiKeys: state.lumaApiKeys,
        runwayApiKey: state.runwayApiKey,
        runwayApiKeys: state.runwayApiKeys,
        falaiApiKey: state.falaiApiKey,
        falaiApiKeys: state.falaiApiKeys,
        googleStudioCookie: state.googleStudioCookie,
        googleStudioCookies: state.googleStudioCookies,
        googleDrivePath: state.googleDrivePath,
        googleDriveConnected: state.googleDriveConnected,
        googleLoggedIn: state.googleLoggedIn,
        googleUser: state.googleUser,
        generatedAudioPaths: state.generatedAudioPaths,
        generatedPrompts: state.generatedPrompts,
        generatedPromptsAnalysis: state.generatedPromptsAnalysis,
        generatedImages: state.generatedImages,
        generatedImageVariants: state.generatedImageVariants,
        generatedVideos: state.generatedVideos,

        workspaceTab: state.workspaceTab,
        savePathTTS: state.savePathTTS,
        savePathImage: state.savePathImage,
        savePathCharacter: state.savePathCharacter,
        savePathVideo: state.savePathVideo,
        projectUrls: state.projectUrls,

        lorebook: state.lorebook,
        tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
        tri_nho_ngan_han: state.tri_nho_ngan_han,
        pipeline_step: state.pipeline_step,
        nhan_vat_prompts: state.nhan_vat_prompts,
        imageModel: state.imageModel,
        videoModel: state.videoModel,
        imageProvider: state.imageProvider,
        imageApiKey: state.imageApiKey,
        videoProvider: state.videoProvider,
        videoApiKey: state.videoApiKey,

        is_vip: state.is_vip,
        is_pro: state.is_pro,
        credits: state.credits,
        ttsConfig: state.ttsConfig,
        voiceCast: state.voiceCast,
        youtubeSafe: state.youtubeSafe,
        humanEditFlags: state.humanEditFlags,
        chapterHooks: state.chapterHooks,
        useGpuAcceleration: state.useGpuAcceleration,

        aiMasterModel: state.aiMasterModel,
        aiMasterApiKey: state.aiMasterApiKey,
        visualDnaPrompt: state.visualDnaPrompt,
        mediaStylePreset: state.mediaStylePreset,
        imageAspectRatio: state.imageAspectRatio,
        imageCount: state.imageCount,
        videoAspectRatio: state.videoAspectRatio,
        videoDuration: state.videoDuration,
        wpm: state.wpm,
        secondsPerBeat: state.secondsPerBeat,
        userRules: state.userRules,
        editorReviews: state.editorReviews,
        cung_hien_tai: state.cung_hien_tai,
        da_dien_ra_entities: state.da_dien_ra_entities,
        world_state: state.world_state,
        current_beat_type: state.current_beat_type,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[NovelStore] Không thể nạp dữ liệu đã lưu:', error);
        }
        state?.setHydrated(true);
        // After rehydrate, force durable multi-path snapshot
        if (typeof window !== 'undefined') {
          try {
            const raw = window.localStorage.getItem(STORE_KEY);
            if (raw && scoreStoreRaw(raw) > 0) durableWrite(raw, { sync: true });
          } catch {
            // ignore
          }
        }
      },
    }
  )
);

// Safety: never leave UI stuck on "Đang nạp..." if async rehydrate hangs
if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const state = useNovelStore.getState();
      if (!state.isHydrated) {
        console.warn('[NovelStore] Ép isHydrated=true sau timeout rehydrate.');
        state.setHydrated(true);
      }
    } catch {
      // ignore
    }
  }, 4000);
}
