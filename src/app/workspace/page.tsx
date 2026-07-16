'use client';

import React, { useEffect, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { Download } from 'lucide-react';

/**
 * Workspace orchestrator — thin page.
 * UI layers: layouts → chrome → features/* → modules/hooks
 * @see ./ARCHITECTURE.md
 */
import Header from './chrome/Header';
import { AppShell } from './layouts';
import { SetupPhase, YoutubeSetupPhase, Sidebar, ContentTab } from './features/script';
import AINovelDashboard from './features/ainovel/AINovelDashboard';
import { ToastHost } from './shared';
import OnboardingBanner from './features/onboarding/OnboardingBanner';
import MediaDnaBanner from './features/media/MediaDnaBanner';
import FlowAutoBootstrap from './features/media/FlowAutoBootstrap';

import { useSetupActions } from './hooks/useSetupActions';
import { useWriteChapter } from './hooks/useWriteChapter';
import { useSceneActions } from './hooks/useSceneActions';
import { useTTSActions } from './hooks/useTTSActions';
import { useImagePromptActions } from './hooks/useImagePromptActions';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useFolderActions } from './hooks/useFolderActions';
import { useProjectActions } from './hooks/useProjectActions';

import { parseScenes, getWordCount } from './utils/stringUtils';
import { imageAssetKey, sceneAssetKey } from '@/contracts';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';
import { toast } from '@/lib/toastBus';

