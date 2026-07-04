'use client';

import React, { useEffect, useState } from 'react';
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

export default function Workspace() {
  const store = useNovelStore();
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // Rehydrate store để đồng bộ localStorage trên client an toàn cho Next.js SSR
  useEffect(() => {
    const hydrate = async () => {
      await useNovelStore.persist.rehydrate();
      store.setHydrated(true);
    };
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    handleWriteChapter
  } = useWriteChapter(setPromptError);

  const {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene
  } = useSceneActions(streamText);

  const {
    isPlayingTTS,
    generatingTTS,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    ttsProgress
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
  const progressPercent = Math.min(100, Math.round((wordsCount / targetWords) * 100));

  // Tính toán thống kê hình ảnh chương hiện tại
  const activeChapterNum = store.chuong_dang_chon;
  let totalPromptsCount = 0;
  let successImagesCount = 0;

  const scenesList = currentChapter ? parseScenes(currentChapter.noi_dung) : [];
  scenesList.forEach((_, sceneIdx) => {
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

          {/* CỘT PHẢI: KHÔNG GIAN SOẠN THẢO VĂN BẢN */}
          <section className="flex flex-1 flex-col bg-black overflow-hidden">
            
            {/* Header Content Panel (chung hoặc riêng tùy ý) */}
            <div className="flex h-12 w-full items-center justify-between border-b border-zinc-900 bg-zinc-950 px-6 shrink-0">
              <div className="flex items-center gap-1 text-xs font-bold text-amber-500 uppercase tracking-widest">
                <span>
                  {store.workspaceTab === 'script' 
                    ? '📝 Kịch Bản Làm Việc (Working Script)' 
                    : '🤖 Sáng tác AI Novel (Engine)'}
                </span>
              </div>

              {/* Nút export (chỉ hiện bên script) */}
              {store.workspaceTab === 'script' && (
                <button
                  type="button"
                  onClick={handleExportTxt}
                  className="flex items-center gap-1.5 rounded border border-zinc-900 bg-zinc-900/60 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Tải Toàn Bộ (.txt)
                </button>
              )}
            </div>

            {/* AINOVEL DASHBOARD */}
            {store.workspaceTab === 'ainovel' && (
              <div className="flex-1 overflow-y-auto bg-black">
                <AINovelDashboard />
              </div>
            )}

            {/* KỊCH BẢN TTS WORKSPACE */}
            {store.workspaceTab === 'script' && (
              <>
                {/* Chapter Header Pagination */}
                {currentChapter && (
                  <div className="px-8 py-3 bg-zinc-950/90 border-b border-zinc-900/80 flex flex-col gap-2 shrink-0 z-20 backdrop-blur-md">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-lg font-bold text-zinc-100 tracking-wide font-sans m-0 flex items-center gap-2">
                        ✍️ {store.ten_tac_pham}
                      </h2>
                      
                      {/* Nút lật trang Chương trước / sau */}
                      <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded px-2.5 py-1 text-xs shrink-0 shadow-inner">
                        <button
                          type="button"
                          disabled={store.chuong_dang_chon <= 1}
                          onClick={handlePrevChapter}
                          className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30 cursor-pointer"
                        >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="font-bold text-zinc-400 select-none whitespace-nowrap font-sans">
                      Chương {store.chuong_dang_chon} / {store.danh_sach_chuong.length}
                    </span>
                    <button
                      type="button"
                      disabled={store.chuong_dang_chon >= store.danh_sach_chuong.length}
                      onClick={handleNextChapter}
                      className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30 cursor-pointer"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Dãy nút Cuộn nhanh đến các Cảnh - CỐ ĐỊNH TUYỆT ĐỐI KHÔNG TRÔI */}
            {currentChapter && scenesList.length > 0 && (
              <div className="px-8 py-2 bg-zinc-950/95 border-b border-zinc-900/60 backdrop-blur-md shrink-0 z-10">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1 font-sans">
                    Cuộn nhanh Cảnh:
                  </span>
                  {scenesList.map((sc, idx) => {
                    let shortTitle = sc.title;
                    if (sc.title.toUpperCase().includes('CẢNH')) {
                      const match = sc.title.match(/CẢNH\s+(\d+)/i);
                      if (match) {
                        shortTitle = `Cảnh ${match[1]}`;
                      }
                    } else if (sc.title.toUpperCase() === 'MỞ ĐẦU') {
                      shortTitle = 'Mở đầu';
                    } else if (sc.title.toUpperCase() === 'KỊCH BẢN') {
                      shortTitle = 'Kịch bản';
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`scene-card-container-${idx}`);
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-amber-400 border border-zinc-800/80 text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-[1.03] active:scale-95 animate-in fade-in slide-in-from-left-2 duration-150"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse"></span>
                        {shortTitle}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Box Nội Dung Soạn Thảo */}
            <div className="flex-1 overflow-y-auto bg-black flex flex-col">

              <div className="p-8 flex flex-col">
                <div className="prose prose-invert max-w-full text-zinc-300 leading-relaxed font-sans text-sm w-full">
                  
                  {/* 1. HIỆN THỊ THÔNG SỐ TỪ CẢ CHƯƠNG VÀ PROGRESS BAR */}
                  {currentChapter && (
                    <div className="mb-6 bg-zinc-950/60 border border-zinc-900/80 rounded-xl p-4 font-sans animate-in fade-in duration-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
                          <span className="text-zinc-400">Tiến Độ Cổng Từ (Word-Gate Progress)</span>
                          <span className={progressPercent >= 92 ? 'text-emerald-400' : 'text-amber-500'}>
                            {wordsCount} / {targetWords} từ ({progressPercent}%)
                          </span>
                        </div>
                        <div className="h-2.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/80">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              progressPercent >= 92 
                                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' 
                                : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                            }`}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        {progressPercent < 92 && (
                          <p className="text-[10px] text-zinc-500 italic mt-1.5 leading-normal">
                            * Gợi ý: Hãy nhấp &ldquo;Sinh phần tiếp theo&rdquo; để viết thêm các phân đoạn chi tiết nhằm vượt Cổng từ ({Math.round(targetWords * 0.92)} từ).
                          </p>
                        )}
                      </div>

                      <div className="border-t md:border-t-0 md:border-l border-zinc-900/80 pt-3 md:pt-0 md:pl-4 flex flex-col justify-center">
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-2">
                          <span className="text-zinc-400">Thống Kê Sinh Ảnh Chương {activeChapterNum}</span>
                          <span className="text-zinc-500">Tổng số: {totalPromptsCount}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-zinc-900/50 rounded-lg p-2.5 flex items-center justify-between border border-zinc-800/60">
                            <span className="text-[10px] text-zinc-500 font-bold uppercase">Thành công</span>
                            <span className="text-xs font-bold text-emerald-400">{successImagesCount} ảnh</span>
                          </div>
                          <div className="flex-1 bg-zinc-900/50 rounded-lg p-2.5 flex items-center justify-between border border-zinc-800/60">
                            <span className="text-[10px] text-zinc-500 font-bold uppercase">Lỗi / Chưa gen</span>
                            <span className="text-xs font-bold text-red-500">{failedImagesCount} ảnh</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2. CHƯƠNG TRÌNH PHÂN CẢNH VĂN HỌC BÀN LÀM VIỆC */}
                  <div className="space-y-4">
                    <ContentTab
                      isStreaming={isStreaming}
                      streamText={streamText}
                      handleSceneChange={handleSceneChange}
                      handleCopyScene={handleCopyScene}
                      handleExpandScene={handleExpandScene}
                      handlePlayTTS={handlePlayTTS}
                      handleStopTTS={handleStopTTS}
                      handleGenerateTTS={handleGenerateTTS}
                      handleGenerateImagePrompt={handleGenerateImagePrompt}
                      handleRegenPrompt={handleRegenPrompt}
                      handleWriteChapter={handleWriteChapter}
                      handleGenerateImage={handleGenerateImage}
                      handleGenerateAllImages={handleGenerateAllImages}
                      handleGenerateVideo={handleGenerateVideo}
                      handleGenerateAllVideos={handleGenerateAllVideos}
                      isPlayingTTS={isPlayingTTS}
                      generatingTTS={generatingTTS}
                      ttsProgress={ttsProgress}
                      generatingPrompt={generatingPrompt}
                      regeneratingSinglePrompt={regeneratingSinglePrompt}
                      generatingImage={generatingImage}
                      generatingVideo={generatingVideo}
                      onImageZoom={setZoomImageUrl}
                    />
                  </div>

                </div>
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
