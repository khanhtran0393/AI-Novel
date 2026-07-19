import { defaultChannelsBootstrap } from '@/lib/channelModel';
import { EMPTY_VOICE_CAST } from '@/lib/voiceCast';
import type { NovelState, SetupData } from './novelTypes';

const INITIAL_SETUP: SetupData = {
  // Empty — user must pick Setup (B10: no silent mat-the default)
  chu_de: '',
  phong_cach: '',
  mo_ta: '',
  so_chuong: 2,
  so_tu_chuong: 4250,
  ngon_ngu: 'Tiếng Việt',
};

/** Production rules only — world laws come from Setup + user lore (B10: no mat-the world seed). */
const INITIAL_LOREBOOK = `# LOREBOOK — Lõi Bất Biến (khung sản xuất)

## 1. Quy luật thế giới
- (Chưa nạp) Điền theo Setup Chủ đề + Phong cách, hoặc dán lore khi Kế thừa di sản / Sinh dàn ý.
- Mọi quy luật siêu nhiên/công nghệ (nếu có) phải có giới hạn và cái giá đi kèm — do user/Setup quyết, không ép mạt thế.

## 2. Nguyên tắc kể chuyện
- Real-time pacing: cấm time-skip tóm tắt tuần/tháng.
- Nhân vật PHẢI có khuyết điểm (điểm yếu tính cách, thói xấu, nỗi sợ, hạn chế xã hội/tâm lý — không bắt buộc "khuyết tật mạt thế").
- Tên nhân vật: Hán Việt sắc sảo, tránh tên mòn (Lâm Khuyết, …).

## 3. Ghi chú sản xuất
- Kịch bản chia tối thiểu 3 phân cảnh dạng [CẢNH X: NỘI/NGOẠI CẢNH. ĐỊA ĐIỂM - THỜI GIAN].
- Ưu tiên hành động + thoại; miêu tả giác quan có chọn lọc.`;

export const INITIAL_STATE: NovelState = {
  /** Workspace by default — Setup opens only via Sidebar (avoids stuck modal on boot). */
  giai_doan: 2,
  setup: INITIAL_SETUP,
  ten_tac_pham: 'Dự án mới',
  dan_y_tong_the: '',
  nhan_vat: [],
  danh_sach_chuong: [
    {
      so_chuong: 1,
      tieu_de: 'Chương 1',
      dan_y: '',
      noi_dung: '',
      trang_thai: 'empty',
    },
    {
      so_chuong: 2,
      tieu_de: 'Chương 2',
      dan_y: '',
      noi_dung: '',
      trang_thai: 'empty',
    },
  ],
  chuong_dang_chon: 1,
  projectResetEpoch: 0,
  tab_hien_tai: 'dan_y',
  workspaceTab: 'script',
  dang_tai: false,
  apiKey: '',
  apiKeys: [],
  openaiApiKey: '',
  openaiApiKeys: [],
  grokApiKey: '',
  grokApiKeys: [],
  claudeApiKey: '',
  claudeApiKeys: [],
  lumaApiKey: '',
  lumaApiKeys: [],
  runwayApiKey: '',
  runwayApiKeys: [],
  falaiApiKey: '',
  falaiApiKeys: [],
  useGpuAcceleration: false,
  googleStudioCookie: '',
  googleStudioCookies: [],
  tiktokSessionIds: [],
  /** true ngay từ đầu — cấm kẹt màn "Đang nạp trạng thái bộ nhớ" (rehydrate chạy nền). */
  isHydrated: true,

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
  generatedAssetDna: {},

  savePathTTS: '',
  savePathImage: '',
  savePathCharacter: '',
  savePathVideo: '',
  projectUrls: {},

  lorebook: INITIAL_LOREBOOK,
  tom_tat_cuon_chieu: 'Chưa có tóm tắt cốt truyện. Hệ thống sẽ tự động nén sau khi hoàn thành Chương 1.',
  tri_nho_ngan_han: [],
  pipeline_step: 'outline',
  nhan_vat_prompts: {},
  imageModel: 'GEM_PIX_2',
  /** FlowAgent parity: model key resolves to abra_t2v_{4|6|8}s by duration. */
  videoModel: 'OMNI_FLASH',

  aiMasterModel: 'aistudio',
  aiMasterApiKey: '',
  visualDnaPrompt: '',
  mediaStylePreset:
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials, varied shot scale (wide medium close insert), no generic quality tags, no stock-photo look',
  imageProvider: 'flow',
  imageApiKey: '',
  imageAspectRatio: '16:9',
  imageCount: 1,
  videoProvider: 'flow',
  videoApiKey: '',
  videoAspectRatio: '16:9',
  /** Flow Veo clip length: 4 | 6 | 8 (default 8s matches labs.google) */
  videoDuration: 8,
  wpm: 140,
  secondsPerBeat: 6,

  // Commercial default = Free. Dev open / owner sync may promote to Pro on boot.
  is_vip: false,
  is_pro: false,
  is_trial: false,
  credits: 100,
  ttsConfig: {
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
  setupKind: 'classic',
  youtubeRewriteUrl: '',
  youtubeSourceTitle: '',
  youtubeSourceText: '',
  youtubeSimilarityTarget: 80,
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
    motifs: [],
  },
  world_state: {
    inventory: [],
    discovered_clues: [],
    current_location: '',
  },
  current_beat_type: 'Beat A (Discovery)',
  memoryPipelineStatus: { status: 'idle' },
  ...defaultChannelsBootstrap(),
};

