'use client';

import React, { useEffect, useMemo } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectIsHydrated,
  selectChuongDangChon,
  selectCurrentChapterContent,
  selectCurrentHook,
  selectCurrentEditorReview,
} from '@/store/useNovelStoreSelectors';
import { parseScenes } from '../../utils/stringUtils';
import SceneCard from './SceneCard';
import EditorPanel from './EditorPanel';
import EmptyWorkspaceHint from './EmptyWorkspaceHint';
import YoutubeSafeChecklist from '../youtube/YoutubeSafeChecklist';
import { useStreamUi } from '../../modules/streamUiStore';

import {
  YOUTUBE_HOOK_SCENE_INDEX,
  migrateHookAssetKeys,
} from '@/lib/youtubeSafe';
import { appConfirm } from '@/lib/confirmDialog';

interface ContentTabProps {
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handleRewriteScene: (idx: number) => Promise<void>;
  isExpanding?: (idx: number) => boolean;
  isRewriting?: (idx: number) => boolean;
  handlePlayTTS: (text: string, sceneIndex: number, voice: string) => Promise<void>;
  handleStopTTS: () => void;
  handleGenerateTTS: (
    sceneText: string,
    sceneIndex: number,
    voice: string,
    targetDuration?: number,
    options?: { forceFullMulti?: boolean; silent?: boolean; bypassYoutubeGate?: boolean },
  ) => Promise<number | undefined>;
  handleGenerateImagePrompt: (
    sceneText: string,
    sceneIndex: number,
    duration: number,
  ) => Promise<void>;
  handleRegenPrompt: (
    sceneIndex: number,
    promptIndex: number,
    sentence: string,
    currentPrompt: string,
  ) => Promise<void>;
  handleWriteChapter: (overwrite?: boolean) => Promise<void>;
  handleIntervene: (text: string) => void;
  handleReviseFromReview?: () => Promise<void>;
  handleGenerateImage: (
    sceneIndex: number,
    promptIndex: number,
    prompt: string,
    sentence: string,
  ) => Promise<void>;
  handleGenerateAllImages: (sceneIndex: number) => Promise<void>;
  handleGenerateVideo: (
    sceneIndex: number,
    startPromptIndex: number,
    endPromptIndex: number,
    prompt: string,
  ) => Promise<void>;
  handleExtendVideo?: (sceneIndex: number, promptIndex: number) => Promise<void>;
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: { [sceneIndex: number]: boolean };
  generatingTTS: { [sceneIndex: number]: boolean };
  ttsProgress: { [sceneIndex: number]: number };
  ttsStatus?: { [sceneIndex: number]: string };
  generatingPrompt: { [sceneIndex: number]: boolean };
  regeneratingSinglePrompt: Record<string, boolean>;
  onImageZoom: (url: string) => void;
}

/** Only this leaf re-renders on typewriter ticks. */
function StreamingScriptView() {
  const streamText = useStreamUi((s) => s.streamText);
  return (
    <div className="flex flex-col">
      <div className="whitespace-pre-line bg-zinc-950/30 border border-zinc-900/50 rounded-lg p-6 text-md leading-loose font-sans">
        {streamText}
        <span className="inline-block h-4 w-2 bg-amber-500 animate-blink ml-1">▋</span>
      </div>
    </div>
  );
}

