/**
 * Snapshot / restore workspace ↔ channel projectSnapshot.
 * Pure helpers used by the Zustand store.
 */
import type {
  ChannelOutputDna,
  ChannelProfile,
  ChannelProjectSnapshot,
  ChannelTtsDna,
} from './channelModel';
import {
  applyChannelDnaToSnapshot,
  defaultOutputDna,
  defaultTtsDna,
  emptyProjectSnapshot,
  resolveChannelOutputDna,
  resolveChannelTtsDna,
} from './channelModel';
import { normalizeVoiceCast } from './voiceCast';

/** Minimal store slice needed for channel bind */
export type ChannelBindableState = {
  ten_tac_pham: string;
  setup: ChannelProjectSnapshot['setup'];
  dan_y_tong_the: string;
  nhan_vat: string[];
  nhan_vat_prompts: ChannelProjectSnapshot['nhan_vat_prompts'];
  danh_sach_chuong: ChannelProjectSnapshot['danh_sach_chuong'];
  chuong_dang_chon: number;
  lorebook: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  voiceCast: ChannelProjectSnapshot['voiceCast'];
  visualDnaPrompt: string;
  mediaStylePreset: string;
  imageAspectRatio: string;
  videoAspectRatio: string;
  imageProvider?: string;
  imageModel?: string;
  imageCount?: number;
  videoProvider?: string;
  videoModel?: string;
  videoDuration?: number;
  generatedAudioPaths: ChannelProjectSnapshot['generatedAudioPaths'];
  generatedPrompts: Record<string, unknown[]>;
  generatedPromptsAnalysis: Record<string, string>;
  generatedImages: Record<string, string>;
  generatedImageVariants: Record<string, string[]>;
  generatedVideos: Record<string, string>;
  chapterHooks: Record<number, unknown>;
  humanEditFlags: Record<number, unknown>;
  editorReviews: Record<number, unknown>;
  da_dien_ra_entities: ChannelProjectSnapshot['da_dien_ra_entities'];
  world_state: ChannelProjectSnapshot['world_state'];
  userRules: ChannelProjectSnapshot['userRules'];
  pipeline_step: ChannelProjectSnapshot['pipeline_step'];
  ttsConfig: {
    voice: string;
    platform: string;
    language?: string;
    speed?: number;
    pitch?: number;
    syncMode?: 'default' | 'force_sync' | 'pro';
    vinaGender?: 'male' | 'female';
    vinaArea?: 'northern' | 'central' | 'southern';
    vinaGroup?: string;
    vinaEmotion?: string;
    vinaUseClone?: boolean;
    vinaSpeakerSeed?: number;
    vinaStyleSeed?: number;
  };
};

export function captureTtsDnaFromConfig(
  tts: ChannelBindableState['ttsConfig'] | null | undefined,
): ChannelTtsDna {
  return defaultTtsDna({
    platform: tts?.platform,
    voice: tts?.voice,
    language: tts?.language,
    speed: tts?.speed,
    pitch: tts?.pitch,
    syncMode: tts?.syncMode,
    vinaGender: tts?.vinaGender,
    vinaArea: tts?.vinaArea,
    vinaGroup: tts?.vinaGroup,
    vinaEmotion: tts?.vinaEmotion,
    vinaUseClone: tts?.vinaUseClone,
    vinaSpeakerSeed: tts?.vinaSpeakerSeed,
    vinaStyleSeed: tts?.vinaStyleSeed,
  });
}

export function captureOutputDnaFromState(
  state: Pick<
    ChannelBindableState,
    | 'mediaStylePreset'
    | 'imageProvider'
    | 'imageModel'
    | 'imageAspectRatio'
    | 'imageCount'
    | 'videoProvider'
    | 'videoModel'
    | 'videoAspectRatio'
    | 'videoDuration'
  >,
): ChannelOutputDna {
  return defaultOutputDna({
    mediaStylePreset: state.mediaStylePreset,
    imageProvider: state.imageProvider,
    imageModel: state.imageModel,
    imageAspectRatio: state.imageAspectRatio,
    imageCount: state.imageCount,
    videoProvider: state.videoProvider,
    videoModel: state.videoModel,
    videoAspectRatio: state.videoAspectRatio,
    videoDuration: state.videoDuration,
  });
}

