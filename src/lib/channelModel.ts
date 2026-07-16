/**
 * Multi-channel layer: one app, many channel identities.
 * Each channel = DNA + ship recipes + project snapshot + memory.
 */

import type { ProjectVoiceCast } from './voiceCast';
import { EMPTY_VOICE_CAST, normalizeVoiceCast } from './voiceCast';
import type { NhanVatPromptsMap } from './characterProfile';

export type ShipMode = 'radio' | 'short' | 'longform';
export type AspectRatio = '16:9' | '9:16' | '1:1';

export type ShipRecipe = {
  mode: ShipMode;
  label: string;
  /** Enable this recipe on channel */
  enabled: boolean;
  aspectRatio: AspectRatio;
  includeHook: boolean;
  includeSrt: boolean;
  includeSeo: boolean;
  includeVisual: boolean;
  includeChecklist: boolean;
  description: string;
};

export const DEFAULT_SHIP_RECIPES: ShipRecipe[] = [
  {
    mode: 'radio',
    label: 'Radio / Audio drama',
    enabled: true,
    aspectRatio: '16:9',
    includeHook: true,
    includeSrt: true,
    includeSeo: true,
    includeVisual: false,
    includeChecklist: true,
    description: 'TTS đa vai + SRT speaker + SEO stub — không bắt buộc ảnh.',
  },
  {
    mode: 'short',
    label: 'Shorts / Reels 9:16',
    enabled: true,
    aspectRatio: '9:16',
    includeHook: true,
    includeSrt: true,
    includeSeo: true,
    includeVisual: true,
    includeChecklist: true,
    description: 'Câu ngắn + 1 shot/cảnh + TTS + pack dọc.',
  },
  {
    mode: 'longform',
    label: 'Longform YouTube',
    enabled: true,
    aspectRatio: '16:9',
    includeHook: true,
    includeSrt: true,
    includeSeo: true,
    includeVisual: true,
    includeChecklist: true,
    description: 'Hook + chương + storyboard + ship pack đầy đủ.',
  },
];

/** Project fields that belong to a channel episode workspace */
export type ChannelProjectSnapshot = {
  ten_tac_pham: string;
  setup: {
    chu_de: string;
    phong_cach: string;
    mo_ta: string;
    so_chuong: number;
    so_tu_chuong?: number;
    ngon_ngu?: string;
  };
  dan_y_tong_the: string;
  nhan_vat: string[];
  nhan_vat_prompts: NhanVatPromptsMap;
  danh_sach_chuong: Array<{
    so_chuong: number;
    tieu_de: string;
    dan_y: string;
    noi_dung: string;
    trang_thai: 'empty' | 'writing' | 'ready';
  }>;
  chuong_dang_chon: number;
  lorebook: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  voiceCast: ProjectVoiceCast;
  visualDnaPrompt: string;
  mediaStylePreset: string;
  imageAspectRatio: string;
  videoAspectRatio: string;
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
  generatedPrompts: Record<string, unknown[]>;
  generatedPromptsAnalysis: Record<string, string>;
  generatedImages: Record<string, string>;
  generatedImageVariants: Record<string, string[]>;
  generatedVideos: Record<string, string>;
  chapterHooks: Record<number, unknown>;
  humanEditFlags: Record<number, unknown>;
  editorReviews: Record<number, unknown>;
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
  userRules: { forbidden_words: string; fatigue_words: string };
  pipeline_step: 'outline' | 'script' | 'commit';
  ttsVoice?: string;
  ttsPlatform?: string;
  /** Full TTS DNA snapshot (speed/pitch/lang/sync/vina…) */
  ttsDna?: ChannelTtsDna;
  /** Media engine fields (Cấu hình đầu ra) */
  imageProvider?: string;
  imageModel?: string;
  imageCount?: number;
  videoProvider?: string;
  videoModel?: string;
  videoDuration?: number;
  outputDna?: ChannelOutputDna;
};

/**
 * Cấu hình đầu ra locked to a channel — applies to image/video gen in that channel.
 * Ship recipe aspect is only a fallback when these are empty.
 */
export type ChannelOutputDna = {
  mediaStylePreset: string;
  imageProvider: string;
  imageModel: string;
  imageAspectRatio: string;
  imageCount: number;
  videoProvider: string;
  videoModel: string;
  videoAspectRatio: string;
  videoDuration: number;
};

