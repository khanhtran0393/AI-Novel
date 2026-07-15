import { sceneAssetKey } from '@/contracts';

/** Special sceneIndex for Hook ~30s assets (TTS / prompts / images) */
export const YOUTUBE_HOOK_SCENE_INDEX = 990;

/**
 * Dedicated sceneIndex for YouTube thumbnail still (Thumb prompt EN).
 * Asset key: imageAssetKey(chapter, YOUTUBE_THUMB_SCENE_INDEX, 0)
 */
export const YOUTUBE_THUMB_SCENE_INDEX = 991;

/** Legacy sceneIndex used before migration to YOUTUBE_HOOK_SCENE_INDEX */
export const LEGACY_HOOK_SCENE_INDEX = -1;

/** Default cold-open duration (seconds) when Hook has no TTS yet */
export const YOUTUBE_HOOK_DEFAULT_DURATION_SEC = 30;

/** Prompt/asset label: hook-01 for Hook, thumb-01 for thumbnail, c1-01 for normal scenes */
export function scenePromptCode(sceneIndex: number, promptIndex: number): string {
  const pad = String(promptIndex + 1).padStart(2, '0');
  if (sceneIndex === YOUTUBE_HOOK_SCENE_INDEX || sceneIndex === LEGACY_HOOK_SCENE_INDEX) {
    return `hook-${pad}`;
  }
  if (sceneIndex === YOUTUBE_THUMB_SCENE_INDEX) {
    return `thumb-${pad}`;
  }
  return `c${sceneIndex + 1}-${pad}`;
}

export function isHookSceneIndex(sceneIndex: number): boolean {
  return sceneIndex === YOUTUBE_HOOK_SCENE_INDEX || sceneIndex === LEGACY_HOOK_SCENE_INDEX;
}

type HookMigrationStore<TPrompt> = {
  chuong_dang_chon?: number;
  danh_sach_chuong?: { so_chuong: number }[];
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  generatedPrompts?: Record<string, TPrompt[]>;
  generatedImages?: Record<string, string>;
  generatedVideos?: Record<string, string>;
  projectUrls?: Record<string, string>;
  addGeneratedAudio?: (key: string, path: string, duration: number) => void;
  addGeneratedPrompts?: (key: string, prompts: TPrompt[]) => void;
  addGeneratedImage?: (key: string, path: string) => void;
  addGeneratedVideo?: (key: string, path: string) => void;
  addProjectUrl?: (key: string, url: string) => void;
};

/**
 * One-shot migrate store asset keys from chapter_-1* to chapter_990*
 * (safe: only copies when destination empty; keeps legacy keys).
 */
export function migrateHookAssetKeys<TPrompt = unknown>(
  store: HookMigrationStore<TPrompt>,
): number {
  const chapters = new Set<number>();
  if (store.chuong_dang_chon != null) chapters.add(store.chuong_dang_chon);
  for (const c of store.danh_sach_chuong || []) chapters.add(c.so_chuong);

  let migrated = 0;
  const oldIdx = LEGACY_HOOK_SCENE_INDEX;
  const newIdx = YOUTUBE_HOOK_SCENE_INDEX;

  for (const ch of chapters) {
    const oldKey = sceneAssetKey(ch, oldIdx);
    const newKey = sceneAssetKey(ch, newIdx);

    const audio = store.generatedAudioPaths?.[oldKey];
    if (audio?.path && !store.generatedAudioPaths?.[newKey]?.path && store.addGeneratedAudio) {
      store.addGeneratedAudio(newKey, audio.path, audio.duration || 0);
      migrated++;
    }

    const prompts = store.generatedPrompts?.[oldKey];
    const destPrompts = store.generatedPrompts?.[newKey];
    if (prompts?.length && !(destPrompts?.length) && store.addGeneratedPrompts) {
      store.addGeneratedPrompts(newKey, prompts);
      migrated++;
    }

    // Images / projectUrls / videos: keys like ch_-1_0 or ch_-1_0_video
    const prefixOld = `${sceneAssetKey(ch, oldIdx)}_`;
    const prefixNew = `${sceneAssetKey(ch, newIdx)}_`;

    for (const [k, v] of Object.entries(store.generatedImages || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.generatedImages?.[dest] && store.addGeneratedImage) {
        store.addGeneratedImage(dest, v);
        migrated++;
      }
    }

    for (const [k, v] of Object.entries(store.generatedVideos || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.generatedVideos?.[dest] && store.addGeneratedVideo) {
        store.addGeneratedVideo(dest, v);
        migrated++;
      }
    }

    for (const [k, v] of Object.entries(store.projectUrls || {})) {
      if (!k.startsWith(prefixOld) || !v) continue;
      const dest = prefixNew + k.slice(prefixOld.length);
      if (!store.projectUrls?.[dest] && store.addProjectUrl) {
        store.addProjectUrl(dest, v);
        migrated++;
      }
    }
  }

  return migrated;
}
