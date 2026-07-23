'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  YOUTUBE_HOOK_SCENE_INDEX,
  migrateHookAssetKeys,
} from '@/lib/youtubeSafe';
import { appConfirm } from '@/lib/confirmDialog';
import {
  bodySceneIndicesForWorkspace,
  findColdOpenSceneIndex,
  groupScenesIntoPhan,
  resolveHookDisplayContent,
} from '@/lib/sceneWorkspaceGroups';

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
  expandedScene: number | null;
  setExpandedScene: React.Dispatch<React.SetStateAction<number | null>>;
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
    expandedScene,
    setExpandedScene,
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

  /** Body indices without duplicate CẢNH 0 (shown only as Hook UI) */
  const bodyIndices = useMemo(
    () => bodySceneIndicesForWorkspace(scenes),
    [scenes],
  );
  const phanGroups = useMemo(
    () => groupScenesIntoPhan(bodyIndices, scenes, 3),
    [bodyIndices, scenes],
  );
  const coldOpenIdx = useMemo(() => findColdOpenSceneIndex(scenes), [scenes]);
  const hookDisplay = useMemo(
    () => resolveHookDisplayContent(hookContent, scenes),
    [hookContent, scenes],
  );
  /**
   * Phần open map — independent collapse like SceneCard.
   * true = mở; false = user đã thu gọn (không auto-mở lại).
   * undefined = chưa chạm → coi như đóng.
   */
  const [phanOpenMap, setPhanOpenMap] = useState<Record<number, boolean>>({});
  /** Only auto-pick a scene once per chapter (not every time expandedScene is cleared). */
  const didAutoSelectChapterRef = useRef<number | null>(null);
  /**
   * When user collapses a Phần that contains the active scene, we clear selection.
   * Skip one auto-open-parent cycle so P1 doesn't snap open again.
   */
  const skipAutoOpenPhanRef = useRef(false);

  const isPhanOpen = useCallback(
    (phan: number) => phanOpenMap[phan] === true,
    [phanOpenMap],
  );

  /** Toggle Phần; when closing, clear expanded scene if it lived inside that Phần */
  const togglePhan = useCallback(
    (phan: number, sceneIndices: number[]) => {
      const currentlyOpen = phanOpenMap[phan] === true;
      const nextOpen = !currentlyOpen;
      if (!nextOpen) {
        const sel = expandedScene != null ? Number(expandedScene) : null;
        if (sel != null && sceneIndices.includes(sel)) {
          // Prevent: clear selection → auto-select first scene → force-open Phần 1
          skipAutoOpenPhanRef.current = true;
          didAutoSelectChapterRef.current = chapterNum;
          setExpandedScene(null);
        }
      }
      setPhanOpenMap((prev) => ({ ...prev, [phan]: nextOpen }));
    },
    [phanOpenMap, expandedScene, setExpandedScene, chapterNum],
  );

  // Reset Phần collapse + auto-select gate when switching chapter
  useEffect(() => {
    setPhanOpenMap({});
    didAutoSelectChapterRef.current = null;
    skipAutoOpenPhanRef.current = false;
  }, [chapterNum]);

  // Seed Hook store once from CẢNH 0 when store empty (one path for TTS/media 990)
  useEffect(() => {
    if (!isHydrated || !chapterNum) return;
    const storeHook = (hookContent || '').trim();
    if (storeHook) return;
    if (coldOpenIdx < 0) return;
    const body = (scenes[coldOpenIdx]?.content || '').trim();
    if (body.length < 20) return;
    useNovelStore.getState().setChapterHook(chapterNum, { hook: body });
  }, [isHydrated, chapterNum, hookContent, coldOpenIdx, scenes]);

  // Auto-select first body scene ONCE per chapter — never re-run when user collapses Phần
  useEffect(() => {
    if (!chapterContent?.trim()) return;
    if (didAutoSelectChapterRef.current === chapterNum) return;
    if (expandedScene != null) {
      didAutoSelectChapterRef.current = chapterNum;
      return;
    }
    didAutoSelectChapterRef.current = chapterNum;
    // Default: select Hook only (do not open Phần 1 / force-expand body scenes)
    setExpandedScene(HOOK);
  }, [chapterNum, chapterContent, expandedScene, setExpandedScene, HOOK]);

  // When user opens a body scene (nav / card), open its parent Phần.
  // Skip one cycle after user clicked «Thu gọn» on that Phần (selection cleared).
  useEffect(() => {
    if (skipAutoOpenPhanRef.current) {
      skipAutoOpenPhanRef.current = false;
      return;
    }
    if (expandedScene == null || expandedScene === HOOK) return;
    const g = phanGroups.find((p) =>
      p.sceneIndices.includes(Number(expandedScene)),
    );
    if (!g) return;
    setPhanOpenMap((prev) =>
      prev[g.phan] === true ? prev : { ...prev, [g.phan]: true },
    );
  }, [expandedScene, phanGroups, HOOK]);

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

        {/* One Hook only — merges store 990 + body [CẢNH 0] (no double hook cards) */}
        <div id="scene-card-container-hook" className={`${scrollMt} w-full min-w-0`}>
          <p className="mb-1.5 px-0.5 text-[9px] leading-snug text-zinc-500">
            <strong className="text-amber-500/90">Hook YouTube (~30s)</strong>
            {coldOpenIdx >= 0
              ? ' — gộp với [CẢNH 0: COLD OPEN] trong chương (một chỗ sửa).'
              : ' — cold-open riêng cho TTS / gen media (index 990).'}
          </p>
          <SceneCard
            scene={{
              title:
                coldOpenIdx >= 0
                  ? 'HOOK / COLD OPEN (~30s)'
                  : 'MỞ ĐẦU / HOOK (~30s)',
              content: hookDisplay,
            }}
            sceneIndex={HOOK}
            handleSceneChange={(idx, content) => {
              if (idx === HOOK) {
                useNovelStore.getState().setChapterHook(chapterNum, {
                  hook: content,
                });
                // Keep body CẢNH 0 in sync so word-gate / ship still see one cold open
                if (coldOpenIdx >= 0) {
                  handleSceneChange(coldOpenIdx, content);
                }
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
            collapsed={Number(expandedScene) !== HOOK}
            onExpandChange={(open) => setExpandedScene(open ? HOOK : null)}
          />
        </div>

        {/* Body scenes grouped as «Phần» (fewer top-level chrome rows) */}
        {phanGroups.length === 0 ? (
          <p className="text-[11px] text-zinc-500 px-1">
            Chưa có cảnh thân chương (sau Hook). Viết chương với tag{' '}
            <code className="text-[10px] text-zinc-400">[CẢNH 1: …]</code>.
          </p>
        ) : (
          phanGroups.map((group) => {
            const phanOpen = isPhanOpen(group.phan);
            const hasActiveScene = group.sceneIndices.some(
              (i) => Number(expandedScene) === i,
            );
            return (
              <div
                key={`phan-${group.phan}`}
                id={`phan-section-${group.phan}`}
                className="rounded-xl overflow-hidden transition-[border-color,box-shadow] duration-200"
                style={{
                  borderWidth: 2,
                  borderStyle: 'solid',
                  borderColor: hasActiveScene ? '#ff7b00' : 'rgba(63,63,70,0.9)',
                  boxShadow: hasActiveScene
                    ? '0 0 14px rgba(255, 123, 0, 0.25)'
                    : 'none',
                  background: 'rgba(9,9,11,0.55)',
                }}
              >
                {/* Header — same interaction model as SceneCard: title + Mở/Thu gọn */}
                <div className="flex items-center justify-between gap-2 min-w-0 p-3">
                  <button
                    type="button"
                    onClick={() => togglePhan(group.phan, group.sceneIndices)}
                    className="flex flex-1 items-center gap-2 min-w-0 text-left rounded-lg px-3 py-2 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors cursor-pointer select-none border border-zinc-800/80"
                    title={
                      phanOpen
                        ? 'Thu gọn phần — chỉ còn tiêu đề'
                        : 'Mở phần — hiện các cảnh bên trong'
                    }
                    aria-expanded={phanOpen}
                  >
                    {phanOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    )}
                    <span className="text-xs font-bold uppercase tracking-widest text-amber-400 truncate">
                      {group.label}
                    </span>
                    <span className="text-[9px] text-zinc-500 shrink-0 tabular-nums">
                      {group.sceneIndices.length} cảnh
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePhan(group.phan, group.sceneIndices)}
                    className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-300 hover:border-amber-600 hover:text-amber-300"
                  >
                    {phanOpen ? 'Thu gọn' : 'Mở'}
                  </button>
                </div>
                {phanOpen ? (
                  <div className="flex flex-col gap-3 border-t border-zinc-900/80 px-2 pb-3 pt-2">
                    {group.sceneIndices.map((idx) => {
                      const scene = scenes[idx];
                      if (!scene) return null;
                      return (
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
                            collapsed={Number(expandedScene) !== Number(idx)}
                            onExpandChange={(open) =>
                              setExpandedScene(open ? idx : null)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Collapsed: keep scroll anchors for nav P1/C1 without mounting heavy cards */
                  <div className="sr-only" aria-hidden>
                    {group.sceneIndices.map((idx) => (
                      <div key={idx} id={`scene-card-container-${idx}`} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

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