/**
 * Cấu Hình Giọng Đọc Toàn Cục locked to a channel.
 * Credentials (API keys / TikTok session) stay global — not channel DNA.
 */
export type ChannelTtsDna = {
  platform: string;
  voice: string;
  language: string;
  speed: number;
  pitch: number;
  syncMode?: 'default' | 'force_sync' | 'pro';
  vinaGender?: 'male' | 'female';
  vinaArea?: 'northern' | 'central' | 'southern';
  vinaGroup?: string;
  vinaEmotion?: string;
  vinaUseClone?: boolean;
  vinaSpeakerSeed?: number;
  vinaStyleSeed?: number;
};

export type ChannelProfile = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  language: string;
  niche: string;
  aspectRatio: AspectRatio;
  visualDna: string;
  narratorVoiceId: string;
  ttsPlatform: string;
  /** Full media DNA (Cấu hình đầu ra) — preferred over ship recipe for gen */
  outputDna?: ChannelOutputDna;
  /** Full TTS DNA (giọng đọc toàn cục) */
  ttsDna?: ChannelTtsDna;
  defaultShipMode: ShipMode;
  shipRecipes: ShipRecipe[];
  savePathRoot: string;
  /** Motifs / hooks already used on this channel (anti-reuse) */
  usedMotifs: string[];
  usedHooks: string[];
  usedThumbnailNotes: string[];
  projectSnapshot: ChannelProjectSnapshot | null;
};

export function defaultOutputDna(
  partial?: Partial<ChannelOutputDna> | null,
): ChannelOutputDna {
  return {
    mediaStylePreset:
      partial?.mediaStylePreset ||
      'cinematic natural realism, grounded production design, expressive lighting',
    imageProvider: partial?.imageProvider || 'gemini',
    imageModel: partial?.imageModel || 'banana',
    imageAspectRatio: partial?.imageAspectRatio || '16:9',
    imageCount: Math.max(1, Math.min(4, Number(partial?.imageCount) || 1)),
    videoProvider: partial?.videoProvider || 'flow',
    videoModel: partial?.videoModel || 'veo_3_1_t2v_fast',
    videoAspectRatio: partial?.videoAspectRatio || '16:9',
    /** Flow: 4|6|8; other providers may allow up to 15 */
    videoDuration: Math.max(1, Math.min(15, Number(partial?.videoDuration) || 8)),
  };
}

export function defaultTtsDna(
  partial?: Partial<ChannelTtsDna> | null,
): ChannelTtsDna {
  const sync = partial?.syncMode;
  return {
    platform: partial?.platform || 'edge_tts',
    voice: partial?.voice || 'vi-VN-NamMinhNeural',
    language: partial?.language || 'vi',
    speed:
      typeof partial?.speed === 'number' && Number.isFinite(partial.speed)
        ? partial.speed
        : 1,
    pitch:
      typeof partial?.pitch === 'number' && Number.isFinite(partial.pitch)
        ? partial.pitch
        : 0,
    syncMode:
      sync === 'force_sync' || sync === 'pro' || sync === 'default'
        ? sync
        : 'default',
    ...(partial?.vinaGender ? { vinaGender: partial.vinaGender } : {}),
    ...(partial?.vinaArea ? { vinaArea: partial.vinaArea } : {}),
    ...(partial?.vinaGroup ? { vinaGroup: partial.vinaGroup } : {}),
    ...(partial?.vinaEmotion ? { vinaEmotion: partial.vinaEmotion } : {}),
    ...(typeof partial?.vinaUseClone === 'boolean'
      ? { vinaUseClone: partial.vinaUseClone }
      : {}),
    ...(typeof partial?.vinaSpeakerSeed === 'number'
      ? { vinaSpeakerSeed: partial.vinaSpeakerSeed }
      : {}),
    ...(typeof partial?.vinaStyleSeed === 'number'
      ? { vinaStyleSeed: partial.vinaStyleSeed }
      : {}),
  };
}

