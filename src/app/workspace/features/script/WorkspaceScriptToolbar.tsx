'use client';

/**
 * Right-column script toolbar leaves — each subscribes only to what it paints.
 * Prevents Word-Gate / image / memory updates from re-rendering the whole shell.
 */
import React, { useMemo } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectChuongDangChon,
  selectChapterImageProgress,
  selectCurrentChapterContent,
  selectTargetWords,
  selectSetDangTai,
  selectDangTai,
} from '@/store/useNovelStoreSelectors';
import { useStreamUi } from '../../modules/streamUiStore';
import { parseScenes, getWordCount } from '../../utils/stringUtils';
import {
  bodySceneIndicesForWorkspace,
  groupScenesIntoPhan,
} from '@/lib/sceneWorkspaceGroups';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import { useChapterTtsQueue } from '../../hooks/useChapterTtsQueue';

export function WordGatePill() {
  const isStreaming = useStreamUi((s) => s.isStreaming);
  const liveWordCount = useStreamUi((s) => s.liveWordCount);
  const targetWords = useNovelStore(selectTargetWords);
  const chapterContent = useNovelStore(selectCurrentChapterContent);
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const freeTier = !is_pro && !is_trial && !is_vip;
  const trialTier = !!is_trial;

  const wordsCount = isStreaming
    ? liveWordCount
    : getWordCount(chapterContent);
  const progressPercent =
    targetWords > 0 ? Math.round((wordsCount / targetWords) * 100) : 0;
  const maxCapWords = Math.round(targetWords * 1.2);
  const overCap = targetWords > 0 && wordsCount > maxCapWords;
  const isOptimal = progressPercent >= 92 && progressPercent <= 120;
  const progressBarPct = Math.min(100, Math.max(0, progressPercent));
  const tierHint = freeTier
    ? 'Free ≤600 từ/chương'
    : trialTier
      ? 'Trial ≤3000 từ/chương'
      : '';

  return (
    <span
      className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded border px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 ${
        overCap
          ? 'border-rose-800/60 bg-rose-950/40 text-rose-300'
          : isOptimal
            ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
            : 'border-amber-900/50 bg-amber-950/30 text-amber-400'
      } ${isStreaming ? 'ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]' : ''}`}
      title={
        overCap
          ? `Vượt trần cổng từ (+20%) ${wordsCount}/${targetWords} từ (max ${maxCapWords})${tierHint ? ` · ${tierHint}` : ''}.`
          : isOptimal
            ? `Đạt dải cổng từ tối ưu (${wordsCount}/${targetWords} từ · 92%–120%)${tierHint ? ` · ${tierHint}` : ''}.`
            : isStreaming
              ? `Đang sinh… ${wordsCount}/${targetWords} từ (live)`
              : `Biên độ tối ưu 92%–120% (${Math.round(targetWords * 0.92)}–${maxCapWords} từ)${tierHint ? ` · ${tierHint}` : ''}`
      }
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-150 ease-out ${
          overCap
            ? 'bg-rose-500/30'
            : isOptimal
              ? 'bg-emerald-500/25'
              : isStreaming
                ? 'bg-amber-500/20'
                : 'bg-amber-500/10'
        }`}
        style={{ width: `${Math.min(100, progressBarPct)}%` }}
      />
      <span className="relative z-[1]">
        {overCap ? '⚠ ' : isOptimal ? '✓ ' : ''}
        Cổng từ {wordsCount}/{targetWords} · {progressPercent}%
        {overCap ? ' · Vượt trần' : isOptimal ? ' · Đạt' : ''}
        {isStreaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle opacity-80" />
        )}
      </span>
    </span>
  );
}

export function ImageProgressPill() {
  // Primitive fingerprint — stable getSnapshot (no new object each call)
  const fingerprint = useNovelStore((s) => {
    const p = selectChapterImageProgress(s);
    return `${p.chapterNum}:${p.success}:${p.failed}:${p.total}`;
  });
  const [chapterNum, success, failed, total] = fingerprint.split(':').map(Number);
  const stats = { chapterNum, success, failed, total };
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap shrink-0 text-zinc-300"
      title={`Sinh ảnh chương ${stats.chapterNum}`}
    >
      Ảnh {stats.success}✓/{stats.failed}✗ ({stats.total})
    </span>
  );
}