export default function ContentTab(props: ContentTabProps) {
  const isStreaming = useStreamUi((s) => s.isStreaming);
  const isHydrated = useNovelStore(selectIsHydrated);
  const chapterContent = useNovelStore(selectCurrentChapterContent);
  const chapterNum = useNovelStore(selectChuongDangChon);
  const hookContent = useNovelStore(selectCurrentHook);
  const editorReview = useNovelStore(selectCurrentEditorReview);
  const setChapterHook = useNovelStore((s) => s.setChapterHook);

  const {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene,
    handleRewriteScene,
    isExpanding,
    isRewriting,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    handleGenerateImagePrompt,
    handleRegenPrompt,
    handleWriteChapter,
    handleReviseFromReview,
    handleGenerateImage,
    handleGenerateAllImages,
    handleGenerateVideo,
    handleExtendVideo,
    handleGenerateAllVideos,
    isPlayingTTS,
    generatingTTS,
    ttsProgress,
    ttsStatus = {},
    generatingPrompt,
    regeneratingSinglePrompt,
    onImageZoom,
  } = props;

  const HOOK = YOUTUBE_HOOK_SCENE_INDEX;

  useEffect(() => {
    if (!isHydrated) return;
    migrateHookAssetKeys(useNovelStore.getState());
  }, [isHydrated]);

  const scenes = useMemo(
    () => (chapterContent ? parseScenes(chapterContent) : []),
    [chapterContent],
  );

  if (isStreaming) {
    return <StreamingScriptView />;
  }

  if (chapterContent) {
    const scrollMt = 'scroll-mt-24';
    const rev = editorReview as { verdict?: string; summary?: string } | undefined;
    const v = (rev?.verdict || '').toLowerCase();
    const showEditorBanner =
      Boolean(v) && v !== 'accept' && v !== 'pass' && v !== 'ok';

    return (
      <div className="flex flex-col gap-4 w-full min-w-0">
        <YoutubeSafeChecklist />

        <div id="scene-card-container-hook" className={`${scrollMt} w-full min-w-0`}>
          <SceneCard
            scene={{
              title: 'MỞ ĐẦU / HOOK (~30s)',
              content: hookContent,
            }}
            sceneIndex={HOOK}
            handleSceneChange={(idx, content) => {
              if (idx === HOOK) {
                setChapterHook(chapterNum, { hook: content });
              } else {
                handleSceneChange(idx, content);
              }
            }}
            handleCopyScene={handleCopyScene}
            handleExpandScene={handleExpandScene}
            handleRewriteScene={handleRewriteScene}
            expandingThis={isExpanding?.(HOOK)}
            rewritingThis={isRewriting?.(HOOK)}
            handlePlayTTS={handlePlayTTS}
            handleStopTTS={handleStopTTS}
            handleGenerateTTS={handleGenerateTTS}
            handleGenerateImagePrompt={handleGenerateImagePrompt}
            handleRegenPrompt={handleRegenPrompt}
            handleGenerateImage={handleGenerateImage}
            handleGenerateAllImages={handleGenerateAllImages}
            handleGenerateVideo={handleGenerateVideo}
            handleExtendVideo={handleExtendVideo}
            handleGenerateAllVideos={handleGenerateAllVideos}
            isPlayingTTS={!!isPlayingTTS[HOOK]}
            generatingTTS={!!generatingTTS[HOOK]}
            ttsProgress={ttsProgress[HOOK] || 0}
            ttsStatus={ttsStatus[HOOK] || ''}
            generatingPrompt={!!generatingPrompt[HOOK]}
            regeneratingSinglePrompt={regeneratingSinglePrompt}
            onImageZoom={onImageZoom}
          />
        </div>

        {scenes.map((scene, idx) => (
          <div
            key={idx}
            id={`scene-card-container-${idx}`}
            className={`${scrollMt} w-full min-w-0`}
          >
            <SceneCard
              scene={scene}
              sceneIndex={idx}
              handleSceneChange={handleSceneChange}
              handleCopyScene={handleCopyScene}
              handleExpandScene={handleExpandScene}
              handleRewriteScene={handleRewriteScene}
              expandingThis={isExpanding?.(idx)}
              rewritingThis={isRewriting?.(idx)}
              handlePlayTTS={handlePlayTTS}
              handleStopTTS={handleStopTTS}
              handleGenerateTTS={handleGenerateTTS}
              handleGenerateImagePrompt={handleGenerateImagePrompt}
              handleRegenPrompt={handleRegenPrompt}
              handleGenerateImage={handleGenerateImage}
              handleGenerateAllImages={handleGenerateAllImages}
              handleGenerateVideo={handleGenerateVideo}
              handleExtendVideo={handleExtendVideo}
              handleGenerateAllVideos={handleGenerateAllVideos}
              isPlayingTTS={!!isPlayingTTS[idx]}
              generatingTTS={!!generatingTTS[idx]}
              ttsProgress={ttsProgress[idx] || 0}
              ttsStatus={ttsStatus[idx] || ''}
              generatingPrompt={!!generatingPrompt[idx]}
              regeneratingSinglePrompt={regeneratingSinglePrompt}
              onImageZoom={onImageZoom}
            />
          </div>
        ))}

        {showEditorBanner ? (
          <div
            id="editor-review-banner"
            className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-900/50 bg-red-950/90 px-3 py-2 shadow-lg backdrop-blur-md"
          >
            <div className="min-w-0 text-[11px] text-red-200">
              <span className="font-bold uppercase">Editor: {rev?.verdict}</span>
              {rev?.summary ? (
                <span className="ml-2 text-red-300/80 line-clamp-1">
                  {rev.summary}
                </span>
              ) : null}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => {
                  document
                    .getElementById('editor-panel-root')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  void (handleReviseFromReview
                    ? handleReviseFromReview()
                    : handleWriteChapter(false));
                }}
                className="rounded bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase text-black hover:bg-amber-400 disabled:opacity-40"
              >
                Sửa theo nhận xét
              </button>
            </div>
          </div>
        ) : null}

        <div id="editor-panel-root">
          <EditorPanel
            chapterIndex={chapterNum}
            isRewriting={isStreaming}
            onRevise={() => {
              void (handleReviseFromReview
                ? handleReviseFromReview()
                : handleWriteChapter(false));
            }}
            onFullRewrite={() => {
              void (async () => {
                const ok = await appConfirm({
                  title: 'Viết lại chương',
                  message:
                    'Viết lại từ đầu sẽ xóa kịch bản và media của chương này.',
                  details: [
                    'Kịch bản / cảnh hiện tại',
                    'Audio · ảnh · video · prompt gắn chương',
                  ],
                  confirmLabel: 'Viết lại từ đầu',
                  cancelLabel: 'Giữ nguyên',
                  tone: 'danger',
                });
                if (ok) void handleWriteChapter(true);
              })();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <EmptyWorkspaceHint
        onWriteChapter={() => {
          void handleWriteChapter(false);
        }}
      />
    </div>
  );
}
