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
import { ToastHost, ConfirmHost } from './shared';
import OnboardingBanner from './features/onboarding/OnboardingBanner';
import UpdateSuccessModal from './features/onboarding/UpdateSuccessModal';
import MediaDnaBanner from './features/media/MediaDnaBanner';
import FlowAutoBootstrap from './features/media/FlowAutoBootstrap';
import LaStudioAutoBootstrap from './features/tts/LaStudioAutoBootstrap';

import { useSetupActions } from './hooks/useSetupActions';
import { useWriteChapter } from './hooks/useWriteChapter';
import { useSceneActions } from './hooks/useSceneActions';
import { useTTSActions } from './hooks/useTTSActions';
import { useImagePromptActions } from './hooks/useImagePromptActions';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useFolderActions } from './hooks/useFolderActions';
import { useProjectActions } from './hooks/useProjectActions';
import { useEntitlementSync } from './hooks/useEntitlementSync';

import { parseScenes } from './utils/stringUtils';
import { imageAssetKey, sceneAssetKey, videoAssetKey } from '@/contracts';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';
import {
  bodySceneIndicesForWorkspace,
  groupScenesIntoPhan,
  isBodyColdOpenScene,
} from '@/lib/sceneWorkspaceGroups';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import { useStreamUi } from './modules/streamUiStore';
import {
  WordGatePill,
  ImageProgressPill,
  MemoryStatusPill,
} from './features/script/WorkspaceScriptToolbar';
import { useChapterTtsQueue } from './hooks/useChapterTtsQueue';

/** Leaf: chapter TTS progress — isolated so workspace root does not re-render every %. */
function ChapterTtsControls({
  onGenerate,
  onStop,
}: {
  onGenerate: () => void;
  onStop: () => void;
}) {
  const q = useChapterTtsQueue();
  const isStreaming = useStreamUi((s) => s.isStreaming);
  const running = q.running;
  return (
    <>
      <button
        type="button"
        disabled={running || isStreaming}
        title={
          running
            ? q.status || 'Đang gen TTS chương…'
            : 'Force gen đè mọi cảnh → ghép 1 MP3 + SRT → thư mục đầu ra kênh'
        }
        onClick={onGenerate}
        className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-700/50 bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black hover:bg-amber-400 disabled:opacity-70 disabled:cursor-wait whitespace-nowrap"
      >
        {running ? (
          <>
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-black/30 border-t-black"
              aria-hidden
            />
            <span className="max-w-[11rem] truncate">
              {q.progress > 0 ? `TTS ${q.progress}%` : 'Đang gen…'}
            </span>
          </>
        ) : (
          '🎙️ Gen TTS cả chương'
        )}
      </button>
      {running ? (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 inline-flex items-center rounded border border-rose-800/60 px-2 py-0.5 text-[10px] font-bold text-rose-400 hover:bg-rose-950/40 whitespace-nowrap"
          title={q.status || 'Dừng TTS chương'}
        >
          Dừng
        </button>
      ) : null}
    </>
  );
}

function SceneNavButton({ 
  sceneIndex, 
  shortTitle, 
  chapterNum, 
  setExpandedScene,
  expandedScene
}: { 
  sceneIndex: number; 
  shortTitle: string; 
  chapterNum: number;
  setExpandedScene: (val: number | null) => void;
  expandedScene: number | null;
}) {
  const status = useNovelStore((state) => {
    const assetKey = sceneAssetKey(chapterNum, sceneIndex);
    const prompts = state.generatedPrompts?.[assetKey] || [];
    let iDone = 0; let vDone = 0;
    prompts.forEach((_, pIdx) => {
       if (state.generatedImages?.[imageAssetKey(chapterNum, sceneIndex, pIdx)]) iDone++;
       if (state.generatedVideos?.[videoAssetKey(chapterNum, sceneIndex, pIdx)]) vDone++;
    });
    const hasAudio = !!state.generatedAudioPaths?.[assetKey];
    
    if (prompts.length > 0 && iDone === prompts.length && vDone === prompts.length) {
      return 'complete';
    }
    if (prompts.length > 0 || hasAudio) return 'partial';
    return 'empty';
  });

  const isActive = expandedScene === sceneIndex;

  let cls = 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800';
  if (status === 'complete') {
    cls = 'bg-emerald-500/10 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-500/20';
  } else if (status === 'partial') {
    cls = 'bg-amber-500/10 text-amber-400 border border-amber-900/40 hover:bg-amber-500/20';
  }

  return (
    <button
      type="button"
      title={shortTitle}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setExpandedScene(sceneIndex);
        // Wait for expand layout then scroll (content may mount after state tick)
        requestAnimationFrame(() => {
          setTimeout(() => {
            document
              .getElementById(
                sceneIndex === 990
                  ? 'scene-card-container-hook'
                  : `scene-card-container-${sceneIndex}`,
              )
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 80);
        });
      }}
      className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer select-none ${cls} ${isActive ? 'ring-1 ring-current shadow-lg' : ''}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {shortTitle}
    </button>
  );
}

