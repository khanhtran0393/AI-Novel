import { cloneFreshProjectState, PROJECT_RESET_POINT } from './novelInitialState';
import type { NovelActions } from './novelTypes';
import type { StoreGet, StoreSet } from './storeSet';

type CredentialActions = Pick<
  NovelActions,
  | 'setApiKey' | 'setApiKeys' | 'setOpenaiApiKey' | 'setOpenaiApiKeys'
  | 'setGrokApiKey' | 'setGrokApiKeys' | 'setClaudeApiKey' | 'setClaudeApiKeys'
  | 'setLumaApiKey' | 'setLumaApiKeys'
  | 'setRunwayApiKey' | 'setRunwayApiKeys' | 'setFalaiApiKey' | 'setFalaiApiKeys'
  | 'prioritizeApiKey' | 'setGoogleStudioCookie' | 'addGoogleCookie' | 'removeGoogleCookie'
  | 'addTikTokSession' | 'removeTikTokSession' | 'setTikTokSessionIds'
  | 'setHydrated' | 'resetStore'
  | 'updateGoogleDrivePath' | 'setGoogleDriveConnected' | 'setGoogleLoggedIn' | 'setGoogleUser'
  | 'setVipStatus' | 'setCredits' | 'deductCredits' | 'setUseGpuAcceleration'
>;

