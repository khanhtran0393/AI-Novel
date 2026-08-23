import type {
  NhanVatProfile,
  NhanVatPromptsMap,
} from '@/lib/characterProfile';
import type {
  CastSegment,
  ProjectVoiceCast,
  VoiceRole,
} from '@/lib/voiceCast';
import type {
  ChannelProfile,
  ShipMode,
} from '@/lib/channelModel';
import type { SceneLocationAsset } from '@/lib/sceneLocationLibrary';
import type { AiMasterProvider } from '@/contracts';

export type { NhanVatProfile, NhanVatPromptsMap, ProjectVoiceCast, VoiceRole };
export type { ChannelProfile, ShipMode };
export type { SceneLocationAsset };

export interface PromptAsset {
  timestamp: string;
  prompt: string;
  sentence?: string;
  script_prompt?: string;
  image_prompt?: string;
  video_prompt?: string;
  emotion?: string;
  /**
   * Optional first+last frame mode (Printfilm-style keyframe).
   * When true, video gen uses start still + end still; duration still from TTS/timestamp.
   */
  use_end_frame?: boolean;
  /**
   * Image asset key for end frame (e.g. `3_2_1`). Empty → resolve to adjacent prompt still.
   */
  end_image_key?: string;
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
  so_tu_chuong?: number; // So luong tu muc tieu moi chuong (mac dinh 4250)
  ngon_ngu?: string; // Ngon ngu muon viet (mac dinh Tieng Viet)
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
    | 'vina_voice'
    | 'la_studio'
    | 'vbee'
    | 'google'
    | 'elevenlabs';
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
  /** LA Studio local API (http://127.0.0.1:3900) */
  laStudioBaseUrl?: string;
  laStudioApiKey?: string;
  laStudioModel?: string;
  /** LA Studio family id (kokoro-vietnamese, vieneu-tts-v3-turbo, …) */
  laStudioFamily?: string;
  /** Google Cloud TTS API key (bắt buộc nếu platform=google — không mẫu Edge ngầm) */
  googleCloudApiKey?: string;
  /** Legacy VBee fields (platform đã gỡ — không dùng) */
  vbeeApiKey?: string;
  vbeeAppId?: string;
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
  /** Short line for thumbnail text overlay (2–4 words preferred) */
  thumbnailLine: string;
  /** YouTube SEO title */
  seoTitle?: string;
  /**
   * High-CTR: 5 psychological title formula variants (UI pick).
   * Stored so Meta/regenerate can re-surface without recomputing seed drift.
   */
  seoTitleVariants?: Array<{ id: string; labelVi: string; title: string }>;
  /** YouTube description body */
  seoDescription?: string;
  /** Tags / hashtags comma or space separated */
  seoTags?: string;
  /**
   * High-CTR thumbnail composition preset id:
   * split_before_after | hologram_ui | scale_goliath | emotion_zoom
   */
  thumbCompositionId?: string;
  /** English image prompt for thumbnail art */
  thumbnailPrompt?: string;
  /**
   * Optional EN prompt for YouTube end-screen still (~5s):
   * next-ep tease + subscribe/playlist frames (user-triggered gen only).
   */
  endScreenPrompt?: string;
  /** Local path (or cache-busted URL) of generated thumbnail still */
  thumbnailImagePath?: string;
  /**
   * Visual DNA extracted from competitor thumbnail(s).
   * Used at gen-time to mimic layout/style while keeping thumbnailPrompt content.
   */
  competitorThumbDna?: string;
  /** Data-URL or local path preview of the uploaded competitor thumbnail */
  competitorThumbPreview?: string;
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
  /**
   * Epoch (ms) set by "Làm Mới Dự Án". Hydrate prefers higher epoch over richer content
   * so blank canvas is not overwritten by old durable backups.
   */
  projectResetEpoch: number;
  tab_hien_tai: 'dan_y' | 'noi_dung';
  workspaceTab: 'script' | 'ainovel';
  dang_tai: boolean;
  apiKey: string;
  apiKeys: string[]; // M?ng ch?a nhi?u API Key d? xoay v�ng
  googleStudioCookie: string; // Cookie Google Studio cho c�c d�ng flow v� TTS t? d?ng
  googleStudioCookies: string[]; // M?ng nhi?u cookie cho da lu?ng
  /** Nhiều sessionid TikTok TTS (xoay vòng giống multi cookie / API keys) */
  tiktokSessionIds: string[];
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
  /** DNA stamp khi gen (platform/ratio) — so với toolbar Ảnh/Video · TTS lúc Ship */
  generatedAssetDna: Record<string, import('@/lib/mediaDnaMatch').MediaAssetDnaStamp>;
  
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
  /**
   * Scene / location concept library (Printfilm P1) — reusable environment refs.
   * Images under generatedImages[sceneLocationImageKey(name)].
   */
  scene_location_assets: SceneLocationAsset[];
  imageModel: string;
  videoModel: string;
  
