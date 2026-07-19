import { filterOutChapterKeys } from '@/lib/storyWriting';
import {
  liveDnaFromStoreLike,
  stampAudioDna,
  stampImageDna,
  stampVideoDna,
} from '@/lib/mediaDnaMatch';
import {
  flushDurableNow,
  syncLocalStoreToDurable,
} from './persistStorage';
import { withMirroredOutputDna } from './channelStoreHelpers';
import type { NovelActions } from './novelTypes';
import type { StoreGet, StoreSet } from './storeSet';

type MediaAssetActions = Pick<
  NovelActions,
  | 'addGeneratedAudio' | 'addGeneratedPrompts' | 'addGeneratedPromptsAnalysis'
  | 'addGeneratedImage' | 'addGeneratedImageVariants' | 'addGeneratedVideo'
  | 'updateSavePathTTS' | 'updateSavePathImage' | 'updateSavePathCharacter' | 'updateSavePathVideo'
  | 'addProjectUrl'
  | 'setImageModel' | 'setVideoModel' | 'setAiMasterModel' | 'setAiMasterApiKey'
  | 'setVisualDnaPrompt' | 'setMediaStylePreset'
  | 'setImageProvider' | 'setImageApiKey' | 'setImageAspectRatio' | 'setImageCount'
  | 'setVideoProvider' | 'setVideoApiKey' | 'setVideoAspectRatio' | 'setVideoDuration'
  | 'setWpm' | 'setSecondsPerBeat' | 'clearChapterMedia'
>;

