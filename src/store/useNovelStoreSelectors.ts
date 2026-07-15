import type { NovelStore } from './novelTypes';

export const selectIsHydrated = (state: NovelStore) => state.isHydrated;
export const selectActiveChannelId = (state: NovelStore) => state.activeChannelId;
export const selectChannels = (state: NovelStore) => state.channels;
export const selectCreateChannel = (state: NovelStore) => state.createChannel;
export const selectSwitchChannel = (state: NovelStore) => state.switchChannel;
export const selectUpdateChannel = (state: NovelStore) => state.updateChannel;
export const selectDeleteChannel = (state: NovelStore) => state.deleteChannel;
export const selectApplyActiveChannelDna = (state: NovelStore) =>
  state.applyActiveChannelDna;
export const selectSaveActiveChannelSnapshot = (state: NovelStore) =>
  state.saveActiveChannelSnapshot;
export const selectTtsConfig = (state: NovelStore) => state.ttsConfig;
export const selectImageProvider = (state: NovelStore) => state.imageProvider;
export const selectImageAspectRatio = (state: NovelStore) => state.imageAspectRatio;
export const selectVisualDnaPrompt = (state: NovelStore) => state.visualDnaPrompt;

export const selectCurrentChapter = (state: NovelStore) =>
  state.danh_sach_chuong.find((chapter) => chapter.so_chuong === state.chuong_dang_chon) ||
  null;

export const selectMediaOutputSettings = (state: NovelStore) => ({
  visualDnaPrompt: state.visualDnaPrompt,
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