export function captureProjectSnapshot(
  state: ChannelBindableState,
): ChannelProjectSnapshot {
  const ttsDna = captureTtsDnaFromConfig(state.ttsConfig);
  const outputDna = captureOutputDnaFromState(state);
  return {
    ten_tac_pham: state.ten_tac_pham,
    setup: { ...state.setup },
    dan_y_tong_the: state.dan_y_tong_the,
    nhan_vat: [...(state.nhan_vat || [])],
    nhan_vat_prompts: { ...(state.nhan_vat_prompts || {}) },
    danh_sach_chuong: (state.danh_sach_chuong || []).map((c) => ({ ...c })),
    chuong_dang_chon: state.chuong_dang_chon,
    lorebook: state.lorebook || '',
    tom_tat_cuon_chieu: state.tom_tat_cuon_chieu || '',
    tri_nho_ngan_han: [...(state.tri_nho_ngan_han || [])],
    voiceCast: normalizeVoiceCast(state.voiceCast),
    visualDnaPrompt: state.visualDnaPrompt || '',
    mediaStylePreset: state.mediaStylePreset || outputDna.mediaStylePreset,
    imageAspectRatio: state.imageAspectRatio || outputDna.imageAspectRatio,
    videoAspectRatio: state.videoAspectRatio || outputDna.videoAspectRatio,
    imageProvider: state.imageProvider || outputDna.imageProvider,
    imageModel: state.imageModel || outputDna.imageModel,
    imageCount: state.imageCount ?? outputDna.imageCount,
    videoProvider: state.videoProvider || outputDna.videoProvider,
    videoModel: state.videoModel || outputDna.videoModel,
    videoDuration: state.videoDuration ?? outputDna.videoDuration,
    outputDna,
    generatedAudioPaths: { ...(state.generatedAudioPaths || {}) },
    generatedPrompts: { ...(state.generatedPrompts || {}) },
    generatedPromptsAnalysis: { ...(state.generatedPromptsAnalysis || {}) },
    generatedImages: { ...(state.generatedImages || {}) },
    generatedImageVariants: { ...(state.generatedImageVariants || {}) },
    generatedVideos: { ...(state.generatedVideos || {}) },
    chapterHooks: { ...(state.chapterHooks || {}) },
    humanEditFlags: { ...(state.humanEditFlags || {}) },
    editorReviews: { ...(state.editorReviews || {}) },
    da_dien_ra_entities: {
      dia_diem: [...(state.da_dien_ra_entities?.dia_diem || [])],
      vat_pham: [...(state.da_dien_ra_entities?.vat_pham || [])],
      motifs: [...(state.da_dien_ra_entities?.motifs || [])],
    },
    world_state: {
      inventory: [...(state.world_state?.inventory || [])],
      discovered_clues: [...(state.world_state?.discovered_clues || [])],
      current_location: state.world_state?.current_location || '',
    },
    userRules: {
      forbidden_words: state.userRules?.forbidden_words || '',
      fatigue_words: state.userRules?.fatigue_words || '',
    },
    pipeline_step: state.pipeline_step || 'outline',
    ttsVoice: ttsDna.voice,
    ttsPlatform: ttsDna.platform,
    ttsDna,
  };
}

export type ChannelWorkspaceMediaPatch = {
  mediaStylePreset?: string;
  imageAspectRatio?: string;
  videoAspectRatio?: string;
  imageProvider?: string;
  imageModel?: string;
  imageCount?: number;
  videoProvider?: string;
  videoModel?: string;
  videoDuration?: number;
};

