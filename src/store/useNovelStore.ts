import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { createChannelActions } from './channelActions';
import { createCredentialActions } from './credentialActions';
import { createMediaAssetActions } from './mediaAssetActions';
import { createStoryActions } from './storyActions';
import { createTtsCastActions } from './ttsCastActions';
import { INITIAL_STATE } from './novelInitialState';
import { createNovelStorePersistOptions } from './novelStorePersistence';
import { installDurableStoreFlushGuards } from './persistStorage';
import type { NovelStore } from './novelTypes';

export type {
  PromptAsset,
  Chuong,
  SetupData,
  TTSConfig,
  YoutubeSafeConfig,
  ChapterHookAsset,
  HumanEditFlag,
  NovelState,
  NovelActions,
  NovelStore,
  NhanVatProfile,
  NhanVatPromptsMap,
  ProjectVoiceCast,
  VoiceRole,
  ChannelProfile,
  ShipMode,
} from './novelTypes';

installDurableStoreFlushGuards();

export const useNovelStore: UseBoundStore<StoreApi<NovelStore>> = create<NovelStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,
      ...createStoryActions(set, get),
      ...createCredentialActions(set, get),
      ...createMediaAssetActions(set, get),
      ...createTtsCastActions(set, get),
      ...createChannelActions(set, get),
    }),
    createNovelStorePersistOptions({
      getState: (): NovelStore => useNovelStore.getState(),
      setState: (patch) => useNovelStore.setState(patch),
    }),
  ),
);

/**
 * Multi-stage failsafe: never leave UI on "Đang nạp trạng thái bộ nhớ..." forever.
 * Uses setState directly (works even if setHydrated missing / rehydrate hung).
 */
if (typeof window !== 'undefined') {
  const forceHydrated = (reason: string) => {
    try {
      const state = useNovelStore.getState();
      if (state.isHydrated) return;
      console.warn(`[NovelStore] force isHydrated=true (${reason})`);
      useNovelStore.setState({ isHydrated: true });
      try {
        state.setHydrated?.(true);
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  };

  // Do not force on microtask (would paint empty before localStorage rehydrate).
  // 4500ms matches the dualStorage HTTP fetch timeout of 4000ms.
  setTimeout(() => forceHydrated('4.5s-hard'), 4500);
}