export function MemoryStatusPill({
  onRetry,
}: {
  onRetry: (chapterNum: number) => void;
}) {
  // Subscribe to status fields as primitives (avoid object identity churn)
  const memStatus = useNovelStore((s) => s.memoryPipelineStatus?.status || 'idle');
  const memMessage = useNovelStore((s) => s.memoryPipelineStatus?.message || '');
  const memChapter = useNovelStore((s) => s.memoryPipelineStatus?.chapter);
  const mem = { status: memStatus, message: memMessage, chapter: memChapter };
  const activeChapterNum = useNovelStore(selectChuongDangChon);
  const st = mem?.status || 'idle';
  const msg = (mem?.message || '').trim();
  const shortMsg = msg.length > 48 ? `${msg.slice(0, 46)}…` : msg;
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
    st === 'failed' && (mem?.chapter === activeChapterNum || !mem?.chapter);

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
      <span className="text-[9px] font-bold whitespace-nowrap">· {label}</span>
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
          onClick={() => onRetry(activeChapterNum)}
          className="text-[9px] font-bold underline hover:opacity-80 shrink-0"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function SceneNavStrip() {
  const content = useNovelStore(selectCurrentChapterContent);
  const scenesList = useMemo(() => parseScenes(content), [content]);
  const bodyIdx = useMemo(
    () => bodySceneIndicesForWorkspace(scenesList),
    [scenesList],
  );
  const groups = useMemo(
    () => groupScenesIntoPhan(bodyIdx, scenesList, 3),
    [bodyIdx, scenesList],
  );
  if (!content.trim()) return null;

  return (
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
      {bodyIdx.length > 4
        ? groups.map((g) => {
            const first = g.sceneIndices[0];
            return (
              <button
                key={`p-${g.phan}`}
                type="button"
                title={g.label}
                onClick={() => {
                  document
                    .getElementById(`scene-card-container-${first}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="shrink-0 px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 hover:text-amber-400 border border-zinc-800 text-[10px] font-bold"
              >
                P{g.phan}
              </button>
            );
          })
        : bodyIdx.map((idx) => {
            const sc = scenesList[idx];
            if (!sc) return null;
            let shortTitle = `C${idx + 1}`;
            if (sc.title.toUpperCase().includes('CẢNH')) {
              const match = sc.title.match(/CẢNH\s+(\d+)/i);
              if (match) shortTitle = `C${match[1]}`;
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
  );
}

export function ChapterActionBar({
  handleGenerateChapterTTS,
  handleStopChapterTTS,
  handleWriteChapter,
}: {
  handleGenerateChapterTTS: (opts?: {
    includeHook?: boolean;
    skipExisting?: boolean;
    force?: boolean;
    exportFull?: boolean;
  }) => Promise<unknown>;
  handleStopChapterTTS: () => void;
  handleWriteChapter: (overwrite?: boolean) => Promise<void>;
}) {
  const isStreaming = useStreamUi((s) => s.isStreaming);
  const chuong = useNovelStore(selectChuongDangChon);
  const dangTai = useNovelStore(selectDangTai);
  const setDangTai = useNovelStore(selectSetDangTai);
  // Leaf subscribe — progress ticks stay off parent
  const q = useChapterTtsQueue();
  const chapterTtsRunning = q.running;
  const chapterTtsStatus = q.status;
  const chapterTtsProgress = q.progress;
  const hasChapter = useNovelStore((s) =>
    s.danh_sach_chuong.some((c) => c.so_chuong === s.chuong_dang_chon),
  );
  if (!hasChapter) return null;

  return (
    <div className="shrink-0 border-b border-zinc-900/80 bg-zinc-950/95 px-3 sm:px-4 py-1.5 flex items-center gap-2 min-w-0 z-10">
      <SceneNavStrip />
      <div className="ml-auto shrink-0 flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          disabled={chapterTtsRunning || isStreaming}
          title={
            chapterTtsRunning
              ? chapterTtsStatus || 'Đang gen TTS chương…'
              : 'Force gen đè mọi cảnh → ghép 1 MP3 + SRT → thư mục đầu ra kênh'
          }
          onClick={() =>
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
          className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-700/50 bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black hover:bg-amber-400 disabled:opacity-70 disabled:cursor-wait whitespace-nowrap"
        >
          {chapterTtsRunning ? (
            <>
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-black/30 border-t-black"
                aria-hidden
              />
              <span className="max-w-[11rem] truncate">
                {chapterTtsProgress > 0
                  ? `TTS ${chapterTtsProgress}%`
                  : 'Đang gen…'}
              </span>
            </>
          ) : (
            '🎙️ Gen TTS cả chương'
          )}
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
          disabled={isStreaming}
          title="Viết lại toàn bộ chương này từ đầu (xóa kịch bản + media chương). Gen hồ sơ NV không chặn nút này."
          onClick={() => {
            void (async () => {
              const ok = await appConfirm({
                title: `Viết lại Chương ${chuong}`,
                message: 'Xóa kịch bản và media của chương này rồi gen lại từ đầu.',
                details: [
                  'Kịch bản / cảnh',
                  'Audio · ảnh · video · prompt',
                ],
                confirmLabel: 'Viết lại toàn bộ',
                cancelLabel: 'Giữ nguyên',
                tone: 'danger',
              });
              if (!ok) return;
              if (dangTai) setDangTai(false);
              void handleWriteChapter(true);
            })();
          }}
          className="shrink-0 inline-flex items-center gap-1 rounded border border-red-900/50 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-300 hover:bg-red-500/25 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Viết lại toàn bộ chương
        </button>
      </div>
    </div>
  );
}