export function createCredentialActions(
  set: StoreSet,
  get: StoreGet,
): CredentialActions {
  return {
      setApiKey: (apiKey) => set({ apiKey }),

      setApiKeys: (apiKeys) => set({ apiKeys }),

      setOpenaiApiKey: (openaiApiKey) => set({ openaiApiKey }),

      setOpenaiApiKeys: (openaiApiKeys) => set({ openaiApiKeys }),

      setGrokApiKey: (grokApiKey) => set({ grokApiKey }),

      setGrokApiKeys: (grokApiKeys) => set({ grokApiKeys }),

      setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),

      setClaudeApiKeys: (claudeApiKeys) => set({ claudeApiKeys }),

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

      addTikTokSession: (sessionId: string) =>
        set((state) => {
          const trimmed = (sessionId || '').trim();
          if (!trimmed) return state;
          const existing = state.tiktokSessionIds || [];
          if (existing.includes(trimmed)) {
            if (!state.ttsConfig?.tiktokSessionId?.trim()) {
              return {
                ttsConfig: { ...state.ttsConfig, tiktokSessionId: trimmed },
              };
            }
            return state;
          }
          const next = [...existing, trimmed];
          const primary = state.ttsConfig?.tiktokSessionId?.trim() || trimmed;
          return {
            tiktokSessionIds: next,
            ttsConfig: { ...state.ttsConfig, tiktokSessionId: primary },
          };
        }),

      removeTikTokSession: (index: number) =>
        set((state) => {
          const next = (state.tiktokSessionIds || []).filter((_, i) => i !== index);
          const removed = (state.tiktokSessionIds || [])[index];
          const primary = state.ttsConfig?.tiktokSessionId?.trim();
          const nextPrimary =
            primary && primary !== removed ? primary : next[0] || '';
          return {
            tiktokSessionIds: next,
            ttsConfig: { ...state.ttsConfig, tiktokSessionId: nextPrimary },
          };
        }),

      setTikTokSessionIds: (ids: string[]) =>
        set((state) => {
          const cleaned = (ids || []).map((s) => String(s || '').trim()).filter(Boolean);
          const unique = [...new Set(cleaned)];
          const primary =
            (state.ttsConfig?.tiktokSessionId?.trim() &&
            unique.includes(state.ttsConfig.tiktokSessionId.trim())
              ? state.ttsConfig.tiktokSessionId.trim()
              : unique[0]) || '';
          return {
            tiktokSessionIds: unique,
            ttsConfig: { ...state.ttsConfig, tiktokSessionId: primary },
          };
        }),

      setHydrated: (isHydrated) => set({ isHydrated }),

      /**
       * LOCKED — Nút **Làm Mới Dự Án** (`docs/RESET_POINT.md`).
       * Canvas trống (tên / lore / chương); **cài đặt + credentials giữ nguyên**.
       */
      resetStore: () =>
        set((state) => {
          const fresh = cloneFreshProjectState();
          return {
            ...fresh,
            isHydrated: true,

            // ── KEPT: credentials & identity ──
            apiKey: state.apiKey,
            apiKeys: state.apiKeys,
            openaiApiKey: state.openaiApiKey,
            openaiApiKeys: state.openaiApiKeys,
            grokApiKey: state.grokApiKey,
            grokApiKeys: state.grokApiKeys,
            claudeApiKey: state.claudeApiKey,
            claudeApiKeys: state.claudeApiKeys,
            lumaApiKey: state.lumaApiKey,
            lumaApiKeys: state.lumaApiKeys,
            runwayApiKey: state.runwayApiKey,
            runwayApiKeys: state.runwayApiKeys,
            falaiApiKey: state.falaiApiKey,
            falaiApiKeys: state.falaiApiKeys,
            googleStudioCookie: state.googleStudioCookie,
            googleStudioCookies: state.googleStudioCookies,
            tiktokSessionIds: state.tiktokSessionIds,
            googleDrivePath: state.googleDrivePath,
            googleDriveConnected: state.googleDriveConnected,
            googleLoggedIn: state.googleLoggedIn,
            googleUser: state.googleUser,

            // ── KEPT: cài đặt (Settings / media / TTS) ──
            aiMasterModel: state.aiMasterModel,
            aiMasterApiKey: state.aiMasterApiKey,
            imageApiKey: state.imageApiKey,
            videoApiKey: state.videoApiKey,
            imageProvider: state.imageProvider,
            imageModel: state.imageModel,
            videoProvider: state.videoProvider,
            videoModel: state.videoModel,
            imageAspectRatio: state.imageAspectRatio,
            videoAspectRatio: state.videoAspectRatio,
            imageCount: state.imageCount,
            videoDuration: state.videoDuration,
            wpm: state.wpm,
            secondsPerBeat: state.secondsPerBeat,
            mediaStylePreset: state.mediaStylePreset,
            visualDnaPrompt: state.visualDnaPrompt,
            useGpuAcceleration: state.useGpuAcceleration,
            savePathTTS: state.savePathTTS,
            savePathImage: state.savePathImage,
            savePathCharacter: state.savePathCharacter,
            savePathVideo: state.savePathVideo,
            ttsConfig: { ...state.ttsConfig },
            youtubeSafe: { ...(state.youtubeSafe || fresh.youtubeSafe) },
            userRules: {
              forbidden_words: state.userRules?.forbidden_words ?? fresh.userRules.forbidden_words,
              fatigue_words: state.userRules?.fatigue_words ?? fresh.userRules.fatigue_words,
            },

            // ── WIPED: PROJECT_RESET_POINT (blank canvas) ──
            ten_tac_pham: PROJECT_RESET_POINT.ten_tac_pham,
            lorebook: PROJECT_RESET_POINT.lorebook,
            danh_sach_chuong: [],
            dan_y_tong_the: PROJECT_RESET_POINT.dan_y_tong_the,
            nhan_vat: [],
            nhan_vat_prompts: {},
            setup: fresh.setup,
            chuong_dang_chon: PROJECT_RESET_POINT.chuong_dang_chon,
            // Beats old durable snapshots that still have high content scores
            projectResetEpoch: Date.now(),
            giai_doan: 1,
            generatedAudioPaths: {},
            generatedPrompts: {},
            generatedPromptsAnalysis: {},
            generatedImages: {},
            generatedImageVariants: {},
            generatedVideos: {},
            generatedAssetDna: {},
          };
        }),

      // Actions cho luu tr? Google Drive & Assets

      updateGoogleDrivePath: (googleDrivePath) => set({ googleDrivePath }),

      setGoogleDriveConnected: (googleDriveConnected) => set({ googleDriveConnected }),

      setGoogleLoggedIn: (googleLoggedIn) => set({ googleLoggedIn }),

      setGoogleUser: (googleUser) => set({ googleUser }),

      setVipStatus: (is_vip, is_pro, is_trial = false) =>
        set({
          is_vip: !!is_vip,
          is_pro: !!is_pro,
          // Trial chỉ gắn khi không VIP; paid Pro/VIP/Free luôn xóa cờ trial
          is_trial: !!is_trial && !is_vip,
        }),

      setCredits: (credits) => set({ credits: Math.max(0, Number(credits) || 0) }),

      deductCredits: (_amount) => {
        let success = false;
        set((state) => {
          // Paid Pro / VIP unlimited — trial + free deduct from balance
          if (state.is_vip || (state.is_pro && !state.is_trial)) {
            success = true;
            if ((state.credits ?? 0) < 999_999_999) {
              return { credits: 999_999_999 };
            }
            return state;
          }
          const amount = Math.max(0, Number(_amount) || 0);
          if (state.credits >= amount) {
            success = true;
            return { credits: state.credits - amount };
          }
          return state;
        });
        return success;
      },

      setUseGpuAcceleration: (useGpuAcceleration) => set({ useGpuAcceleration }),
  };
}
