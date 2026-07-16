/**
 * Pure helpers for useTTSActions — credentials + default voice fill.
 * Giữ hook file gọn, logic thuần tách riêng.
 */
import type { useNovelStore } from '@/store/useNovelStore';
import { sceneAssetKey } from '@/contracts';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';
import { parseScenes } from '../utils/stringUtils';

export type NovelStoreSnapshot = ReturnType<typeof useNovelStore.getState>;

export interface TtsSceneJob {
  sceneIndex: number;
  text: string;
  title: string;
}

/** @see contracts/keys.sceneAssetKey — do not invent parallel formats */
export function getGeneratedAudioAssetKey(chapterNumber: number, sceneIndex: number) {
  return sceneAssetKey(chapterNumber, sceneIndex);
}

export function hasGeneratedAudio(
  state: NovelStoreSnapshot,
  chapterNumber: number,
  sceneIndex: number,
) {
  const assetKey = getGeneratedAudioAssetKey(chapterNumber, sceneIndex);
  const audio = state.generatedAudioPaths?.[assetKey];
  return !!(audio?.path && Number(audio.duration) > 0);
}

export function buildChapterTtsJobs({
  chapterText,
  hook,
  includeHook = true,
}: {
  chapterText?: string;
  hook?: string;
  includeHook?: boolean;
}): TtsSceneJob[] {
  const jobs: TtsSceneJob[] = [];
  const cleanHook = hook?.trim() || '';

  if (includeHook && cleanHook) {
    jobs.push({
      sceneIndex: YOUTUBE_HOOK_SCENE_INDEX,
      text: cleanHook,
      title: 'Hook',
    });
  }

  parseScenes(chapterText || '').forEach((scene, idx) => {
    if (scene.content?.trim()) {
      jobs.push({
        sceneIndex: idx,
        text: scene.content,
        title: scene.title || `Cảnh ${idx + 1}`,
      });
    }
  });

  return jobs;
}

export function summarizeChapterTtsResult(
  chapterNumber: number,
  result: { ok: number; fail: number; skipped: number; errors?: string[] },
) {
  return (
    `Xong ch.${chapterNumber}: OK ${result.ok} · lỗi ${result.fail} · bỏ qua ${result.skipped}` +
    (result.errors?.[0] ? ` · ${result.errors[0]}` : '')
  );
}

export function getTTSApiCredentials(state: NovelStoreSnapshot) {
  if (state.ttsConfig.platform === 'openai_tts') {
    const apiKeys = state.openaiApiKeys?.length
      ? state.openaiApiKeys
      : state.openaiApiKey
        ? [state.openaiApiKey]
        : [];
    return { apiKeys, apiKey: state.openaiApiKey || '' };
  }

  const apiKeys = state.apiKeys?.length
    ? state.apiKeys
    : state.apiKey
      ? [state.apiKey]
      : [];
  return { apiKeys, apiKey: state.apiKey || '' };
}

/**
 * Voice must be selected explicitly in TTS Config.
 */
export function resolveDefaultTtsVoice(state: NovelStoreSnapshot): {
  voice: string;
  autoFilled: boolean;
} {
  const current = (state.ttsConfig?.voice || '').trim();
  if (current) return { voice: current, autoFilled: false };

  const platform = (state.ttsConfig?.platform || '').trim() || '(chua chon platform)';
  throw new Error(
    `Chua chon voice TTS cho platform "${platform}". App khong tu gan voice.`,
  );
}

export interface SceneAutomationOptions {
  chapterNumber?: number;
  silent?: boolean;
  /** Skip YouTube editor gate (automation / force) */
  bypassYoutubeGate?: boolean;
  /** Skip credit deduct (chapter batch already counted) */
  skipCredit?: boolean;
  /** Force full multi regen (ignore segment resume cache) */
  forceFullMulti?: boolean;
  /** Skip cast preflight confirm */
  skipPreflight?: boolean;
}

export interface ChapterTTSOptions {
  includeHook?: boolean;
  /** Skip scenes that already have audioPath */
  skipExisting?: boolean;
  /** Only re-run scenes recorded as failed in last chapter batch */
  onlyFailed?: boolean;
  /** Force re-gen even if audio exists (overrides skipExisting) */
  force?: boolean;
  silent?: boolean;
  /** Skip YouTube editor hard-block (user confirmed) */
  bypassYoutubeGate?: boolean;
}