  // --- H? TH?NG C?U H�NH �?U RA MEDIA ---
  aiMasterProvider: AiMasterProvider;
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
  /**
   * Optional base URL for external video API (HeyGen/custom).
   * Empty → catalog default for provider.
   */
  videoApiBaseUrl: string;
  /**
   * Saved external video API entries (auto-detected or manual).
   * Active selection drives videoProvider + videoApiKey when used.
   */
  externalVideoApis: import('@/lib/video-api').ExternalVideoApiEntry[];
  /** Active external video API id (optional) */
  activeExternalVideoApiId: string;
  videoAspectRatio: string;
  videoDuration: number;
  wpm?: number;
  secondsPerBeat?: number;

  // --- Hệ thống thương mại (FREE/TRIAL/PRO) ---
  /** Chỉ để đọc snapshot/token cũ; UI và token mới luôn ghi false. */
  is_vip: boolean;
  is_pro: boolean;
  /** Trial 7 ngày: mở quyền Pro-equivalent; badge UI = TRIAL (không gộp nhầm PRO trả phí) */
  is_trial: boolean;
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

  /**
   * Setup panel: classic (chủ đề/phong cách) | youtube (link + % trùng mục tiêu).
   * Chỉ có nghĩa khi giai_doan === 1.
   */
  setupKind: 'classic' | 'youtube';
  /** Link + nguồn chép lời / mô tả để viết lại tương tự */
  youtubeRewriteUrl: string;
  youtubeSourceTitle: string;
  youtubeSourceText: string;
  /**
   * % trùng lặp MỤC TIÊU với ý tưởng mẫu (mặc định 80).
   * AI viết lại kịch bản mới nhưng bám cốt truyện mẫu theo mức này.
   */
  youtubeSimilarityTarget: number;

  /**
   * Phong cách kịch bản:
   * chuyen_sau | sang_van | short_manhua (Printfilm short/manhua craft)
   */
  scriptMode: import('@/lib/scriptMode').ScriptMode;

  /**
   * Style Engine Profile id khi Setup khớp 1/5 niche hot (Tu Tiên, Đô Thị…).
   * null = không khớp — không ép genre default.
   */
  activeStyleEngineId: import('@/lib/styleEngineProfiles').StyleEngineId | null;

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

  // --- MULTI-CHANNEL (1 story graph → nhiều kênh DNA + ship) ---
  activeChannelId: string;
  channels: Record<string, ChannelProfile>;

