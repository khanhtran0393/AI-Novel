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

// Safety: never leave UI stuck on "Đang nạp..." if async rehydrate hangs
if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const state = useNovelStore.getState();
      if (!state.isHydrated) {
        console.warn('[NovelStore] Ép isHydrated=true sau timeout rehydrate.');
        state.setHydrated(true);
      }
    } catch {
      // ignore
    }
  }, 4000);
}