export default function Workspace() {
  const store = useNovelStore();
  // Primitive selector — guarantee re-render when Setup closes (giai_doan 1→2)
  const giaiDoan = useNovelStore((s) => s.giai_doan);
  const setupKind = useNovelStore((s) => s.setupKind);
  /**
   * Local latch: once user closes Setup this session, hide modal even if
   * late rehydrate restores disk giai_doan:1. Re-open from Sidebar sets
   * giai_doan 1 after we were on 2 → clear latch.
   */
  const [setupDismissed, setSetupDismissed] = useState(false);
  const prevGiaiDoanRef = React.useRef(giaiDoan);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const prev = prevGiaiDoanRef.current;
    prevGiaiDoanRef.current = giaiDoan;
    if (giaiDoan === 2) {
      setSetupDismissed(true);
      return;
    }
    // Explicit open Setup (Sidebar): 2 → 1
    if (prev === 2 && giaiDoan === 1) {
      setSetupDismissed(false);
    }
  }, [giaiDoan]);

  const showSetup = giaiDoan === 1 && !setupDismissed;

  const dismissSetup = () => {
    setSetupDismissed(true);
    useNovelStore.setState({ giai_doan: 2 });
    try {
      useNovelStore.getState().setGiaiDoan?.(2);
    } catch {
      /* ignore */
    }
  };

  // 8 Custom React Hooks để quản lý toàn bộ các hành động mượt mà theo mô-đun
  const {
    promptError,
    setPromptError,
    isGeneratingIdea,
    isAnalyzingPlot,
    handleRandomTemplate,
    handlePhanTichYoutube,
    handleGenerateOutline
  } = useSetupActions();

  const {
    isStreaming,
    streamText,
    liveWordCount,
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
    ttsProgress,
    ttsStatus,
    chapterTtsRunning,
    chapterTtsStatus,
  } = useTTSActions();

  const {
    generatingPrompt,
    regeneratingSinglePrompt,
    // gen ảnh/video progress: mediaGenSlotStore (không còn state trên hook)
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

  // NEVER block workspace behind isHydrated spinner (was stuck forever on desktop).
  // Store starts isHydrated=true; rehydrate merges disk data in background.
  useEffect(() => {
    try {
      if (!useNovelStore.getState().isHydrated) {
        useNovelStore.setState({ isHydrated: true });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
  // Live Word-Gate: while streaming, count ticks from typing animation; else saved chapter
  const wordsCount = isStreaming
    ? liveWordCount
    : getWordCount(currentChapter?.noi_dung || '');
  const targetWords = store.setup.so_tu_chuong || 4250;
  // % đúng tỉ lệ (có thể >100% khi vượt chỉ tiêu) — không ép trần 100; bar fill clamp 100
  const progressPercent =
    targetWords > 0 ? Math.round((wordsCount / targetWords) * 100) : 0;
  const progressBarPct = Math.min(100, Math.max(0, progressPercent));

  // Tính toán thống kê hình ảnh chương hiện tại
  const activeChapterNum = store.chuong_dang_chon;
  let totalPromptsCount = 0;
  let successImagesCount = 0;

  const scenesList = currentChapter ? parseScenes(currentChapter.noi_dung) : [];
  // Include Hook (990) + normal scenes in image progress
  const sceneIndicesForStats = [YOUTUBE_HOOK_SCENE_INDEX, ...scenesList.map((_, i) => i)];
  sceneIndicesForStats.forEach((sceneIdx) => {
    const assetKey = sceneAssetKey(activeChapterNum, sceneIdx);
    const prompts = store.generatedPrompts[assetKey] || [];
    totalPromptsCount += prompts.length;

    prompts.forEach((_, promptIdx) => {
      const imageKey = imageAssetKey(activeChapterNum, sceneIdx, promptIdx);
      if (store.generatedImages?.[imageKey]) {
        successImagesCount++;
      }
    });
  });

  const failedImagesCount = totalPromptsCount - successImagesCount;

  return (
    <AppShell>
    <FlowAutoBootstrap />
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* 1. HEADER CHUNG CAO CẤP */}
      <Header />
      <OnboardingBanner />
      <MediaDnaBanner />

      {/* Workspace 2 cột — trục chính luôn hiện; Setup = modal giữa màn hình */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            handleWriteChapter={handleWriteChapter}
            isStreaming={isStreaming}
            onImageZoom={setZoomImageUrl}
          />

          {/* CỘT PHẢI: KHÔNG GIAN SOẠN THẢO */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black/40">
            {/* Hàng 1: toolbar fluid */}
            <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/80 px-3 sm:px-4">
              <span className="shrink-0 whitespace-nowrap text-[clamp(10px,1.1vw,12px)] font-bold uppercase tracking-wide text-amber-500">
                {store.workspaceTab === 'script' ? '📝 Kịch Bản Làm Việc' : '🤖 AI Novel Engine'}
              </span>

              {store.workspaceTab === 'script' && currentChapter && (
                <>
                  <span className="text-zinc-800 shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  {/* Cổng từ: realtime khi sinh kịch bản (liveWordCount theo từng tick gõ) */}
                  <span
                    className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded border px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 ${
                      progressPercent >= 92
                        ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
                        : 'border-amber-900/50 bg-amber-950/30 text-amber-400'
                    } ${isStreaming ? 'ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]' : ''}`}
                    title={
                      isStreaming
                        ? `Đang sinh… ${wordsCount}/${targetWords} từ (live)`
                        : `Tối thiểu ${Math.round(targetWords * 0.92)} từ (92%)`
                    }
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {/* Thanh máu neon nền — đầy dần realtime */}
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-150 ease-out ${
                        progressPercent >= 92
                          ? 'bg-emerald-500/25'
                          : isStreaming
                            ? 'bg-amber-500/20'
                            : 'bg-amber-500/10'
                      }`}
                      style={{ width: `${progressBarPct}%` }}
                    />
                    <span className="relative z-[1]">
                      Cổng từ {wordsCount}/{targetWords} · {progressPercent}%
                      {isStreaming && (
                        <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle opacity-80" />
                      )}
                    </span>
                  </span>
                  {/* Ảnh: một pill, không xuống dòng từng ký tự */}
                  <span
                    className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 text-zinc-300"
                    title={`Sinh ảnh chương ${activeChapterNum}`}
                  >
                    Ảnh {successImagesCount}✓/{failedImagesCount}✗ ({totalPromptsCount})
                  </span>
                  {/* Memory commit status — hàng 1 cạnh Ảnh / .txt */}
                  {(() => {
                    const mem = store.memoryPipelineStatus;
                    const st = mem?.status || 'idle';
                    const msg = (mem?.message || '').trim();
                    const shortMsg =
                      msg.length > 48 ? `${msg.slice(0, 46)}…` : msg;
                    const label =
                      st === 'pending'
                        ? 'đang commit…'
                        : st === 'ok'
                          ? 'commit ok'
                          : st === 'failed'
                            ? 'commit lỗi'
                            : 'chưa commit';
                    const color =
                      st === 'failed'
                        ? 'text-red-400 border-red-900/40 bg-red-950/20'
                        : st === 'pending'
                          ? 'text-amber-400 border-amber-900/40 bg-amber-950/15 animate-pulse'
                          : st === 'ok'
                            ? 'text-emerald-400 border-emerald-900/40 bg-emerald-950/15'
                            : 'text-zinc-500 border-zinc-800 bg-zinc-900/50';
                    const showRetry =
                      st === 'failed' &&
                      (mem?.chapter === activeChapterNum || !mem?.chapter);
                    return (
                      <div
                        className={`shrink-0 flex max-w-[min(220px,30vw)] items-center gap-1 rounded border px-1.5 py-0.5 ${color}`}
                        title={
                          msg ||
                          'Bộ nhớ vĩ mô sau khi viết chương (tóm tắt / lore / world state). Không liên quan dàn ý outline.'
                        }
                      >
                        <span className="text-[8px] font-bold uppercase tracking-wide opacity-80">
                          Mem
                        </span>
                        <span className="text-[9px] font-bold whitespace-nowrap">
                          · {label}
                        </span>
                        {shortMsg && st !== 'idle' ? (
                          <span className="hidden sm:inline text-[8px] font-medium text-zinc-400 truncate min-w-0 max-w-[100px]">
                            {shortMsg}
                          </span>
                        ) : null}
                        {st === 'pending' ? (
                          <span className="text-[8px] opacity-70">…</span>
                        ) : showRetry ? (
                          <button
                            type="button"
                            onClick={() => void retryMemoryCommit(activeChapterNum)}
                            className="text-[9px] font-bold underline hover:opacity-80 shrink-0"
                          >
                            Retry
                          </button>
                        ) : null}
                      </div>
                    );
                  })()}
                </>
              )}

              <div className="flex-1 min-w-0" />

              {store.workspaceTab === 'script' && (
                <button
                  type="button"
                  onClick={handleExportTxt}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 h-7 text-[10px] font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white shrink-0"
                >
                  <Download className="h-3 w-3" />
                  .txt
                </button>
              )}
            </div>

            {/* AINOVEL DASHBOARD */}
            {store.workspaceTab === 'ainovel' && (
              <div className="flex-1 overflow-y-auto bg-black min-h-0">
                <AINovelDashboard />
              </div>
            )}

            {/* KỊCH BẢN WORKSPACE (trục chính) */}
            {store.workspaceTab === 'script' && (
              <>
                {/* Hàng 2: tên series + cuộn cảnh + viết lại toàn bộ chương (phải) */}
                {currentChapter && (
                  <div className="shrink-0 border-b border-zinc-900/80 bg-zinc-950/95 px-3 sm:px-4 py-1.5 flex items-center gap-2 min-w-0 z-10">
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
                    {/* TTS chương + Mem + Viết lại — sticky hàng 2 (không cuộn mất) */}
                    <div className="ml-auto shrink-0 flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        disabled={chapterTtsRunning || isStreaming}
                        title="Gen TTS mọi cảnh; bỏ qua cảnh đã có audio. Hỏi force nếu 100% đã có."
                        onClick={() =>
                          void handleGenerateChapterTTS({
                            includeHook: true,
                            skipExisting: true,
                          }).catch((e) =>
                            toast.error(
                              'TTS chương',
                              e instanceof Error ? e.message : String(e),
                            ),
                          )
                        }
                        className="shrink-0 inline-flex items-center rounded border border-amber-700/50 bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {chapterTtsRunning ? 'Đang gen…' : '🎙️ Gen TTS cả chương'}
                      </button>
                      <button
                        type="button"
                        disabled={chapterTtsRunning || isStreaming}
                        title="Gen lại fail-log; nếu không có log → gen cảnh chưa có audio"
                        onClick={() =>
                          void handleGenerateChapterTTS({
                            includeHook: true,
                            onlyFailed: true,
                            skipExisting: false,
                          }).catch((e) =>
                            toast.error(
                              'Retry TTS',
                              e instanceof Error ? e.message : String(e),
                            ),
                          )
                        }
                        className="shrink-0 inline-flex items-center rounded border border-rose-800/50 bg-rose-950/30 px-2 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-950/50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        ↺ Gen lại cảnh lỗi
                      </button>
                      {chapterTtsRunning ? (
                        <button
                          type="button"
                          onClick={handleStopChapterTTS}
                          className="shrink-0 inline-flex items-center rounded border border-rose-800/60 px-2 py-0.5 text-[10px] font-bold text-rose-400 hover:bg-rose-950/40 whitespace-nowrap"
                          title={chapterTtsStatus || 'Dừng TTS chương'}
                        >
                          Dừng
                        </button>
                      ) : null}
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
                        className="shrink-0 inline-flex items-center gap-1 rounded border border-red-900/50 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-300 hover:bg-red-500/25 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        Viết lại toàn bộ chương
                      </button>
                    </div>
                  </div>
                )}

                {/* Vùng cuộn nội dung — min-h-0 để không tràn đè header */}
                <div className="flex-1 min-h-0 overflow-y-auto bg-black">
                  <div className="p-3 sm:p-5 text-zinc-300 font-sans text-sm">
                    <ContentTab
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
                      generatingPrompt={generatingPrompt}
                      regeneratingSinglePrompt={regeneratingSinglePrompt}
                      onImageZoom={setZoomImageUrl}
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </main>

      {/* Setup modal — local dismiss latch + store phase (survives rehydrate yank-back) */}
      {showSetup && setupKind === 'youtube' && (
        <YoutubeSetupPhase
          promptError={promptError}
          isGeneratingIdea={isGeneratingIdea}
          isAnalyzingPlot={isAnalyzingPlot}
          handlePhanTichYoutube={handlePhanTichYoutube}
          handleGenerateOutline={handleGenerateOutline}
          onClose={dismissSetup}
        />
      )}
      {showSetup && setupKind !== 'youtube' && (
        <SetupPhase
          promptError={promptError}
          isGeneratingIdea={isGeneratingIdea}
          handleRandomTemplate={handleRandomTemplate}
          handleGenerateOutline={handleGenerateOutline}
          onClose={dismissSetup}
        />
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
            className="max-h-[90vh] max-w-[90vw] cursor-default rounded-2xl border border-zinc-800 object-contain shadow-2xl animate-in zoom-in-95 duration-200"
          />
        </div>
      )}

      <ToastHost />
    </div>
    </AppShell>
  );
}
