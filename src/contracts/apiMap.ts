/**
 * API ownership map — "cần HTTP thì gọi đúng module/endpoint này".
 * Client code should prefer these constants over raw '/api/...' strings when adding calls.
 */

export const API = {
  /** Story / outline / chapter / memory / character prompts (LLM) */
  generate: '/api/generate',
  /** Image generation (flow / openai / grok / gemini-whisk) */
  generateImage: '/api/generate-image',
  /** Google Flow bridge (extension + multi-account queue) */
  flowStatus: '/api/flow/status',
  flowAccounts: '/api/flow/accounts',
  flowProxy: '/api/flow/proxy',
  flowQueue: '/api/flow/queue',
  flowConnect: '/api/flow/connect',
  flowBootstrap: '/api/flow/bootstrap',
  flowBrowsers: '/api/flow/browsers',
  /** One-click portable Chromium for non-technical users */
  flowInstallBrowser: '/api/flow/install-browser',
  /** Select / create Google Flow project (dropdown) */
  flowProjects: '/api/flow/projects',
  flowGenerateOne: '/api/flow/generate-one',
  /** Flow model matrix + credit estimates (P0) */
  flowModels: '/api/flow/models',
  /** Flow ops: agent instructions, quality, farm policy (P2/P3) */
  flowOps: '/api/flow/ops',
  /** In-app Flow Agent plan/chat/enqueue (P2) */
  flowAgent: '/api/flow/agent',
  /** Flow mediaId index for Extend (B) */
  flowMediaId: '/api/flow/media-id',
  /** Video generation */
  generateVideo: '/api/generate-video',
  /** TTS synthesis — route dispatches TTS_PROVIDERS registry */
  generateTts: '/api/generate-tts',
  concatAudio: '/api/concat-audio',
  /**
   * TTS Batch / Tool Dịch SRT:
   * - action=translateOnly: Google Studio || batch translate
   * - stream full pipe: video/SRT → TTS → CapCut draft / mux
   */
  ttsBatchSrt: '/api/tts-batch-srt',
  /** Native AI Novel engine */
  ainovel: {
    start: '/api/ainovel/start',
    stop: '/api/ainovel/stop',
    resume: '/api/ainovel/resume',
    status: '/api/ainovel/status',
    stream: '/api/ainovel/stream',
    config: '/api/ainovel/config',
    chapters: '/api/ainovel/chapters',
    capabilities: '/api/ainovel/capabilities',
    diag: '/api/ainovel/diag',
    downloadAll: '/api/ainovel/download-all',
  },
  engine: '/api/engine',
  persistStore: '/api/persist-store',
  openFolder: '/api/open-folder',
  selectFolder: '/api/select-folder',
  getCookie: '/api/get-cookie',
  cleanupAssets: '/api/cleanup-assets',
  shipPack: '/api/ship-pack',
  exportCapcut: '/api/export-capcut',
  entitlementIssue: '/api/entitlement/issue',
  entitlementVerify: '/api/entitlement/verify',
  entitlementHwid: '/api/entitlement/hwid',
  entitlementActivate: '/api/entitlement/activate',
  entitlementTrial: '/api/entitlement/trial',
  entitlementWebhook: '/api/entitlement/webhook',
  entitlementCodes: '/api/entitlement/codes',
  /** Multi-seat: transfer / expand / summary (admin) */
  entitlementSeats: '/api/entitlement/seats',
  entitlementPaymentNotify: '/api/entitlement/payment-notify',
  /** Telegram bot webhook (Vercel public) — inline Cấp Key / Từ chối */
  entitlementTelegramWebhook: '/api/entitlement/telegram-webhook',
  commercialStatus: '/api/commercial/status',
  /** Supabase + Vercel cloud hybrid */
  cloudStatus: '/api/cloud/status',
  cloudOrders: '/api/cloud/orders',
  cloudOrdersConfirm: '/api/cloud/orders/confirm',
  cloudLicenseIssue: '/api/cloud/license/issue',
  cloudLicenseVerify: '/api/cloud/license/verify',
  cloudLicenseTrial: '/api/cloud/license/trial',
  cloudLicenseRevoke: '/api/cloud/license/revoke',
  /** Admin: list licenses (plan/status/hwid filter) */
  cloudLicenseList: '/api/cloud/license/list',
  selfHealMedia: '/api/self-heal/media',
  castAutoTag: '/api/cast/auto-tag',
  getTiktokSession: '/api/get-tiktok-session',
  ttsVoices: '/api/tts/voices',
  omnivoiceStatus: '/api/omnivoice/status',
  vinaVoiceClone: '/api/vina-voice/clone',
  vinaVoiceProfiles: '/api/vina-voice/profiles',
  vinaVoiceStatus: '/api/vina-voice/status',
  vinaVoiceEngineStart: '/api/vina-voice/engine/start',
  vinaVoiceWarm: '/api/vina-voice/warm',
  downloadVideo: '/api/download-video',
  /** YouTube title/desc/captions → seed Setup rewrite */
  youtubeSource: '/api/youtube-source',
  /**
   * YouTube meta psych SEO — score ≥8.5 + rewrite rounds (server generateYoutubeMetaWithQA).
   * Prefer over navtools.youtubeSeo for Studio Meta / post-write.
   */
  youtubeMeta: '/api/youtube-meta',
  isolateVocals: '/api/isolate-vocals',
  transcribe: '/api/transcribe',
  watermarkAudio: '/api/watermark-audio',
  splitVideo: '/api/split-video',
  translateSrt: '/api/translate-srt',
  rpaTranslateSrt: '/api/rpa-translate-srt',
  rpaProfileManager: '/api/rpa-profile-manager',
  videoEditor: '/api/video-editor',
  /** Bypass Engine — FFmpeg fingerprint diversify (toolbox) */
  bypassEngine: '/api/bypass-engine',
  /** Real NVENC probe (same as Settings) — GET ?nvenc=1 */
  bypassEngineNvenc: '/api/bypass-engine?nvenc=1',
  systemInfo: '/api/system-info',
  systemInfoInstallGpu: '/api/system-info/install-gpu',
  systemInfoInstallStatus: '/api/system-info/install-status',
  /** Runtime probes: FFmpeg, public dirs, Edge TTS pkg, Chrome */
  healthRuntime: '/api/health/runtime',
  /** Per-key RPM/RPD time counters + wait message */
  keyQuota: '/api/key-quota',
  navtools: {
    gateway: '/api/navtools/gateway',
    youtubeSeo: '/api/navtools/youtube-seo',
    upscale: '/api/navtools/upscale',
    bgRemove: '/api/navtools/bg_remove',
    subtitle: '/api/navtools/subtitle',
    selectPath: '/api/navtools/select-path',
  },
  capassistant: {
    selectFile: '/api/capassistant/select-file',
    saveFile: '/api/capassistant/save-file',
    autoMaster: '/api/capassistant/auto-master',
    thumbnail: '/api/capassistant/thumbnail',
    join: '/api/capassistant/join',
    fileText: '/api/capassistant/file-text',
    openPath: '/api/capassistant/open-path',
  },
  integrations: {
    chapter: '/api/integrations/chapter',
    pipeline: '/api/integrations/pipeline',
    seedance: '/api/integrations/seedance',
    fablecut: '/api/integrations/fablecut',
    mirofish: '/api/integrations/mirofish',
    status: '/api/integrations/status',
    watch: '/api/integrations/watch',
  },
  /** Packaged Seedance IP authority (Vercel license host) — one-path crown C */
  cloudIpSeedance: '/api/cloud/ip/seedance',
  /** Packaged YouTube psych / SEO IP authority */
  cloudIpPsych: '/api/cloud/ip/psych',
  /** Packaged NAV script2prompt / storyboard analyzer crown IP */
  cloudIpNavAnalyzer: '/api/cloud/ip/nav-analyzer',
  /** Packaged Phantom-X filter-graph compile */
  cloudIpBypass: '/api/cloud/ip/bypass',
  /** Packaged Dịch SRT prompt/rules crown */
  cloudIpTranslate: '/api/cloud/ip/translate',
  /** Serve generated stills (path prefix — may append filename) */
  serveImage: '/api/serve-image',
  serveImageQuery: '/api/serve-image',
} as const;