/** Normalize optional nested DNA from partial / legacy flat fields */
export function resolveChannelOutputDna(
  channel: Partial<ChannelProfile> | null | undefined,
  snap?: ChannelProjectSnapshot | null,
): ChannelOutputDna {
  const fromCh = channel?.outputDna;
  const recipeAspect =
    channel?.shipRecipes?.find((r) => r.enabled)?.aspectRatio ||
    channel?.aspectRatio ||
    '16:9';
  return defaultOutputDna({
    mediaStylePreset:
      fromCh?.mediaStylePreset || snap?.mediaStylePreset || undefined,
    imageProvider: fromCh?.imageProvider || snap?.imageProvider || undefined,
    imageModel: fromCh?.imageModel || snap?.imageModel || undefined,
    imageAspectRatio:
      fromCh?.imageAspectRatio ||
      snap?.imageAspectRatio ||
      channel?.aspectRatio ||
      recipeAspect,
    imageCount: fromCh?.imageCount ?? snap?.imageCount,
    videoProvider: fromCh?.videoProvider || snap?.videoProvider || undefined,
    videoModel: fromCh?.videoModel || snap?.videoModel || undefined,
    videoAspectRatio:
      fromCh?.videoAspectRatio ||
      snap?.videoAspectRatio ||
      channel?.aspectRatio ||
      recipeAspect,
    videoDuration: fromCh?.videoDuration ?? snap?.videoDuration,
  });
}

export function resolveChannelTtsDna(
  channel: Partial<ChannelProfile> | null | undefined,
  snap?: ChannelProjectSnapshot | null,
): ChannelTtsDna {
  const fromCh = channel?.ttsDna;
  const fromSnap = snap?.ttsDna;
  return defaultTtsDna({
    ...fromSnap,
    ...fromCh,
    platform:
      fromCh?.platform ||
      channel?.ttsPlatform ||
      fromSnap?.platform ||
      snap?.ttsPlatform ||
      'edge_tts',
    voice:
      fromCh?.voice ||
      channel?.narratorVoiceId ||
      fromSnap?.voice ||
      snap?.ttsVoice ||
      'vi-VN-NamMinhNeural',
  });
}

export function slugifyChannelName(name: string): string {
  return (name || 'channel')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'channel';
}

