import type { NovelStore } from './novelTypes';
import { imageAssetKey, sceneAssetKey } from '@/contracts';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';
import { effectiveSetupWordGoal } from '@/lib/commercial/freeLimitsPolicy';

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

export const selectWorkspaceTab = (state: NovelStore) => state.workspaceTab;
export const selectGiaiDoan = (state: NovelStore) => state.giai_doan;
export const selectSetupKind = (state: NovelStore) => state.setupKind;
export const selectChuongDangChon = (state: NovelStore) => state.chuong_dang_chon;
export const selectTenTacPham = (state: NovelStore) => state.ten_tac_pham;
export const selectDangTai = (state: NovelStore) => state.dang_tai;
export const selectIsPro = (state: NovelStore) => state.is_pro;
export const selectIsVip = (state: NovelStore) => state.is_vip;
export const selectIsTrial = (state: NovelStore) => state.is_trial;
export const selectCredits = (state: NovelStore) => state.credits;
export const selectTargetWords = (state: NovelStore) =>
  effectiveSetupWordGoal(state.setup?.so_tu_chuong, state);
export const selectMemoryPipelineStatus = (state: NovelStore) =>
  state.memoryPipelineStatus;
export const selectSetGiaiDoan = (state: NovelStore) => state.setGiaiDoan;
export const selectSetDangTai = (state: NovelStore) => state.setDangTai;
export const selectUpdateTenTacPham = (state: NovelStore) => state.updateTenTacPham;
export const selectSetSetupKind = (state: NovelStore) => state.setSetupKind;

function chapterNumEq(a: unknown, b: unknown): boolean {
  return Number(a) === Number(b);
}

export const selectCurrentChapter = (state: NovelStore) =>
  state.danh_sach_chuong.find((chapter) =>
    chapterNumEq(chapter.so_chuong, state.chuong_dang_chon),
  ) || null;

/** Only chapter body for current selection — avoids full list identity churn when possible */
export const selectCurrentChapterContent = (state: NovelStore) => {
  const ch = state.danh_sach_chuong.find((c) =>
    chapterNumEq(c.so_chuong, state.chuong_dang_chon),
  );
  return ch?.noi_dung || '';
};

export const selectCurrentChapterMeta = (state: NovelStore) => {
  const ch = state.danh_sach_chuong.find((c) =>
    chapterNumEq(c.so_chuong, state.chuong_dang_chon),
  );
  if (!ch) return null;
  return {
    so_chuong: ch.so_chuong,
    tieu_de: ch.tieu_de,
    trang_thai: ch.trang_thai,
    hasContent: Boolean((ch.noi_dung || '').trim()),
  };
};

export const selectCurrentHook = (state: NovelStore) =>
  state.chapterHooks?.[state.chuong_dang_chon]?.hook || '';

export const selectCurrentEditorReview = (state: NovelStore) =>
  state.editorReviews?.[state.chuong_dang_chon];

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

/**
 * Image progress for current chapter only.
 * Returns a stable-ish primitive string key for cheap equality: "ok/fail/total".
 */
export function selectChapterImageProgress(state: NovelStore): {
  success: number;
  failed: number;
  total: number;
  chapterNum: number;
} {
  const chapterNum = Number(state.chuong_dang_chon) || 0;
  // Key scan only — no parseScenes/content walk (cheap on every store tick)
  const promptsMap = state.generatedPrompts || {};
  const imagesMap = state.generatedImages || {};
  let total = 0;
  let success = 0;
  for (const key of Object.keys(promptsMap)) {
    const m = /^(\d+)_(\d+)$/.exec(key);
    if (!m || Number(m[1]) !== chapterNum) continue;
    const sceneIdx = Number(m[2]);
    const list = promptsMap[key] || [];
    total += list.length;
    for (let promptIdx = 0; promptIdx < list.length; promptIdx++) {
      if (imagesMap[imageAssetKey(chapterNum, sceneIdx, promptIdx)]) success += 1;
    }
  }
  return {
    success,
    failed: Math.max(0, total - success),
    total,
    chapterNum,
  };
}
