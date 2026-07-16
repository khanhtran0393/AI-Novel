import {
  patchChannelOutputDna,
  type ChannelOutputDna,
  type ChannelProfile,
  type ChannelTtsDna,
} from '@/lib/channelModel';
import type {
  ChannelBindableState,
  ChannelTtsConfigPatch,
  ChannelWorkspaceMediaPatch,
} from '@/lib/channelBridge';
import type { NovelState, TTSConfig } from './novelTypes';

export function bindableFromState(state: NovelState): ChannelBindableState {
  const t = state.ttsConfig;
  return {
    ten_tac_pham: state.ten_tac_pham,
    setup: state.setup,
    dan_y_tong_the: state.dan_y_tong_the,
    nhan_vat: state.nhan_vat,
    nhan_vat_prompts: state.nhan_vat_prompts,
    danh_sach_chuong: state.danh_sach_chuong,
    chuong_dang_chon: state.chuong_dang_chon,
    lorebook: state.lorebook,
    tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
    tri_nho_ngan_han: state.tri_nho_ngan_han,
    voiceCast: state.voiceCast,
    visualDnaPrompt: state.visualDnaPrompt,
    mediaStylePreset: state.mediaStylePreset,
    imageAspectRatio: state.imageAspectRatio,
    videoAspectRatio: state.videoAspectRatio,
    imageProvider: state.imageProvider,
    imageModel: state.imageModel,
    imageCount: state.imageCount,
    videoProvider: state.videoProvider,
    videoModel: state.videoModel,
    videoDuration: state.videoDuration,
    generatedAudioPaths: state.generatedAudioPaths,
    generatedPrompts: state.generatedPrompts as Record<string, unknown[]>,
    generatedPromptsAnalysis: state.generatedPromptsAnalysis,
    generatedImages: state.generatedImages,
    generatedImageVariants: state.generatedImageVariants,
    generatedVideos: state.generatedVideos,
    chapterHooks: state.chapterHooks,
    humanEditFlags: state.humanEditFlags,
    editorReviews: state.editorReviews,
    da_dien_ra_entities: state.da_dien_ra_entities,
    world_state: state.world_state,
    userRules: state.userRules,
    pipeline_step: state.pipeline_step,
    ttsConfig: {
      voice: t?.voice || '',
      platform: t?.platform || '',
      language: t?.language,
      speed: t?.speed,
      pitch: t?.pitch,
      syncMode: t?.syncMode,
      vinaGender: t?.vinaGender,
      vinaArea: t?.vinaArea,
      vinaGroup: t?.vinaGroup,
      vinaEmotion: t?.vinaEmotion,
      vinaUseClone: t?.vinaUseClone,
      vinaSpeakerSeed: t?.vinaSpeakerSeed,
      vinaStyleSeed: t?.vinaStyleSeed,
    },
  };
}

export function mergeTtsFromChannelPatch(
  tts: TTSConfig,
  patch?: ChannelTtsConfigPatch | null,
): TTSConfig {
  if (!patch) return tts;
  const next: TTSConfig = { ...tts };
  if (patch.voice) next.voice = patch.voice;
  if (patch.platform) next.platform = patch.platform as TTSConfig['platform'];
  if (patch.language) next.language = patch.language;
  if (typeof patch.speed === 'number' && Number.isFinite(patch.speed)) {
    next.speed = patch.speed;
  }
  if (typeof patch.pitch === 'number' && Number.isFinite(patch.pitch)) {
    next.pitch = patch.pitch;
  }
  if (
    patch.syncMode === 'default' ||
    patch.syncMode === 'force_sync' ||
    patch.syncMode === 'pro'
  ) {
    next.syncMode = patch.syncMode;
  }
  if (patch.vinaGender) next.vinaGender = patch.vinaGender;
  if (patch.vinaArea) next.vinaArea = patch.vinaArea;
  if (typeof patch.vinaGroup === 'string') next.vinaGroup = patch.vinaGroup;
  if (typeof patch.vinaEmotion === 'string') next.vinaEmotion = patch.vinaEmotion;
  if (typeof patch.vinaUseClone === 'boolean') next.vinaUseClone = patch.vinaUseClone;
  if (typeof patch.vinaSpeakerSeed === 'number') {
    next.vinaSpeakerSeed = patch.vinaSpeakerSeed;
  }
  if (typeof patch.vinaStyleSeed === 'number') {
    next.vinaStyleSeed = patch.vinaStyleSeed;
  }
  return next;
}

export function mediaFieldsFromPatch(
  patch?: ChannelWorkspaceMediaPatch | null,
): Partial<NovelState> {
  if (!patch) return {};
  const out: Partial<NovelState> = {};
  if (patch.mediaStylePreset) out.mediaStylePreset = patch.mediaStylePreset;
  if (patch.imageAspectRatio) out.imageAspectRatio = patch.imageAspectRatio;
  if (patch.videoAspectRatio) out.videoAspectRatio = patch.videoAspectRatio;
  if (patch.imageProvider) out.imageProvider = patch.imageProvider;
  if (patch.imageModel) out.imageModel = patch.imageModel;
  if (typeof patch.imageCount === 'number') out.imageCount = patch.imageCount;
  if (patch.videoProvider) out.videoProvider = patch.videoProvider;
  if (patch.videoModel) out.videoModel = patch.videoModel;
  if (typeof patch.videoDuration === 'number') {
    out.videoDuration = patch.videoDuration;
  }
  return out;
}

/** Mirror workspace media fields onto active channel DNA. */
export function withMirroredOutputDna(
  state: NovelState,
  patch: Partial<ChannelOutputDna>,
): Record<string, ChannelProfile> | NovelState['channels'] {
  const chId = state.activeChannelId;
  const ch = state.channels?.[chId];
  if (!ch) return state.channels;
  return {
    ...state.channels,
    [chId]: patchChannelOutputDna(ch, patch),
  };
}

export function ttsDnaPatchFromConfig(config: Partial<TTSConfig>): Partial<ChannelTtsDna> {
  const p: Partial<ChannelTtsDna> = {};
  if (typeof config.platform === 'string') p.platform = config.platform;
  if (typeof config.voice === 'string') p.voice = config.voice;
  if (typeof config.language === 'string') p.language = config.language;
  if (typeof config.speed === 'number') p.speed = config.speed;
  if (typeof config.pitch === 'number') p.pitch = config.pitch;
  if (
    config.syncMode === 'default' ||
    config.syncMode === 'force_sync' ||
    config.syncMode === 'pro'
  ) {
    p.syncMode = config.syncMode;
  }
  if (config.vinaGender) p.vinaGender = config.vinaGender;
  if (config.vinaArea) p.vinaArea = config.vinaArea;
  if (typeof config.vinaGroup === 'string') p.vinaGroup = config.vinaGroup;
  if (typeof config.vinaEmotion === 'string') p.vinaEmotion = config.vinaEmotion;
  if (typeof config.vinaUseClone === 'boolean') p.vinaUseClone = config.vinaUseClone;
  if (typeof config.vinaSpeakerSeed === 'number') {
    p.vinaSpeakerSeed = config.vinaSpeakerSeed;
  }
  if (typeof config.vinaStyleSeed === 'number') p.vinaStyleSeed = config.vinaStyleSeed;
  return p;
}