/** Image provider ownership (server: generate-image) */
export const IMAGE_PROVIDERS = {
  flow: 'flow',
  openai: 'openai',
  grok: 'grok',
  gemini: 'gemini',
} as const;

/**
 * `/api/generate` requestType → handler group (file under api/generate/handlers/).
 * 1 requestType = 1 responsibility inside that group.
 */
export const GENERATE_REQUEST_OWNERS = {
  ANALYZE_VISUAL_DNA: 'visualDna',
  GENERATE_IDEAS: 'ideas',
  GENERATE_IDEA: 'ideas',
  ANALYZE_YOUTUBE_PLOT: 'ideas',
  GENERATE_IMAGE_PROMPT: 'imagePrompt',
  REGENERATE_PROMPT: 'imagePrompt',
  GENERATE_OUTLINE: 'outline',
  GENERATE_CHAPTER_OUTLINE: 'outline',
  PLAN_ARC: 'outline',
  WRITE_CHAPTER: 'chapter',
  REVISE_CHAPTER: 'chapter',
  EVALUATE_CHAPTER: 'chapter',
  COMMIT_MEMORY: 'chapter',
  EXPAND_SCENE: 'scene',
  REWRITE_SCENE: 'scene',
  EXTRACT_CHARACTERS: 'character',
  GENERATE_CHARACTER_PROMPT: 'character',
  GENERATE_CHARACTER_PROMPT_ONLY: 'character',
  COMPRESS_CONTEXT: 'foundation',
  IMPORT_FOUNDATION: 'foundation',
  /** Tóm gọn dàn ý từ kịch bản/truyện dán (Viết tiếp · Viết lại / Kế thừa) */
  SUMMARIZE_SCRIPT_OUTLINE: 'foundation',
} as const;

export type GenerateRequestType = keyof typeof GENERATE_REQUEST_OWNERS;

/** Who may call which client concern (documentation + lint target) */
export const CLIENT_OWNERS = {
  writeChapter: {
    module: 'workspace/modules/writeModule.ts',
    api: API.generate,
    requestTypes: [
      'WRITE_CHAPTER',
      'REVISE_CHAPTER',
      'EVALUATE_CHAPTER',
      'COMMIT_MEMORY',
    ] as const,
  },
  sceneEdit: {
    module: 'workspace/modules/sceneModule.ts',
    api: API.generate,
    requestTypes: ['EXPAND_SCENE', 'REWRITE_SCENE'] as const,
  },
  imagePrompt: {
    module: 'workspace/modules/imageModule.ts',
    api: API.generate,
    requestTypes: ['GENERATE_IMAGE_PROMPT', 'REGENERATE_PROMPT'] as const,
  },
  tts: {
    module: 'workspace/modules/ttsModule.ts',
    api: API.generateTts,
    requestTypes: [] as const,
  },
  imageGen: {
    module: 'workspace/modules/imageModule.ts',
    api: API.generateImage,
    requestTypes: [] as const,
  },
  videoGen: {
    module: 'workspace/modules/videoModule.ts',
    api: API.generateVideo,
    requestTypes: [] as const,
  },
} as const;