export function createChannelId(): string {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyProjectSnapshot(
  overrides?: Partial<ChannelProjectSnapshot>,
): ChannelProjectSnapshot {
  return {
    ten_tac_pham: 'Dự án mới',
    setup: {
      chu_de: 'Trinh Thám',
      phong_cach: 'Viễn Tưởng',
      mo_ta: '',
      so_chuong: 5,
      so_tu_chuong: 4250,
      ngon_ngu: 'Tiếng Việt',
    },
    dan_y_tong_the: '',
    nhan_vat: [],
    nhan_vat_prompts: {},
    danh_sach_chuong: [
      {
        so_chuong: 1,
        tieu_de: 'Chương 1',
        dan_y: '',
        noi_dung: '',
        trang_thai: 'empty',
      },
    ],
    chuong_dang_chon: 1,
    lorebook: '',
    tom_tat_cuon_chieu: '',
    tri_nho_ngan_han: [],
    voiceCast: { ...EMPTY_VOICE_CAST },
    visualDnaPrompt: '',
    mediaStylePreset:
      'cinematic natural realism, grounded production design, expressive lighting',
    imageAspectRatio: '16:9',
    videoAspectRatio: '16:9',
    generatedAudioPaths: {},
    generatedPrompts: {},
    generatedPromptsAnalysis: {},
    generatedImages: {},
    generatedImageVariants: {},
    generatedVideos: {},
    chapterHooks: {},
    humanEditFlags: {},
    editorReviews: {},
    da_dien_ra_entities: { dia_diem: [], vat_pham: [], motifs: [] },
    world_state: {
      inventory: [],
      discovered_clues: [],
      current_location: '',
    },
    userRules: { forbidden_words: '', fatigue_words: '' },
    pipeline_step: 'outline',
    ...overrides,
  };
}

export function createChannelProfile(
  name: string,
  partial?: Partial<ChannelProfile>,
): ChannelProfile {
  const now = new Date().toISOString();
  const id = partial?.id || createChannelId();
  return {
    id,
    name: (name || 'Kênh mới').trim(),
    slug: partial?.slug || slugifyChannelName(name || 'kenh-moi'),
    createdAt: partial?.createdAt || now,
    updatedAt: now,
    language: partial?.language || 'vi',
    niche: partial?.niche || '',
    aspectRatio: partial?.aspectRatio || '16:9',
    visualDna: partial?.visualDna || '',
    narratorVoiceId:
      partial?.ttsDna?.voice ||
      partial?.narratorVoiceId ||
      'vi-VN-NamMinhNeural',
    ttsPlatform:
      partial?.ttsDna?.platform || partial?.ttsPlatform || 'edge_tts',
    outputDna: defaultOutputDna(partial?.outputDna),
    ttsDna: defaultTtsDna({
      ...partial?.ttsDna,
      voice:
        partial?.ttsDna?.voice ||
        partial?.narratorVoiceId ||
        'vi-VN-NamMinhNeural',
      platform:
        partial?.ttsDna?.platform || partial?.ttsPlatform || 'edge_tts',
    }),
    defaultShipMode: partial?.defaultShipMode || 'longform',
    shipRecipes: partial?.shipRecipes
      ? partial.shipRecipes.map((r) => ({ ...r }))
      : DEFAULT_SHIP_RECIPES.map((r) => ({ ...r })),
    savePathRoot: partial?.savePathRoot || '',
    usedMotifs: partial?.usedMotifs || [],
    usedHooks: partial?.usedHooks || [],
    usedThumbnailNotes: partial?.usedThumbnailNotes || [],
    projectSnapshot: partial?.projectSnapshot ?? emptyProjectSnapshot({
      ten_tac_pham: name || 'Dự án mới',
    }),
  };
}

export function normalizeChannelProfile(
  raw?: Partial<ChannelProfile> | null,
): ChannelProfile | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const base = createChannelProfile(raw.name || 'Kênh', { id: raw.id });
  const snap = raw.projectSnapshot
    ? {
        ...emptyProjectSnapshot(),
        ...raw.projectSnapshot,
        voiceCast: normalizeVoiceCast(raw.projectSnapshot.voiceCast),
      }
    : null;
  const ttsDna = resolveChannelTtsDna(raw, snap);
  const outputDna = resolveChannelOutputDna(raw, snap);
  return {
    ...base,
    ...raw,
    id: String(raw.id),
    name: (raw.name || base.name).trim(),
    slug: raw.slug || slugifyChannelName(raw.name || base.name),
    narratorVoiceId: ttsDna.voice || base.narratorVoiceId,
    ttsPlatform: ttsDna.platform || base.ttsPlatform,
    ttsDna,
    outputDna,
    shipRecipes:
      Array.isArray(raw.shipRecipes) && raw.shipRecipes.length
        ? raw.shipRecipes.map((r) => ({
            ...DEFAULT_SHIP_RECIPES.find((d) => d.mode === r.mode),
            ...r,
          })) as ShipRecipe[]
        : DEFAULT_SHIP_RECIPES.map((r) => ({ ...r })),
    usedMotifs: Array.isArray(raw.usedMotifs) ? raw.usedMotifs : [],
    usedHooks: Array.isArray(raw.usedHooks) ? raw.usedHooks : [],
    usedThumbnailNotes: Array.isArray(raw.usedThumbnailNotes)
      ? raw.usedThumbnailNotes
      : [],
    projectSnapshot: snap,
  };
}

export function getRecipe(
  channel: ChannelProfile,
  mode?: ShipMode,
): ShipRecipe {
  const m = mode || channel.defaultShipMode;
  return (
    channel.shipRecipes.find((r) => r.mode === m && r.enabled) ||
    channel.shipRecipes.find((r) => r.enabled) ||
    DEFAULT_SHIP_RECIPES[0]
  );
}

/**
 * Overlay channel DNA onto project snapshot for workspace restore.
 * Priority for aspect ratios (does NOT silently force ship recipe):
 *   channel.outputDna → snapshot → channel.aspectRatio → ship recipe
 */
