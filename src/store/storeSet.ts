import type { NovelStore } from './novelTypes';

export type StoreSet = (
  partial:
    | Partial<NovelStore>
    | NovelStore
    | ((state: NovelStore) => Partial<NovelStore> | NovelStore),
  replace?: false,
) => void;

export type StoreGet = () => NovelStore;
