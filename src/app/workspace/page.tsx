'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

// Import modular UI subcomponents
import Header from './components/Header';
import SetupPhase from './components/SetupPhase';
import Sidebar from './components/Sidebar';
import ContentTab from './components/ContentTab';
import AINovelDashboard from './components/AINovelDashboard';

// Import custom business logic hooks modules
import { useSetupActions } from './hooks/useSetupActions';
import { useWriteChapter } from './hooks/useWriteChapter';
import { useSceneActions } from './hooks/useSceneActions';
import { useTTSActions } from './hooks/useTTSActions';
import { useImagePromptActions } from './hooks/useImagePromptActions';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useFolderActions } from './hooks/useFolderActions';
import { useProjectActions } from './hooks/useProjectActions';

// Import các tiện ích xử lý chuỗi
import { parseScenes, getWordCount } from './utils/stringUtils';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';

export default function Workspace() {
  const store = useNovelStore();
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // 8 Custom React Hooks để quản lý toàn bộ các hành động mượt mà theo mô-đun
  const {
    promptError,
    setPromptError,
    isGeneratingIdea,
    handleRandomTemplate,
    handleGenerateOutline
  } = useSetupActions();

  const {
    isStreaming,
    streamText,
    handleWriteChapter,
    handleIntervene,
    handleReviseFromReview,
    retryMemoryCommit,
  } = useWriteChapter(setPromptError);

  const {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene,
    handleRewriteScene
  } = useSceneActions(streamText);

  const {
    isPlayingTTS,
    generatingTTS,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    handleGenerateChapterTTS,
    handleStopChapterTTS,
    handleChapterCastPreflight,
    ttsProgress,
    ttsStatus,
    chapterTtsRunning,
    chapterTtsProgress,
    chapterTtsStatus,
  } = useTTSActions();

  const {
    generatingPrompt,
    regeneratingSinglePrompt,
    generatingImage,
    generatingVideo,
    handleGenerateImagePrompt,
    handleRegenPrompt,
    handleGenerateImage,
    handleGenerateAllImages,
    handleGenerateVideo,
    handleGenerateAllVideos
  } = useImagePromptActions();



  const {
    handleExportTxt
  } = useProjectActions(streamText);

  // Điều hướng Pagination chuyển Chương
  const handlePrevChapter = () => {
    if (store.chuong_dang_chon > 1) {
      store.selectChuong(store.chuong_dang_chon - 1);
    }
  };

  const handleNextChapter = () => {
    if (store.chuong_dang_chon < store.danh_sach_chuong.length) {
      store.selectChuong(store.chuong_dang_chon + 1);
    }
  };

  // Trả về Loading Screen nếu Zustand chưa hydrate
  if (!store.isHydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black font-sans text-amber-500">
        <div className="relative h-16 w-16 animate-spin rounded-full border-4 border-amber-950 border-t-amber-500"></div>
        <p className="mt-4 text-sm tracking-widest text-zinc-400 uppercase">Đang nạp trạng thái bộ nhớ...</p>
      </div>
    );
  }

  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
  const wordsCount = getWordCount(currentChapter?.noi_dung || '');
  const targetWords = store.setup.so_tu_chuong || 4250;
  // % đúng tỉ lệ (có thể >100% khi vượt chỉ tiêu) — không ép trần 100
  const progressPercent =
    targetWords > 0 ? Math.round((wordsCount / targetWords) * 100) : 0;

  // Tính toán thống kê hình ảnh chương hiện tại
  const activeChapterNum = store.chuong_dang_chon;
  let totalPromptsCount = 0;
  let successImagesCount = 0;

  const scenesList = currentChapter ? parseScenes(currentChapter.noi_dung) : [];
  // Include Hook (990) + normal scenes in image progress
  const sceneIndicesForStats = [YOUTUBE_HOOK_SCENE_INDEX, ...scenesList.map((_, i) => i)];
  sceneIndicesForStats.forEach((sceneIdx) => {
    const assetKey = `${activeChapterNum}_${sceneIdx}`;
    const prompts = store.generatedPrompts[assetKey] || [];
    totalPromptsCount += prompts.length;

    prompts.forEach((_, promptIdx) => {
      const imageKey = `${activeChapterNum}_${sceneIdx}_${promptIdx}`;
      if (store.generatedImages?.[imageKey]) {
        successImagesCount++;
      }
    });
  });

  const failedImagesCount = totalPromptsCount - successImagesCount;

  return (
    <div className="flex h-screen max-h-screen overflow-hidden flex-col bg-black text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* 1. HEADER CHUNG CAO CẤP */}
      <Header />

      {/* GIAI ĐOẠN 1: MÀN HÌNH SETUP THAM SỐ */}
      {store.giai_doan === 1 && (
        <SetupPhase
          promptError={promptError}
          isGeneratingIdea={isGeneratingIdea}
          handleRandomTemplate={handleRandomTemplate}
          handleGenerateOutline={handleGenerateOutline}
        />
      )}

      {/* GIAI ĐOẠN 2: WORKSPACE CHÍNH (Layout 2 cột) */}
      {store.giai_doan === 2 && (
        <main className="flex flex-1 overflow-hidden">
          {/* CỘT TRÁI: SIDEBAR ĐIỀU HƯỚNG & DÀN Ý */}
          <Sidebar
            handleWriteChapter={handleWriteChapter}
            isStreaming={isStreaming}
            onImageZoom={setZoomImageUrl}
          />

          {/* CỘT PHẢI: KHÔNG GIAN SOẠN THẢO */}
          <section className="flex flex-1 flex-col bg-black overflow-hidden min-w-0">
            {/* Hàng 1: 1 dòng gọn — không vỡ / không dính chữ */}
            <div className="shrink-0 border-b border-zinc-900 bg-zinc-950 px-3 sm:px-4 h-11 flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wide shrink-0 whitespace-nowrap">
                {store.workspaceTab === 'script' ? '📝 Kịch Bản Làm Việc' : '🤖 AI Novel Engine'}
              </span>

              {store.workspaceTab === 'script' && currentChapter && (
                <>
                  <span className="text-zinc-800 shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  {/* Cổng từ: một chuỗi liền, có khoảng trắng rõ */}
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 ${
                      progressPercent >= 92
                        ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
                        : 'border-amber-900/50 bg-amber-950/30 text-amber-400'
                    }`}
                    title={`Tối thiểu ${Math.round(targetWords * 0.92)} từ (92%)`}
                  >
                    Cổng từ {wordsCount}/{targetWords} · {progressPercent}%
                  </span>
                  {/* Ảnh: một pill, không xuống dòng từng ký tự */}
                  <span
                    className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 text-zinc-300"
                    title={`Sinh ảnh chương ${activeChapterNum}`}
                  >
                    Ảnh {successImagesCount}✓/{failedImagesCount}✗ ({totalPromptsCount})
                  </span>
                </>
              )}

              <div className="flex-1 min-w-0" />

              {store.workspaceTab === 'script' && (
                <div className="inline-flex items-center gap-1 shrink-0">
                  <div className="inline-flex items-center rounded border border-zinc-800 bg-black/50 h-7">
                    <button
                      type="button"
                      disabled={store.chuong_dang_chon <= 1}
                      onClick={handlePrevChapter}
                      className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 px-1 h-full"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[10px] font-bold text-zinc-400 px-1.5 tabular-nums whitespace-nowrap">
                      Ch. {store.chuong_dang_chon}/{store.danh_sach_chuong.length}
                    </span>
                    <button
                      type="button"
                      disabled={store.chuong_dang_chon >= store.danh_sach_chuong.length}
                      onClick={handleNextChapter}
                      className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 px-1 h-full"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportTxt}
                    className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 h-7 text-[10px] font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white"
                  >
                    <Download className="h-3 w-3" />
                    .txt
                  </button>
                </div>
              )}
            </div>

            {/* AINOVEL DASHBOARD */}
            {store.workspaceTab === 'ainovel' && (
              <div className="flex-1 overflow-y-auto bg-black min-h-0">
                <AINovelDashboard />
              </div>
            )}

            {/* KỊCH BẢN WORKSPACE */}
            {store.workspaceTab === 'script' && (
              <>
                {/* Hàng 2: tên series + cuộn cảnh + viết lại toàn bộ chương (phải) */}
                {currentChapter && (
                  <div className="shrink-0 border-b border-zinc-900/80 bg-zinc-950/95 px-3 sm:px-4 py-1.5 flex items-center gap-2 min-w-0 z-10">
                    <span
                      className="text-[10px] font-semibold text-zinc-500 truncate max-w-[24%] sm:max-w-[32%] shrink min-w-0"
                      title={store.ten_tac_pham}
                    >
                      {store.ten_tac_pham || '—'}
                    </span>
                    <div className="h-3 w-px bg-zinc-800 shrink-0" />
                    <div className="flex flex-1 items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin py-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          document
                            .getElementById('scene-card-container-hook')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="shrink-0 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-900/40 text-[10px] font-bold hover:bg-amber-500/20"
                      >
                        Hook
                      </button>
                      {scenesList.map((sc, idx) => {
                        let shortTitle = `C${idx + 1}`;
                        if (sc.title.toUpperCase().includes('CẢNH')) {
                          const match = sc.title.match(/CẢNH\s+(\d+)/i);
                          if (match) shortTitle = `C${match[1]}`;
                        } else if (sc.title.toUpperCase() === 'MỞ ĐẦU') {
                          shortTitle = 'Mở';
                        }
                        return (
                          <button
                            key={idx}
                            type="button"
                            title={sc.title}
                            onClick={() => {
                              document
                                .getElementById(`scene-card-container-${idx}`)
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            className="shrink-0 px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 hover:text-amber-400 border border-zinc-800 text-[10px] font-bold"
                          >
                            {shortTitle}
                          </button>
                        );
                      })}
                    </div>
                    {store.memoryPipelineStatus?.status === 'failed' &&
                      store.memoryPipelineStatus.chapter === activeChapterNum && (
                        <button
                          type="button"
                          onClick={() => void retryMemoryCommit(activeChapterNum)}
                          className="shrink-0 text-[9px] font-bold text-red-400 hover:text-red-300"
                          title={store.memoryPipelineStatus.message}
                        >
                          ⚠ Memory
                        </button>
                      )}
                    <button
                      type="button"
                      disabled={store.dang_tai || isStreaming}
                      title="Viết lại toàn bộ chương này từ đầu (xóa kịch bản + media chương)"
                      onClick={() => {
                        if (
                          !confirm(
                            `⚠️ Viết lại toàn bộ Chương ${store.chuong_dang_chon}?\nSẽ xóa kịch bản và media (audio/ảnh/video/prompt) của chương này.`,
                          )
                        ) {
                          return;
                        }
                        void handleWriteChapter(true);
                      }}
                      className="ml-auto shrink-0 inline-flex items-center gap-1 rounded border border-red-900/50 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-300 hover:bg-red-500/25 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      Viết lại toàn bộ chương
                    </button>
                  </div>
                )}

                {/* Vùng cuộn nội dung — min-h-0 để không tràn đè header */}
                <div className="flex-1 min-h-0 overflow-y-auto bg-black">
                  <div className="p-3 sm:p-5 text-zinc-300 font-sans text-sm">
                    <ContentTab
                      isStreaming={isStreaming}
                      streamText={streamText}
                      handleSceneChange={handleSceneChange}
                      handleCopyScene={handleCopyScene}
                      handleExpandScene={handleExpandScene}
                      handleRewriteScene={handleRewriteScene}
                      handlePlayTTS={handlePlayTTS}
                      handleStopTTS={handleStopTTS}
                      handleGenerateTTS={handleGenerateTTS}
                      handleGenerateImagePrompt={handleGenerateImagePrompt}
                      handleRegenPrompt={handleRegenPrompt}
                      handleWriteChapter={handleWriteChapter}
                      handleIntervene={handleIntervene}
                      handleReviseFromReview={handleReviseFromReview}
                      handleGenerateImage={handleGenerateImage}
                      handleGenerateAllImages={handleGenerateAllImages}
                      handleGenerateVideo={handleGenerateVideo}
                      handleGenerateAllVideos={handleGenerateAllVideos}
                      isPlayingTTS={isPlayingTTS}
                      generatingTTS={generatingTTS}
                      ttsProgress={ttsProgress}
                      ttsStatus={ttsStatus}
                      chapterTtsRunning={chapterTtsRunning}
                      chapterTtsProgress={chapterTtsProgress}
                      chapterTtsStatus={chapterTtsStatus}
                      handleGenerateChapterTTS={handleGenerateChapterTTS}
                      handleStopChapterTTS={handleStopChapterTTS}
                      handleChapterCastPreflight={handleChapterCastPreflight}
                      generatingPrompt={generatingPrompt}
                      regeneratingSinglePrompt={regeneratingSinglePrompt}
                      generatingImage={generatingImage}
                      generatingVideo={generatingVideo}
                      onImageZoom={setZoomImageUrl}
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </main>
      )}

      {/* 3. LIGHTBOX PHÓNG TO ẢNH CAO CẤP */}
      {zoomImageUrl && (
        <div 
          onClick={() => setZoomImageUrl(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md cursor-zoom-out animate-in fade-in duration-200"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl(null)}
            className="fixed top-6 right-6 z-[110] h-12 w-12 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-amber-400 hover:scale-110 active:scale-95 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer text-xl font-bold shadow-[0_0_15px_rgba(0,0,0,0.5)] border-zinc-800/80"
            title="Đóng (Close)"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImageUrl}
            alt="Zoomed art"
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg border border-zinc-900 shadow-2xl animate-in zoom-in-95 duration-200 cursor-default"
          />
        </div>
      )}

    </div>
  );
}