export function createMediaAssetActions(
  set: StoreSet,
  get: StoreGet,
): MediaAssetActions {
  return {
    addGeneratedAudio: (key, path, duration) =>
      set((state) => {
        // Empty path = placeholder while generating — do not stamp DNA yet
        const nextDna = { ...(state.generatedAssetDna || {}) };
        if (path) {
          nextDna[key] = stampAudioDna(liveDnaFromStoreLike(state));
        }
        return {
          generatedAudioPaths: {
            ...state.generatedAudioPaths,
            [key]: { path, duration },
          },
          generatedAssetDna: nextDna,
        };
      }),

    addGeneratedPrompts: (key, prompts) =>
      set((state) => ({
        generatedPrompts: { ...state.generatedPrompts, [key]: prompts },
      })),

    addGeneratedPromptsAnalysis: (key, analysis) =>
      set((state) => ({
        generatedPromptsAnalysis: {
          ...state.generatedPromptsAnalysis,
          [key]: analysis,
        },
      })),

    addGeneratedImage: (key, path) =>
      set((state) => {
        // Empty path = placeholder while generating — do not stamp DNA yet (mirror audio)
        const nextDna = { ...(state.generatedAssetDna || {}) };
        if (path) {
          nextDna[key] = stampImageDna(liveDnaFromStoreLike(state));
        } else {
          delete nextDna[key];
        }
        return {
          generatedImages: { ...(state.generatedImages || {}), [key]: path },
          generatedAssetDna: nextDna,
        };
      }),

    addGeneratedImageVariants: (key, paths) =>
      set((state) => ({
        generatedImageVariants: {
          ...(state.generatedImageVariants || {}),
          [key]: paths,
        },
      })),

    addGeneratedVideo: (key, path) =>
      set((state) => {
        const nextDna = { ...(state.generatedAssetDna || {}) };
        if (path) {
          nextDna[key] = stampVideoDna(liveDnaFromStoreLike(state));
        } else {
          delete nextDna[key];
        }
        return {
          generatedVideos: { ...(state.generatedVideos || {}), [key]: path },
          generatedAssetDna: nextDna,
        };
      }),

    updateSavePathTTS: (savePathTTS) => set({ savePathTTS }),
    updateSavePathImage: (savePathImage) => set({ savePathImage }),
    updateSavePathCharacter: (savePathCharacter) => set({ savePathCharacter }),
    updateSavePathVideo: (savePathVideo) => set({ savePathVideo }),

    addProjectUrl: (key, url) =>
      set((state) => ({
        projectUrls: { ...(state.projectUrls || {}), [key]: url },
      })),

    setImageModel: (model, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        imageModel: model,
        channels: mirror
          ? withMirroredOutputDna(state, { imageModel: model })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setVideoModel: (model, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        videoModel: model,
        channels: mirror
          ? withMirroredOutputDna(state, { videoModel: model })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setAiMasterModel: (model) => {
      set({ aiMasterModel: model });
      queueMicrotask(() => flushDurableNow());
    },

    setAiMasterApiKey: (key) => {
      set({ aiMasterApiKey: key });
      queueMicrotask(() => flushDurableNow());
    },

    setVisualDnaPrompt: (prompt) => {
      const visualDnaPrompt =
        typeof prompt === 'string' ? prompt : String(prompt || '');
      set((state) => {
        const chId = state.activeChannelId;
        const ch = state.channels?.[chId];
        return {
          visualDnaPrompt,
          channels: ch
            ? {
                ...state.channels,
                [chId]: {
                  ...ch,
                  visualDna: visualDnaPrompt,
                  updatedAt: new Date().toISOString(),
                },
              }
            : state.channels,
        };
      });
      queueMicrotask(() => {
        syncLocalStoreToDurable({ flush: true });
      });
    },

    setMediaStylePreset: (mediaStylePreset, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        mediaStylePreset,
        channels: mirror
          ? withMirroredOutputDna(state, { mediaStylePreset })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setImageProvider: (imageProvider, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        imageProvider,
        channels: mirror
          ? withMirroredOutputDna(state, { imageProvider })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setImageApiKey: (imageApiKey) => {
      set({ imageApiKey });
      queueMicrotask(() => flushDurableNow());
    },

    setImageAspectRatio: (imageAspectRatio, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        imageAspectRatio,
        channels: mirror
          ? withMirroredOutputDna(state, { imageAspectRatio })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setImageCount: (imageCount, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      const n = Math.max(1, Math.min(4, Number(imageCount) || 1));
      set((state) => ({
        imageCount: n,
        channels: mirror
          ? withMirroredOutputDna(state, { imageCount: n })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setVideoProvider: (videoProvider, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        videoProvider,
        channels: mirror
          ? withMirroredOutputDna(state, { videoProvider })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setVideoApiKey: (videoApiKey) => {
      set({ videoApiKey });
      queueMicrotask(() => flushDurableNow());
    },

    setVideoAspectRatio: (videoAspectRatio, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      set((state) => ({
        videoAspectRatio,
        channels: mirror
          ? withMirroredOutputDna(state, { videoAspectRatio })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setVideoDuration: (videoDuration, opts) => {
      const mirror = opts?.mirrorChannel !== false;
      const n = Number(videoDuration);
      if (!Number.isFinite(n) || n <= 0 || n > 15) {
        throw new Error(
          'VIDEO_DURATION_INVALID: Hãy chọn thời lượng video hợp lệ; app không tự thay bằng 6 giây.',
        );
      }
      if (get().videoProvider === 'flow' && ![4, 6, 8].includes(n)) {
        throw new Error(
          `FLOW_DURATION_INVALID: Flow chỉ nhận 4/6/8 giây, không nhận ${n}s.`,
        );
      }
      set((state) => ({
        videoDuration: n,
        channels: mirror
          ? withMirroredOutputDna(state, { videoDuration: n })
          : state.channels,
      }));
      queueMicrotask(() => flushDurableNow());
    },

    setWpm: (wpm) => {
      set({ wpm });
      queueMicrotask(() => flushDurableNow());
    },

    setSecondsPerBeat: (secondsPerBeat) => {
      set({ secondsPerBeat });
      queueMicrotask(() => flushDurableNow());
    },

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
          generatedAssetDna: strip(state.generatedAssetDna),
          projectUrls: strip(state.projectUrls),
          editorReviews: nextReviews,
        };
      }),
  };
}
