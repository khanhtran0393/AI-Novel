import { createJSONStorage } from 'zustand/middleware';
import { mergeYoutubeSafe as mergeYoutubeSafeConfig } from '@/lib/youtubeSafe';
import {
  defaultChannelsBootstrap,
  normalizeChannelProfile,
  normalizeChannelsMap,
  type ChannelProfile,
} from '@/lib/channelModel';
import {
  captureOutputDnaFromState,
  captureProjectSnapshot,
  captureTtsDnaFromConfig,
} from '@/lib/channelBridge';
import { normalizeVoiceCast } from '@/lib/voiceCast';
import { bindableFromState } from './channelStoreHelpers';
import { STORE_KEY, dualStorage, syncLocalStoreToDurable } from './persistStorage';
import type {
  NovelState,
  NovelStore,
  ProjectVoiceCast,
  YoutubeSafeConfig,
} from './novelTypes';

export function createNovelStorePersistOptions(storeAccess: {
  getState: () => NovelStore;
  setState: (patch: Partial<NovelStore>) => void;
}) {
  return {
    name: STORE_KEY,
    storage: createJSONStorage(() => dualStorage),
    version: 3,
    // v3: ensure every channel has outputDna + ttsDna (channel media/TTS lock)
    migrate: (persistedState: unknown, fromVersion: number) => {
      const state = { ...(persistedState as NovelState) };
      if (fromVersion < 3 && state.channels && typeof state.channels === 'object') {
        const next: Record<string, ChannelProfile> = {};
        for (const [id, ch] of Object.entries(state.channels)) {
          const n = normalizeChannelProfile({ ...ch, id: ch?.id || id });
          if (n) next[n.id] = n;
        }
        state.channels = next;
      }
      return state as NovelState;
    },
    // Deep-ish merge: never drop nested config when partial older snapshots rehydrate
    merge: (persisted: unknown, current: NovelStore) => {
      const p = (persisted || {}) as Partial<NovelState>;
      const preferStr = (a?: string, b?: string) => {
        const aa = (a || '').trim();
        const bb = (b || '').trim();
        if (aa && bb) return aa.length >= bb.length ? aa : bb;
        return aa || bb || '';
      };
      // Prefer workspace (2) if user already left Setup this session — late rehydrate
      // must not yank them back to Setup with stale disk giai_doan:1 (X "does nothing").
      const mergedPhase = (() => {
        const fromP = p.giai_doan;
        const fromC = current.giai_doan;
        if (fromC === 2 || fromP === 2) return 2 as const;
        if (fromP === 1 || fromC === 1) return 1 as const;
        return (fromP ?? fromC ?? 1) as 1 | 2;
      })();

      return {
        ...current,
        ...p,
        giai_doan: mergedPhase,
        // Owner local build: always PRO + unlimited credits (never locked by old free snapshots)
        is_vip: true,
        is_pro: true,
        credits: 999_999_999,
        // Media / DNA output settings — never lose non-empty values to empty defaults
        visualDnaPrompt: preferStr(p.visualDnaPrompt, current.visualDnaPrompt),
        mediaStylePreset:
          preferStr(p.mediaStylePreset, current.mediaStylePreset) ||
          current.mediaStylePreset,
        imageProvider: p.imageProvider || current.imageProvider,
        imageModel: p.imageModel || current.imageModel,
        imageApiKey: p.imageApiKey || current.imageApiKey,
        imageAspectRatio: p.imageAspectRatio || current.imageAspectRatio,
        imageCount:
          typeof p.imageCount === 'number' && p.imageCount > 0
            ? p.imageCount
            : current.imageCount,
        videoProvider: p.videoProvider || current.videoProvider,
        videoModel: p.videoModel || current.videoModel,
        videoApiKey: p.videoApiKey || current.videoApiKey,
        videoAspectRatio: p.videoAspectRatio || current.videoAspectRatio,
        videoDuration:
          typeof p.videoDuration === 'number' && p.videoDuration > 0
            ? p.videoDuration
            : current.videoDuration,
        wpm: typeof p.wpm === 'number' && p.wpm > 0 ? p.wpm : current.wpm,
        secondsPerBeat:
          typeof p.secondsPerBeat === 'number' && p.secondsPerBeat > 0
            ? p.secondsPerBeat
            : current.secondsPerBeat,
        aiMasterModel: p.aiMasterModel || current.aiMasterModel,
        aiMasterApiKey: p.aiMasterApiKey || current.aiMasterApiKey,
        setup: { ...current.setup, ...(p.setup || {}) },
        ttsConfig: (() => {
          const merged = { ...current.ttsConfig, ...(p.ttsConfig || {}) };
          // One-time YouTube-safe upgrade: legacy mass-TTS default (tiktok + flat pitch)
          const isLegacyMassTts =
            merged.platform === 'tiktok_tts' &&
            (merged.voice === 'vocal_1' || !merged.voice) &&
            Number(merged.pitch || 0) === 0 &&
            Number(merged.speed || 1) === 1;
          if (isLegacyMassTts) {
            return {
              ...merged,
              platform: current.ttsConfig.platform,
              language: current.ttsConfig.language,
              voice: current.ttsConfig.voice,
              speed: current.ttsConfig.speed,
              pitch: current.ttsConfig.pitch,
            };
          }
          return merged;
        })(),
        youtubeSafe: mergeYoutubeSafeConfig({
          ...(current.youtubeSafe || {}),
          ...((p as { youtubeSafe?: Partial<YoutubeSafeConfig> }).youtubeSafe || {}),
        }),
        humanEditFlags: {
          ...(current.humanEditFlags || {}),
          ...((p as { humanEditFlags?: NovelState['humanEditFlags'] }).humanEditFlags || {}),
        },
        chapterHooks: {
          ...(current.chapterHooks || {}),
          ...((p as { chapterHooks?: NovelState['chapterHooks'] }).chapterHooks || {}),
        },
        setupKind:
          (p as { setupKind?: string }).setupKind === 'youtube' ? 'youtube' : 'classic',
        youtubeRewriteUrl:
          typeof (p as { youtubeRewriteUrl?: string }).youtubeRewriteUrl === 'string'
            ? (p as { youtubeRewriteUrl: string }).youtubeRewriteUrl
            : current.youtubeRewriteUrl || '',
        youtubeSourceTitle:
          typeof (p as { youtubeSourceTitle?: string }).youtubeSourceTitle === 'string'
            ? (p as { youtubeSourceTitle: string }).youtubeSourceTitle
            : current.youtubeSourceTitle || '',
        youtubeSourceText:
          typeof (p as { youtubeSourceText?: string }).youtubeSourceText === 'string'
            ? (p as { youtubeSourceText: string }).youtubeSourceText
            : current.youtubeSourceText || '',
        youtubeSimilarityTarget: (() => {
          const n = Number(
            (p as { youtubeSimilarityTarget?: number }).youtubeSimilarityTarget ??
              current.youtubeSimilarityTarget ??
              80,
          );
          return Number.isFinite(n) ? Math.max(10, Math.min(100, Math.round(n))) : 80;
        })(),
        userRules: {
          forbidden_words:
            (p.userRules?.forbidden_words || '').trim() || current.userRules.forbidden_words,
          fatigue_words:
            (p.userRules?.fatigue_words || '').trim() || current.userRules.fatigue_words,
        },
        world_state: { ...current.world_state, ...(p.world_state || {}) },
        da_dien_ra_entities: {
          dia_diem: p.da_dien_ra_entities?.dia_diem ?? current.da_dien_ra_entities.dia_diem,
          vat_pham: p.da_dien_ra_entities?.vat_pham ?? current.da_dien_ra_entities.vat_pham,
          motifs: p.da_dien_ra_entities?.motifs ?? current.da_dien_ra_entities.motifs,
        },
        generatedAudioPaths: { ...current.generatedAudioPaths, ...(p.generatedAudioPaths || {}) },
        generatedPrompts: { ...current.generatedPrompts, ...(p.generatedPrompts || {}) },
        generatedPromptsAnalysis: {
          ...current.generatedPromptsAnalysis,
          ...(p.generatedPromptsAnalysis || {}),
        },
        generatedImages: { ...current.generatedImages, ...(p.generatedImages || {}) },
        generatedImageVariants: {
          ...current.generatedImageVariants,
          ...(p.generatedImageVariants || {}),
        },
        generatedVideos: { ...current.generatedVideos, ...(p.generatedVideos || {}) },
        generatedAssetDna: {
          ...(current.generatedAssetDna || {}),
          ...((p as { generatedAssetDna?: Record<string, unknown> }).generatedAssetDna ||
            {}),
        },
        projectUrls: { ...current.projectUrls, ...(p.projectUrls || {}) },
        nhan_vat_prompts: { ...current.nhan_vat_prompts, ...(p.nhan_vat_prompts || {}) },
        voiceCast: normalizeVoiceCast(
          (p as { voiceCast?: ProjectVoiceCast }).voiceCast ?? current.voiceCast,
        ),
        channels: (() => {
          const fromP = normalizeChannelsMap(
            (p as { channels?: Record<string, ChannelProfile> }).channels,
          );
          if (Object.keys(fromP).length) return fromP;
          return normalizeChannelsMap(current.channels) || current.channels;
        })(),
        activeChannelId:
          (p as { activeChannelId?: string }).activeChannelId ||
          current.activeChannelId,
        editorReviews: { ...current.editorReviews, ...(p.editorReviews || {}) },
        // Prefer non-empty secret fields from either side
        apiKey: p.apiKey || current.apiKey,
        apiKeys:
          Array.isArray(p.apiKeys) && p.apiKeys.length ? p.apiKeys : current.apiKeys,
        openaiApiKey: p.openaiApiKey || current.openaiApiKey,
        openaiApiKeys:
          Array.isArray(p.openaiApiKeys) && p.openaiApiKeys.length
            ? p.openaiApiKeys
            : current.openaiApiKeys,
        grokApiKey: p.grokApiKey || current.grokApiKey,
        grokApiKeys:
          Array.isArray(p.grokApiKeys) && p.grokApiKeys.length
            ? p.grokApiKeys
            : current.grokApiKeys,
        claudeApiKey: (p as { claudeApiKey?: string }).claudeApiKey || current.claudeApiKey,
        claudeApiKeys:
          Array.isArray((p as { claudeApiKeys?: string[] }).claudeApiKeys) &&
          (p as { claudeApiKeys: string[] }).claudeApiKeys.length
            ? (p as { claudeApiKeys: string[] }).claudeApiKeys
            : current.claudeApiKeys,
        lumaApiKey: p.lumaApiKey || current.lumaApiKey,
        lumaApiKeys:
          Array.isArray(p.lumaApiKeys) && p.lumaApiKeys.length
            ? p.lumaApiKeys
            : current.lumaApiKeys,
        runwayApiKey: p.runwayApiKey || current.runwayApiKey,
        runwayApiKeys:
          Array.isArray(p.runwayApiKeys) && p.runwayApiKeys.length
            ? p.runwayApiKeys
            : current.runwayApiKeys,
        falaiApiKey: p.falaiApiKey || current.falaiApiKey,
        falaiApiKeys:
          Array.isArray(p.falaiApiKeys) && p.falaiApiKeys.length
            ? p.falaiApiKeys
            : current.falaiApiKeys,
        // imageApiKey / videoApiKey / aiMasterApiKey already set above (media block)
        googleStudioCookie: p.googleStudioCookie || current.googleStudioCookie,
        googleStudioCookies:
          Array.isArray(p.googleStudioCookies) && p.googleStudioCookies.length
            ? p.googleStudioCookies
            : current.googleStudioCookies,
        tiktokSessionIds: (() => {
          const fromP = Array.isArray((p as { tiktokSessionIds?: string[] }).tiktokSessionIds)
            ? (p as { tiktokSessionIds: string[] }).tiktokSessionIds.filter(Boolean)
            : [];
          if (fromP.length) return fromP;
          if (Array.isArray(current.tiktokSessionIds) && current.tiktokSessionIds.length) {
            return current.tiktokSessionIds;
          }
          // Migrate legacy single sessionid into multi list
          const legacy =
            (p as { ttsConfig?: { tiktokSessionId?: string } }).ttsConfig?.tiktokSessionId ||
            current.ttsConfig?.tiktokSessionId ||
            '';
          return legacy.trim() ? [legacy.trim()] : [];
        })(),
        // Keep UI unblocked; rehydrate may still replace fields from disk
        isHydrated: true,
      } as NovelStore;
    },
    partialize: (state: NovelStore) => ({
      giai_doan: state.giai_doan,
      setup: state.setup,
      ten_tac_pham: state.ten_tac_pham,
      dan_y_tong_the: state.dan_y_tong_the,
      nhan_vat: state.nhan_vat,
      danh_sach_chuong: state.danh_sach_chuong,
      chuong_dang_chon: state.chuong_dang_chon,
      projectResetEpoch: Number(state.projectResetEpoch) || 0,
      tab_hien_tai: state.tab_hien_tai,
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
      generatedAudioPaths: state.generatedAudioPaths,
      generatedPrompts: state.generatedPrompts,
      generatedPromptsAnalysis: state.generatedPromptsAnalysis,
      generatedImages: state.generatedImages,
      generatedImageVariants: state.generatedImageVariants,
      generatedVideos: state.generatedVideos,
      generatedAssetDna: state.generatedAssetDna || {},

      workspaceTab: state.workspaceTab,
      savePathTTS: state.savePathTTS,
      savePathImage: state.savePathImage,
      savePathCharacter: state.savePathCharacter,
      savePathVideo: state.savePathVideo,
      projectUrls: state.projectUrls,

      lorebook: state.lorebook,
      tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
      tri_nho_ngan_han: state.tri_nho_ngan_han,
      pipeline_step: state.pipeline_step,
      nhan_vat_prompts: state.nhan_vat_prompts,
      imageModel: state.imageModel,
      videoModel: state.videoModel,
      imageProvider: state.imageProvider,
      imageApiKey: state.imageApiKey,
      videoProvider: state.videoProvider,
      videoApiKey: state.videoApiKey,

      // Always persist owner unlimited entitlement
      is_vip: true,
      is_pro: true,
      credits: 999_999_999,
      ttsConfig: state.ttsConfig,
      voiceCast: state.voiceCast,
      youtubeSafe: state.youtubeSafe,
      humanEditFlags: state.humanEditFlags,
      chapterHooks: state.chapterHooks,
      setupKind: state.setupKind === 'youtube' ? 'youtube' : 'classic',
      youtubeRewriteUrl: state.youtubeRewriteUrl || '',
      youtubeSourceTitle: state.youtubeSourceTitle || '',
      youtubeSourceText: state.youtubeSourceText || '',
      youtubeSimilarityTarget:
        typeof state.youtubeSimilarityTarget === 'number'
          ? Math.max(10, Math.min(100, Math.round(state.youtubeSimilarityTarget)))
          : 80,
      useGpuAcceleration: state.useGpuAcceleration,

      aiMasterModel: state.aiMasterModel,
      aiMasterApiKey: state.aiMasterApiKey,
      visualDnaPrompt: state.visualDnaPrompt,
      mediaStylePreset: state.mediaStylePreset,
      imageAspectRatio: state.imageAspectRatio,
      imageCount: state.imageCount,
      videoAspectRatio: state.videoAspectRatio,
      videoDuration: state.videoDuration,
      wpm: state.wpm,
      secondsPerBeat: state.secondsPerBeat,
      userRules: state.userRules,
      editorReviews: state.editorReviews,
      cung_hien_tai: state.cung_hien_tai,
      da_dien_ra_entities: state.da_dien_ra_entities,
      world_state: state.world_state,
      current_beat_type: state.current_beat_type,
      activeChannelId: state.activeChannelId,
      channels: state.channels,
    }),
    onRehydrateStorage: () => (state?: NovelStore, error?: unknown) => {
      if (error) {
        console.error('[NovelStore] Không thể nạp dữ liệu đã lưu:', error);
      }

      // ALWAYS unstick UI first — even if channel bootstrap throws
      const forceHydrated = () => {
        try {
          storeAccess.setState({ isHydrated: true } as Partial<NovelStore>);
        } catch {
          /* ignore */
        }
        try {
          state?.setHydrated?.(true);
        } catch {
          /* ignore */
        }
      };
      forceHydrated();

      // Force unlimited entitlement after every rehydrate (owner local)
      try {
        state?.setVipStatus?.(true, true);
        state?.setCredits?.(999_999_999);
      } catch {
        // ignore
      }
      // Bootstrap / normalize multi-channel after rehydrate
      try {
        const live = storeAccess.getState();
        let channels = normalizeChannelsMap(live.channels);
        let activeChannelId = live.activeChannelId;
        if (!Object.keys(channels).length) {
          const boot = defaultChannelsBootstrap();
          // Seed first channel snapshot from current workspace
          const firstId = boot.activeChannelId;
          const bindable = bindableFromState(live);
          channels = {
            [firstId]: {
              ...boot.channels[firstId],
              projectSnapshot: captureProjectSnapshot(bindable),
              narratorVoiceId:
                live.ttsConfig?.voice || boot.channels[firstId].narratorVoiceId,
              ttsPlatform:
                live.ttsConfig?.platform || boot.channels[firstId].ttsPlatform,
              visualDna: live.visualDnaPrompt || '',
              aspectRatio:
                (live.imageAspectRatio as ChannelProfile['aspectRatio']) ||
                '16:9',
              outputDna: captureOutputDnaFromState(bindable),
              ttsDna: captureTtsDnaFromConfig(live.ttsConfig),
            },
          };
          activeChannelId = firstId;
        } else if (!channels[activeChannelId]) {
          activeChannelId = Object.keys(channels)[0];
        }
        storeAccess.setState({ channels, activeChannelId, isHydrated: true });
      } catch (e) {
        console.warn('[NovelStore] channel bootstrap skipped', e);
        forceHydrated();
      }

      // After rehydrate, force durable multi-path snapshot (never block UI)
      if (typeof window !== 'undefined') {
        queueMicrotask(() => {
          try {
            const live = storeAccess.getState();
            if (!live.is_pro || !live.is_vip || (live.credits ?? 0) < 999_999_999) {
              live.setVipStatus?.(true, true);
              live.setCredits?.(999_999_999);
            }
            syncLocalStoreToDurable();
          } catch {
            // ignore
          }
          forceHydrated();
        });
      }
    },
  };
}