export type ChannelTtsConfigPatch = Partial<ChannelTtsDna> & {
  voice?: string;
  platform?: string;
};

export function snapshotToWorkspacePatch(
  channel: ChannelProfile,
  snap: ChannelProjectSnapshot | null,
): Partial<ChannelBindableState> & {
  ttsConfigPatch?: ChannelTtsConfigPatch;
  mediaPatch?: ChannelWorkspaceMediaPatch;
} {
  const base = applyChannelDnaToSnapshot(
    channel,
    snap || emptyProjectSnapshot({ ten_tac_pham: channel.name }),
  );
  const out = resolveChannelOutputDna(channel, base);
  const tts = resolveChannelTtsDna(channel, base);
  return {
    ten_tac_pham: base.ten_tac_pham,
    setup: { ...base.setup },
    dan_y_tong_the: base.dan_y_tong_the,
    nhan_vat: [...base.nhan_vat],
    nhan_vat_prompts: { ...base.nhan_vat_prompts },
    danh_sach_chuong: base.danh_sach_chuong.map((c) => ({ ...c })),
    chuong_dang_chon: base.chuong_dang_chon || 1,
    lorebook: base.lorebook,
    tom_tat_cuon_chieu: base.tom_tat_cuon_chieu,
    tri_nho_ngan_han: [...base.tri_nho_ngan_han],
    voiceCast: normalizeVoiceCast(base.voiceCast),
    visualDnaPrompt: base.visualDnaPrompt || channel.visualDna || '',
    mediaStylePreset: out.mediaStylePreset || base.mediaStylePreset,
    imageAspectRatio: out.imageAspectRatio || base.imageAspectRatio,
    videoAspectRatio: out.videoAspectRatio || base.videoAspectRatio,
    imageProvider: out.imageProvider,
    imageModel: out.imageModel,
    imageCount: out.imageCount,
    videoProvider: out.videoProvider,
    videoModel: out.videoModel,
    videoDuration: out.videoDuration,
    generatedAudioPaths: { ...base.generatedAudioPaths },
    generatedPrompts: { ...base.generatedPrompts },
    generatedPromptsAnalysis: { ...base.generatedPromptsAnalysis },
    generatedImages: { ...base.generatedImages },
    generatedImageVariants: { ...base.generatedImageVariants },
    generatedVideos: { ...base.generatedVideos },
    chapterHooks: { ...base.chapterHooks },
    humanEditFlags: { ...base.humanEditFlags },
    editorReviews: { ...base.editorReviews },
    da_dien_ra_entities: {
      dia_diem: [...base.da_dien_ra_entities.dia_diem],
      vat_pham: [...base.da_dien_ra_entities.vat_pham],
      motifs: [...base.da_dien_ra_entities.motifs],
    },
    world_state: { ...base.world_state },
    userRules: { ...base.userRules },
    pipeline_step: base.pipeline_step,
    mediaPatch: {
      mediaStylePreset: out.mediaStylePreset,
      imageAspectRatio: out.imageAspectRatio,
      videoAspectRatio: out.videoAspectRatio,
      imageProvider: out.imageProvider,
      imageModel: out.imageModel,
      imageCount: out.imageCount,
      videoProvider: out.videoProvider,
      videoModel: out.videoModel,
      videoDuration: out.videoDuration,
    },
    ttsConfigPatch: {
      voice: tts.voice,
      platform: tts.platform,
      language: tts.language,
      speed: tts.speed,
      pitch: tts.pitch,
      syncMode: tts.syncMode,
      vinaGender: tts.vinaGender,
      vinaArea: tts.vinaArea,
      vinaGroup: tts.vinaGroup,
      vinaEmotion: tts.vinaEmotion,
      vinaUseClone: tts.vinaUseClone,
      vinaSpeakerSeed: tts.vinaSpeakerSeed,
      vinaStyleSeed: tts.vinaStyleSeed,
    },
  };
}
