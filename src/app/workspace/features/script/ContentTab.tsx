'use client';

import React, { useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { parseScenes } from '../../utils/stringUtils';
import SceneCard from './SceneCard';
import EditorPanel from './EditorPanel';
import EmptyWorkspaceHint from './EmptyWorkspaceHint';
import YoutubeSafeChecklist from '../youtube/YoutubeSafeChecklist';

import {
  YOUTUBE_HOOK_SCENE_INDEX,
  migrateHookAssetKeys,
} from '@/lib/youtubeSafe';

interface ContentTabProps {
  isStreaming: boolean;
  streamText: string;
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handleRewriteScene: (idx: number) => Promise<void>;
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
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: { [sceneIndex: number]: boolean };
  generatingTTS: { [sceneIndex: number]: boolean };
  ttsProgress: { [sceneIndex: number]: number };
  ttsStatus?: { [sceneIndex: number]: string };
  generatingPrompt: { [sceneIndex: number]: boolean };
  regeneratingSinglePrompt: Record<string, boolean>;
  generatingImage: Record<string, boolean>;
  generatingVideo: Record<string, boolean>;
  onImageZoom: (url: string) => void;
}

export default function ContentTab({
  isStreaming,
  streamText,
  handleSceneChange,
  handleCopyScene,
  handleExpandScene,
  handleRewriteScene,
  handlePlayTTS,
  handleStopTTS,
  handleGenerateTTS,
  handleGenerateImagePrompt,
  handleRegenPrompt,
  handleWriteChapter,
  handleIntervene,
  handleReviseFromReview,
  handleGenerateImage,
  handleGenerateAllImages,
  handleGenerateVideo,
  handleGenerateAllVideos,
  isPlayingTTS,
  generatingTTS,
  ttsProgress,
  ttsStatus = {},
  generatingPrompt,
  regeneratingSinglePrompt,
  generatingImage,
  generatingVideo,
  onImageZoom,
}: ContentTabProps) {
  const store = useNovelStore();
  const currentChapter = store.danh_sach_chuong.find(
    (c) => c.so_chuong === store.chuong_dang_chon,
  );
  const HOOK = YOUTUBE_HOOK_SCENE_INDEX;

  // One-shot: migrate legacy Hook assets (sceneIndex -1 → 990)
  useEffect(() => {
    if (!store.isHydrated) return;
    migrateHookAssetKeys(store);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydrate
  }, [store.isHydrated]);

  if (isStreaming) {
    return (
      <div className="flex flex-col">
        <div className="whitespace-pre-line bg-zinc-950/30 border border-zinc-900/50 rounded-lg p-6 text-md leading-loose font-sans">
          {streamText}
          <span className="inline-block h-4 w-2 bg-amber-500 animate-blink ml-1">▋</span>
        </div>

      </div>
    );
  }

  if (currentChapter?.noi_dung) {
    const scenes = parseScenes(currentChapter.noi_dung);
    // scroll-mt khớp 2 hàng toolbar (~88px), tránh đè header
    const scrollMt = 'scroll-mt-24';
    return (
      <div className="flex flex-col gap-4 w-full min-w-0">
        <YoutubeSafeChecklist />

        {/* Hook / Cold Open (~30s) — full SceneCard parity (TTS · Prompt Studio · Ảnh · Video) */}
        <div id="scene-card-container-hook" className={`${scrollMt} w-full min-w-0`}>
          <SceneCard
            scene={{
              title: 'MỞ ĐẦU / HOOK (~30s)',
              content: store.chapterHooks?.[store.chuong_dang_chon]?.hook || '',
            }}
            sceneIndex={HOOK}
            handleSceneChange={(idx, content) => {
              if (idx === HOOK) {
                store.setChapterHook(store.chuong_dang_chon, { hook: content });
              } else {
                handleSceneChange(idx, content);
              }
            }}
            handleCopyScene={handleCopyScene}
            handleExpandScene={handleExpandScene}
            handleRewriteScene={handleRewriteScene}
            handlePlayTTS={handlePlayTTS}
            handleStopTTS={handleStopTTS}
            handleGenerateTTS={handleGenerateTTS}
            handleGenerateImagePrompt={handleGenerateImagePrompt}
            handleRegenPrompt={handleRegenPrompt}
            handleGenerateImage={handleGenerateImage}
            handleGenerateAllImages={handleGenerateAllImages}
            handleGenerateVideo={handleGenerateVideo}
            handleGenerateAllVideos={handleGenerateAllVideos}
            isPlayingTTS={!!isPlayingTTS[HOOK]}
            generatingTTS={!!generatingTTS[HOOK]}
            ttsProgress={ttsProgress[HOOK] || 0}
            ttsStatus={ttsStatus[HOOK] || ''}
            generatingPrompt={!!generatingPrompt[HOOK]}
            regeneratingSinglePrompt={regeneratingSinglePrompt}
            generatingImage={generatingImage}
            generatingVideo={generatingVideo}
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
              handlePlayTTS={handlePlayTTS}
              handleStopTTS={handleStopTTS}
              handleGenerateTTS={handleGenerateTTS}
              handleGenerateImagePrompt={handleGenerateImagePrompt}
              handleRegenPrompt={handleRegenPrompt}
              handleGenerateImage={handleGenerateImage}
              handleGenerateAllImages={handleGenerateAllImages}
              handleGenerateVideo={handleGenerateVideo}
              handleGenerateAllVideos={handleGenerateAllVideos}
              isPlayingTTS={!!isPlayingTTS[idx]}
              generatingTTS={!!generatingTTS[idx]}
              ttsProgress={ttsProgress[idx] || 0}
              ttsStatus={ttsStatus[idx] || ''}
              generatingPrompt={!!generatingPrompt[idx]}
              regeneratingSinglePrompt={regeneratingSinglePrompt}
              generatingImage={generatingImage}
              generatingVideo={generatingVideo}
              onImageZoom={onImageZoom}
            />
          </div>
        ))}

        {/* Sticky editor fail/polish banner */}
        {(() => {
          const rev = store.editorReviews?.[store.chuong_dang_chon] as
            | { verdict?: string; summary?: string }
            | undefined;
          const v = (rev?.verdict || '').toLowerCase();
          if (!v || v === 'accept' || v === 'pass' || v === 'ok') return null;
          return (
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
                  disabled={store.dang_tai}
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
          );
        })()}

        <div id="editor-panel-root">
          <EditorPanel
            chapterIndex={store.chuong_dang_chon}
            isRewriting={store.dang_tai}
            onRevise={() => {
              void (handleReviseFromReview
                ? handleReviseFromReview()
                : handleWriteChapter(false));
            }}
            onFullRewrite={() => {
              if (
                confirm(
                  '⚠️ Viết lại từ đầu sẽ xóa kịch bản và media (audio/ảnh/video/prompt) của chương này. Tiếp tục?',
                )
              ) {
                void handleWriteChapter(true);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // Empty chapter: one CTA only (EmptyWorkspaceHint). Historical duplicate
  // "Viết chương" + "Sinh Chi Tiết Chương" both called handleWriteChapter.
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