export default function Workspace() {
  /**
   * Selector-only — CẤM `useNovelStore()` full store.
   * Full subscribe re-render cả workspace mỗi lần media/TTS/persist tick → GUI đứng.
   */
  const workspaceTab = useNovelStore((s) => s.workspaceTab);
  const chuongDangChon = useNovelStore((s) => s.chuong_dang_chon);
  const chapterContent = useNovelStore((s) => {
    const ch = s.danh_sach_chuong.find(
      (c) => Number(c.so_chuong) === Number(s.chuong_dang_chon),
    );
    return ch?.noi_dung || '';
  });
  const hasCurrentChapter = useNovelStore((s) =>
    s.danh_sach_chuong.some(
      (c) => Number(c.so_chuong) === Number(s.chuong_dang_chon),
    ),
  );
  const dangTai = useNovelStore((s) => s.dang_tai);
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
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  // Commercial Free/Pro/Trial sync (open mode → unlimited for dev)
  useEntitlementSync();

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
    isGeneratingOutline,
    isAnalyzingPlot,
    handleRandomTemplate,
    handlePhanTichYoutube,
    handleGenerateOutline
  } = useSetupActions();

  const {
    handleWriteChapter,
    handleIntervene,
    handleReviseFromReview,
    retryMemoryCommit,
  } = useWriteChapter(setPromptError);
  // Only boolean stream flag at root (rare flips). Text/word ticks → leaf components only.
  const isStreaming = useStreamUi((s) => s.isStreaming);

  const {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene,
    handleRewriteScene,
    isExpanding,
    isRewriting,
  } = useSceneActions();

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
  } = useProjectActions();

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

  // Drop ghost media paths (store map but file missing) after durable rehydrate settles.
  useEffect(() => {
    const run = async () => {
      try {
        const r =
          await useNovelStore.getState().reconcileMissingMediaAssets?.();
        if (r?.changed) {
          toast.warn(
            'Media ảo',
            r.summary ||
              `Đã gỡ ${r.removedAudio + r.removedImage + r.removedVideo} media ảo (file mất). Gen lại nếu cần.`,
          );
        }
      } catch {
        /* ignore */
      }
    };
    // Immediate + delayed (durable merge may arrive late)
    void run();
    const t1 = window.setTimeout(() => void run(), 1500);
    const t2 = window.setTimeout(() => void run(), 4000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const activeChapterNum = chuongDangChon;
  const scenesList = chapterContent ? parseScenes(chapterContent) : [];

  return (
    <AppShell>
    <FlowAutoBootstrap />
    <LaStudioAutoBootstrap />
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-zinc-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* 1. HEADER CHUNG CAO CẤP */}
      <Header />
      <OnboardingBanner />
      <UpdateSuccessModal />

      {/* Workspace 2 cột — trục chính luôn hiện; Setup = modal giữa màn hình */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            handleWriteChapter={handleWriteChapter}
            isStreaming={isStreaming}
            onImageZoom={setZoomImageUrl}
            onOpenSetup={() => setSetupDismissed(false)}
          />

          {/* CỘT PHẢI: KHÔNG GIAN SOẠN THẢO */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black/40">
            {/* Hàng 1: toolbar fluid */}
            <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/80 px-3 sm:px-4">
              <span className="shrink-0 whitespace-nowrap text-[clamp(10px,1.1vw,12px)] font-bold uppercase tracking-wide text-amber-500">
                {workspaceTab === 'script' ? '📝 Kịch Bản Làm Việc' : '🤖 AI Novel Engine'}
              </span>

              {workspaceTab === 'script' && hasCurrentChapter && (
                <>
                  <span className="text-zinc-800 shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  {/* Leaf pills — typewriter / image / mem ticks do not re-render workspace shell */}
                  <WordGatePill />
                  <ImageProgressPill />
                  <MemoryStatusPill
                    onRetry={(ch) => {
                      void retryMemoryCommit(ch);
                    }}
                  />
                </>
              )}

              <div className="flex-1 min-w-0" />

              {workspaceTab === 'script' && (
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
            {workspaceTab === 'ainovel' && (
              <div className="flex-1 overflow-y-auto bg-black min-h-0">
                <AINovelDashboard />
              </div>
            )}

            {/* KỊCH BẢN WORKSPACE (trục chính) */}
            {workspaceTab === 'script' && (
              <>
                {/* Hàng 2: tên series + cuộn cảnh + viết lại toàn bộ chương (phải) */}
                {hasCurrentChapter && (
                  <div className="shrink-0 border-b border-zinc-900/80 bg-zinc-950/95 px-3 sm:px-4 py-1.5 flex items-center gap-2 min-w-0 z-10">
                    <div className="flex flex-1 items-center gap-1 min-w-0 overflow-x-auto scrollbar-thin py-0.5">
                      <SceneNavButton 
                        sceneIndex={990}
                        shortTitle="Hook"
                        chapterNum={chuongDangChon}
                        expandedScene={expandedScene}
                        setExpandedScene={setExpandedScene}
                      />
                      {(() => {
                        // Compact nav: skip body CẢNH 0 (merged into Hook) · Phần chips when many scenes
                        const bodyIdx = bodySceneIndicesForWorkspace(scenesList);
                        const groups = groupScenesIntoPhan(bodyIdx, scenesList, 3);
                        // Prefer Phần chips when many scenes; else per-scene C1 C2…
                        if (bodyIdx.length > 4) {
                          return groups.map((g) => {
                            const first = g.sceneIndices[0];
                            const active = g.sceneIndices.some(
                              (i) => Number(expandedScene) === i,
                            );
                            return (
                              <button
                                key={`nav-phan-${g.phan}`}
                                type="button"
                                title={g.label}
                                onClick={() => {
                                  setExpandedScene(first);
                                  requestAnimationFrame(() => {
                                    setTimeout(() => {
                                      document
                                        .getElementById(
                                          `scene-card-container-${first}`,
                                        )
                                        ?.scrollIntoView({
                                          behavior: 'smooth',
                                          block: 'start',
                                        });
                                    }, 80);
                                  });
                                }}
                                className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                                  active
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-700/50 ring-1 ring-amber-500/40'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                                }`}
                              >
                                P{g.phan}
                              </button>
                            );
                          });
                        }
                        return bodyIdx.map((idx) => {
                          const sc = scenesList[idx];
                          if (!sc || isBodyColdOpenScene(sc)) return null;
                          let shortTitle = `C${idx + 1}`;
                          if (sc.title.toUpperCase().includes('CẢNH')) {
                            const match = sc.title.match(/CẢNH\s+(\d+)/i);
                            if (match) shortTitle = `C${match[1]}`;
                          }
                          return (
                            <SceneNavButton
                              key={idx}
                              sceneIndex={idx}
                              shortTitle={shortTitle}
                              chapterNum={chuongDangChon}
                              expandedScene={expandedScene}
                              setExpandedScene={setExpandedScene}
                            />
                          );
                        });
                      })()}
                    </div>
                    {/* TTS chương + Mem + Viết lại — sticky hàng 2 (không cuộn mất) */}
                    <div className="ml-auto shrink-0 flex items-center gap-1.5 min-w-0">
                      <ChapterTtsControls
                        onGenerate={() =>
                          void handleGenerateChapterTTS({
                            includeHook: true,
                            force: true,
                            skipExisting: false,
                            exportFull: true,
                          }).catch((e) =>
                            toast.error(
                              'TTS chương',
                              e instanceof Error ? e.message : String(e),
                            ),
                          )
                        }
                        onStop={handleStopChapterTTS}
                      />
                      <button
                        type="button"
                        disabled={dangTai || isStreaming}
                        title="Viết lại toàn bộ chương này từ đầu (xóa kịch bản + media chương)"
                        onClick={() => {
                          void (async () => {
                            const ok = await appConfirm({
                              title: `Viết lại Chương ${chuongDangChon}`,
                              message:
                                'Xóa kịch bản và media của chương này rồi gen lại từ đầu.',
                              details: [
                                'Kịch bản / cảnh',
                                'Audio · ảnh · video · prompt',
                              ],
                              confirmLabel: 'Viết lại toàn bộ',
                              cancelLabel: 'Giữ nguyên',
                              tone: 'danger',
                            });
                            if (!ok) return;
                            void handleWriteChapter(true);
                          })();
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
                      isExpanding={isExpanding}
                      isRewriting={isRewriting}
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
                      expandedScene={expandedScene}
                      setExpandedScene={setExpandedScene}
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
          isGeneratingOutline={isGeneratingOutline}
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
          isGeneratingOutline={isGeneratingOutline}
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

      <MediaDnaBanner />
      <ToastHost />
      <ConfirmHost />
    </div>
    </AppShell>
  );
}