/**
 * LOCKED — Điểm reset nút **Làm Mới Dự Án**.
 * Spec đầy đủ: `docs/RESET_POINT.md` · `MEMORY.md`
 *
 * WIPED (trống): tên, lorebook, danh sách chương, dàn ý, NV, media gen, YT source.
 * KEPT: do `resetStore()` merge lại từ state hiện tại (keys + mọi cài đặt).
 */
export const PROJECT_RESET_POINT = {
  ten_tac_pham: '',
  lorebook: '',
  danh_sach_chuong: [] as NovelState['danh_sach_chuong'],
  chuong_dang_chon: 0,
  dan_y_tong_the: '',
  nhan_vat: [] as string[],
  /** UI fallback khi lorebook === '' */
  lorebookEmptyLabel: 'Chưa có Lorebook.',
} as const;

/**
 * Blank project canvas for "Làm Mới Dự Án" (deep-clone, no shared nested refs).
 * Settings/credentials are re-applied by `resetStore()` from live state.
 */
export function cloneFreshProjectState(): NovelState {
  const channelsBoot = defaultChannelsBootstrap();
  return {
    ...INITIAL_STATE,
    setup: { ...INITIAL_SETUP, mo_ta: '', so_chuong: 0 },
    // === PROJECT_RESET_POINT (blank canvas) ===
    ten_tac_pham: PROJECT_RESET_POINT.ten_tac_pham,
    lorebook: PROJECT_RESET_POINT.lorebook,
    danh_sach_chuong: [],
    chuong_dang_chon: PROJECT_RESET_POINT.chuong_dang_chon,
    projectResetEpoch: 0, // set to Date.now() in resetStore
    dan_y_tong_the: PROJECT_RESET_POINT.dan_y_tong_the,
    nhan_vat: [],
    tab_hien_tai: 'dan_y',
    workspaceTab: 'script',
    dang_tai: false,
    tom_tat_cuon_chieu: '',
    tri_nho_ngan_han: [],
    pipeline_step: 'outline',
    nhan_vat_prompts: {},
    generatedAudioPaths: {},
    generatedPrompts: {},
    generatedPromptsAnalysis: {},
    generatedImages: {},
    generatedImageVariants: {},
    generatedVideos: {},
    generatedAssetDna: {},
    projectUrls: {},
    humanEditFlags: {},
    chapterHooks: {},
    editorReviews: {},
    setupKind: 'classic',
    youtubeRewriteUrl: '',
    youtubeSourceTitle: '',
    youtubeSourceText: '',
    youtubeSimilarityTarget: 80,
    // Placeholders — overwrite by resetStore with live settings
    userRules: {
      forbidden_words: INITIAL_STATE.userRules.forbidden_words,
      fatigue_words: INITIAL_STATE.userRules.fatigue_words,
    },
    cung_hien_tai: 1,
    da_dien_ra_entities: {
      dia_diem: [],
      vat_pham: [],
      motifs: [],
    },
    world_state: {
      inventory: [],
      discovered_clues: [],
      current_location: '',
    },
    current_beat_type: 'Beat A (Discovery)',
    memoryPipelineStatus: { status: 'idle' },
    voiceCast: { ...EMPTY_VOICE_CAST },
    youtubeSafe: { ...INITIAL_STATE.youtubeSafe },
    ttsConfig: { ...INITIAL_STATE.ttsConfig },
    activeChannelId: channelsBoot.activeChannelId,
    channels: channelsBoot.channels,
  };
}