export function applyChannelDnaToSnapshot(
  channel: ChannelProfile,
  snap: ChannelProjectSnapshot,
): ChannelProjectSnapshot {
  const recipe = getRecipe(channel);
  const out = resolveChannelOutputDna(channel, snap);
  const tts = resolveChannelTtsDna(channel, snap);
  const imageAspect =
    channel.outputDna?.imageAspectRatio ||
    snap.imageAspectRatio ||
    channel.aspectRatio ||
    recipe.aspectRatio ||
    out.imageAspectRatio;
  const videoAspect =
    channel.outputDna?.videoAspectRatio ||
    snap.videoAspectRatio ||
    channel.aspectRatio ||
    recipe.aspectRatio ||
    out.videoAspectRatio;
  return {
    ...snap,
    visualDnaPrompt: channel.visualDna || snap.visualDnaPrompt,
    mediaStylePreset:
      channel.outputDna?.mediaStylePreset ||
      snap.mediaStylePreset ||
      out.mediaStylePreset,
    imageAspectRatio: imageAspect,
    videoAspectRatio: videoAspect,
    imageProvider:
      channel.outputDna?.imageProvider || snap.imageProvider || out.imageProvider,
    imageModel:
      channel.outputDna?.imageModel || snap.imageModel || out.imageModel,
    imageCount:
      channel.outputDna?.imageCount ?? snap.imageCount ?? out.imageCount,
    videoProvider:
      channel.outputDna?.videoProvider || snap.videoProvider || out.videoProvider,
    videoModel:
      channel.outputDna?.videoModel || snap.videoModel || out.videoModel,
    videoDuration:
      channel.outputDna?.videoDuration ??
      snap.videoDuration ??
      out.videoDuration,
    outputDna: out,
    ttsVoice: tts.voice,
    ttsPlatform: tts.platform,
    ttsDna: tts,
  };
}

/** Patch channel DNA from live workspace media settings (mirror). */
export function patchChannelOutputDna(
  channel: ChannelProfile,
  patch: Partial<ChannelOutputDna>,
): ChannelProfile {
  const nextOut = defaultOutputDna({ ...channel.outputDna, ...patch });
  const aspect =
    (nextOut.imageAspectRatio as AspectRatio) || channel.aspectRatio;
  return {
    ...channel,
    outputDna: nextOut,
    aspectRatio: aspect === '9:16' || aspect === '1:1' || aspect === '16:9'
      ? aspect
      : channel.aspectRatio,
    visualDna:
      typeof patch.mediaStylePreset === 'string' && !channel.visualDna
        ? channel.visualDna
        : channel.visualDna,
    updatedAt: new Date().toISOString(),
  };
}

/** Patch channel TTS DNA from live ttsConfig (mirror). */
export function patchChannelTtsDna(
  channel: ChannelProfile,
  patch: Partial<ChannelTtsDna>,
): ChannelProfile {
  const next = defaultTtsDna({
    ...resolveChannelTtsDna(channel),
    ...patch,
  });
  return {
    ...channel,
    ttsDna: next,
    narratorVoiceId: next.voice || channel.narratorVoiceId,
    ttsPlatform: next.platform || channel.ttsPlatform,
    language: next.language || channel.language,
    updatedAt: new Date().toISOString(),
  };
}

/** Remember motif/hook on channel (dedupe, cap length) */
export function pushChannelMemory(
  channel: ChannelProfile,
  kind: 'motif' | 'hook' | 'thumb',
  value: string,
  max = 80,
): ChannelProfile {
  const v = (value || '').normalize('NFC').trim();
  if (!v) return channel;
  const key =
    kind === 'motif'
      ? 'usedMotifs'
      : kind === 'hook'
        ? 'usedHooks'
        : 'usedThumbnailNotes';
  const list = [...(channel[key] || [])];
  if (!list.includes(v)) list.unshift(v);
  return {
    ...channel,
    [key]: list.slice(0, max),
    updatedAt: new Date().toISOString(),
  };
}

export function defaultChannelsBootstrap(): {
  activeChannelId: string;
  channels: Record<string, ChannelProfile>;
} {
  const ch = createChannelProfile('Kênh chính', {
    niche: 'Truyện / Drama',
    defaultShipMode: 'longform',
  });
  return {
    activeChannelId: ch.id,
    channels: { [ch.id]: ch },
  };
}

export function normalizeChannelsMap(
  raw?: Record<string, Partial<ChannelProfile>> | null,
): Record<string, ChannelProfile> {
  const out: Record<string, ChannelProfile> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, val] of Object.entries(raw)) {
    const n = normalizeChannelProfile({ ...val, id: val?.id || id });
    if (n) out[n.id] = n;
  }
  return out;
}

export function getActiveChannel(
  channels: Record<string, ChannelProfile>,
  activeChannelId: string | null | undefined,
): ChannelProfile | null {
  if (!activeChannelId) return null;
  return channels[activeChannelId] || null;
}