  // --- H? TH?NG API KEYS CHO T?NG NH� CUNG C?P ---
  openaiApiKey: string;
  openaiApiKeys: string[];
  grokApiKey: string;
  grokApiKeys: string[];
  claudeApiKey: string;
  claudeApiKeys: string[];
  lumaApiKey: string;
  lumaApiKeys: string[];
  runwayApiKey: string;
  runwayApiKeys: string[];
  falaiApiKey: string;
  falaiApiKeys: string[];
  customApiBaseUrl?: string;
  customApiModel?: string;
  customApiProtocol?: 'openai' | 'gemini';
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
  addTikTokSession: (sessionId: string) => void;
  removeTikTokSession: (index: number) => void;
  setTikTokSessionIds: (ids: string[]) => void;
  setHydrated: (hydrated: boolean) => void;
  resetStore: () => void;
  /**
   * Factory wipe: canvas + keys + GPU/NVENC + TTS/media settings → INITIAL.
   * Keeps commercial plan only (is_pro / is_trial / is_vip / credits).
   */
  factoryResetKeepPlan: () => void;

  // Actions cho luu tr? Google Drive & Assets
  updateGoogleDrivePath: (path: string) => void;
  setGoogleDriveConnected: (connected: boolean) => void;
  setGoogleLoggedIn: (loggedIn: boolean) => void;
  setGoogleUser: (user: { name: string; email: string; avatar: string } | null) => void;
  addGeneratedAudio: (key: string, path: string, duration: number) => void;
  addGeneratedPrompts: (key: string, prompts: PromptAsset[]) => void;
  /** Patch one prompt slot (e.g. use_end_frame / end_image_key) without rewriting list */
  patchGeneratedPrompt: (
    sceneKey: string,
    promptIndex: number,
    patch: Partial<PromptAsset>,
  ) => void;
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
  /** Replace full scene location library */
  setSceneLocationAssets: (items: SceneLocationAsset[]) => void;
  /** Upsert one location by id (or append if new) */
  upsertSceneLocationAsset: (item: SceneLocationAsset) => void;
  removeSceneLocationAsset: (id: string) => void;
  setImageModel: (
    model: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setVideoModel: (
    model: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;

  setAiMasterProvider: (provider: AiMasterProvider) => void;
  setAiMasterModel: (model: string) => void;
  setAiMasterApiKey: (key: string) => void;
  setVisualDnaPrompt: (prompt: string) => void;
  setMediaStylePreset: (
    preset: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setImageProvider: (
    provider: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setImageApiKey: (key: string) => void;
  setImageAspectRatio: (
    ratio: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setImageCount: (
    count: number,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setVideoProvider: (
    provider: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setVideoApiKey: (key: string) => void;
  setVideoApiBaseUrl: (url: string) => void;
  setExternalVideoApis: (
    entries: import('@/lib/video-api').ExternalVideoApiEntry[],
  ) => void;
  upsertExternalVideoApi: (
    entry: import('@/lib/video-api').ExternalVideoApiEntry,
  ) => void;
  removeExternalVideoApi: (id: string) => void;
  setActiveExternalVideoApiId: (id: string) => void;
  /** Apply a saved external API as active video provider + key */
  applyExternalVideoApi: (id: string) => void;
  setVideoAspectRatio: (
    ratio: string,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setVideoDuration: (
    duration: number,
    opts?: { mirrorChannel?: boolean },
  ) => void;
  setWpm: (wpm: number) => void;
  setSecondsPerBeat: (secs: number) => void;
  /**
   * Drop store media keys whose files are missing on disk (ghost paths).
   * Returns counts for UI toast.
   */
  reconcileMissingMediaAssets: (options?: {
    discoverChapterNum?: number;
    discoverSceneIndices?: number[];
  }) => Promise<{
    changed: boolean;
    removedAudio: number;
    removedImage: number;
    removedVideo: number;
    addedAudio: number;
    addedImage: number;
    addedVideo: number;
    summary: string;
  }>;

  // Actions cho thương mại (FREE/TRIAL/PRO)
  /** is_vip là tham số tương thích dữ liệu cũ; code mới luôn truyền false. */
  setVipStatus: (is_vip: boolean, is_pro: boolean, is_trial?: boolean) => void;
  setCredits: (credits: number) => void;
  deductCredits: (amount: number) => boolean;

  // C?u h�nh TTS To�n c?c — mirrorChannel mặc định true; self-heal truyền false
  updateTTSConfig: (
    config: Partial<TTSConfig>,
    opts?: { mirrorChannel?: boolean },
  ) => void;

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
  setSetupKind: (kind: 'classic' | 'youtube') => void;
  setYoutubeRewrite: (data: {
    url?: string;
    sourceTitle?: string;
    sourceText?: string;
    similarityTarget?: number;
  }) => void;
  setScriptMode: (mode: import('@/lib/scriptMode').ScriptMode) => void;
  updateUserRules: (rules: Partial<NovelState['userRules']>) => void;
  updateEditorReview: (chapterIndex: number, review: NovelState['editorReviews'][number]) => void;
  /** User hủy banner/nút sửa — giữ điểm review, verdict → accept (bỏ chặn TTS/gate) */
  dismissEditorReview: (chapterIndex: number) => void;
  /** Xóa hẳn review chương (panel + banner biến mất) */
  clearEditorReview: (chapterIndex: number) => void;
  setCungHienTai: (arc: number) => void;
  addChuongMoi: (chuongList: Chuong[]) => void; // Architect th�m chuong v�o cu?i

  // Actions c?p nh?t API Keys cho t?ng nh� cung c?p
  setOpenaiApiKey: (key: string) => void;
  setOpenaiApiKeys: (keys: string[]) => void;
  setGrokApiKey: (key: string) => void;
  setGrokApiKeys: (keys: string[]) => void;
  setClaudeApiKey: (key: string) => void;
  setClaudeApiKeys: (keys: string[]) => void;
  setLumaApiKey: (key: string) => void;
  setLumaApiKeys: (keys: string[]) => void;
  setRunwayApiKey: (key: string) => void;
  setRunwayApiKeys: (keys: string[]) => void;
  setFalaiApiKey: (key: string) => void;
  setFalaiApiKeys: (keys: string[]) => void;
  setCustomApiBaseUrl: (url: string) => void;
  setCustomApiModel: (model: string) => void;
  setCustomApiProtocol: (protocol: 'openai' | 'gemini') => void;
  setUseGpuAcceleration: (use: boolean) => void;
  updateWorldState: (data: Partial<NovelState['world_state']>) => void;
  updateSpentEntities: (data: Partial<NovelState['da_dien_ra_entities']>) => void;
  setNextBeatType: (beat: string) => void;
  setMemoryPipelineStatus: (status: NovelState['memoryPipelineStatus']) => void;
  /** Xóa media/prompts gắn chương khi overwrite kịch bản */
  clearChapterMedia: (chapterNum: number) => void;

  // Multi-channel
  /** Snapshot workspace hiện tại vào kênh đang active */
  saveActiveChannelSnapshot: () => void;
  /** Tạo kênh mới; cloneFromActive = copy workspace hiện tại */
  createChannel: (
    name: string,
    opts?: { cloneFromActive?: boolean; partial?: Partial<ChannelProfile> },
  ) => string;
  /** Chuyển kênh: lưu snapshot cũ → nạp workspace kênh mới + DNA */
  switchChannel: (channelId: string) => { ok: true } | { ok: false; error: string };
  updateChannel: (channelId: string, partial: Partial<ChannelProfile>) => void;
  deleteChannel: (channelId: string) => { ok: true } | { ok: false; error: string };
  setDefaultShipMode: (mode: ShipMode) => void;
  rememberChannelMotif: (
    kind: 'motif' | 'hook' | 'thumb',
    value: string,
  ) => void;
  /** Áp DNA kênh active lên TTS / aspect / visual (không đổi story content) */
  applyActiveChannelDna: () => void;
  getActiveChannel: () => ChannelProfile | null;
}

export type NovelStore = NovelState & NovelActions;
