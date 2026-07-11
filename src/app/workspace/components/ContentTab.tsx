'use client';

import React, { useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { FileText, Sparkles } from 'lucide-react';
import { parseScenes } from '../utils/stringUtils';
import SceneCard from './SceneCard';
import EditorPanel from './EditorPanel';
import YoutubeSafeChecklist from './YoutubeSafeChecklist';
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
  chapterTtsRunning?: boolean;
  chapterTtsProgress?: number;
  chapterTtsStatus?: string;
  handleGenerateChapterTTS?: (opts?: {
    includeHook?: boolean;
    skipExisting?: boolean;
    onlyFailed?: boolean;
    silent?: boolean;
  }) => Promise<{ ok: number; fail: number; skipped: number }>;
  handleStopChapterTTS?: () => void;
  handleChapterCastPreflight?: () => Promise<string | null> | string | null;
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
  chapterTtsRunning = false,
  chapterTtsProgress = 0,
  chapterTtsStatus = '',
  handleGenerateChapterTTS,
  handleStopChapterTTS,
  handleChapterCastPreflight,
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

        {/* Chapter-level multi TTS */}
        {handleGenerateChapterTTS && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900/40 bg-amber-950/15 px-3 py-2">
            <button
              type="button"
              disabled={chapterTtsRunning}
              onClick={() =>
                void handleGenerateChapterTTS({
                  includeHook: true,
                  skipExisting: true,
                })
              }
              className="h-8 rounded-lg bg-amber-500 px-3 text-[10px] font-bold uppercase tracking-wider text-black hover:bg-amber-400 disabled:opacity-40"
            >
              {chapterTtsRunning ? 'Đang gen chương…' : '🎙️ Gen TTS cả chương'}
            </button>
            <button
              type="button"
              disabled={chapterTtsRunning}
              onClick={() =>
                void handleGenerateChapterTTS({
                  includeHook: true,
                  skipExisting: false,
                  onlyFailed: true,
                })
              }
              className="h-8 rounded-lg border border-rose-800/50 bg-rose-950/20 px-3 text-[10px] font-bold uppercase tracking-wider text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
              title="Chỉ gen lại các cảnh lỗi từ lần batch trước (kèm multi-seg resume)"
            >
              ↺ Gen lại cảnh lỗi
            </button>
            {handleChapterCastPreflight ? (
              <button
                type="button"
                disabled={chapterTtsRunning}
                onClick={() => void handleChapterCastPreflight()}
                className="h-8 rounded-lg border border-sky-800/50 bg-sky-950/20 px-3 text-[10px] font-bold uppercase tracking-wider text-sky-300 hover:bg-sky-950/40 disabled:opacity-40"
                title="Dry-run: kiểm tra cast/multi/resume + dọn partial chết, không gen"
              >
                🔎 Kiểm tra cast
              </button>
            ) : null}
            {chapterTtsRunning && handleStopChapterTTS ? (
              <button
                type="button"
                onClick={handleStopChapterTTS}
                className="h-8 rounded-lg border border-rose-800/60 px-3 text-[10px] font-bold uppercase text-rose-400 hover:bg-rose-950/40"
              >
                Dừng
              </button>
            ) : null}
            <span className="text-[10px] text-zinc-500">
              Resume multi-seg · retry đoạn · bỏ qua đã có audio
            </span>
            {chapterTtsRunning || chapterTtsStatus ? (
              <div className="w-full space-y-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(2, chapterTtsProgress))}%`,
                    }}
                  />
                </div>
                {chapterTtsStatus ? (
                  <p className="text-[10px] text-amber-300/90 truncate">{chapterTtsStatus}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

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
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/20">
      <FileText className="h-12 w-12 text-zinc-700 mb-4" />
      <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider font-sans">
        Chương này chưa có nội dung văn học
      </h3>
      <p className="text-xs text-zinc-600 mt-1 mb-5 max-w-xs font-sans">
        Bấm &ldquo;Sinh Chi Tiết Chương&rdquo; — tự bù Cổng Từ, commit bộ nhớ, chấm Editor 7 chiều,
        auto rewrite/polish (YouTube-safe), rồi checklist trước khi TTS.
      </p>
      <button
        type="button"
        disabled={store.dang_tai}
        onClick={() => handleWriteChapter()}
        className="flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black shadow hover:bg-amber-400 transition-colors font-sans cursor-pointer animate-pulse"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Sinh Chi Tiết Chương {store.chuong_dang_chon}
      </button>
    </div>
  );
}
