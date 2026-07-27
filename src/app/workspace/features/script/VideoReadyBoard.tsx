'use client';

/**
 * Video-ready board — 7-station workflow ladder for the active chapter.
 * Status only (store + quality gate). No 1-click gen.
 */
import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  evaluateVideoReady,
  getChapterQuality,
  getPipelineStoreVersion,
  subscribePipelineStore,
  type VideoReadyReport,
  type VideoReadyStation,
  type StationStatus,
} from '@/lib/pipeline';
import { parseScenes } from '@/app/workspace/utils/stringUtils';
import { toast } from '@/lib/toastBus';
import { YOUTUBE_HOOK_SCENE_INDEX } from '@/lib/youtubeSafe';

function statusDotClass(status: StationStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-400';
    case 'partial':
      return 'bg-amber-400';
    case 'blocked':
      return 'bg-rose-500';
    default:
      return 'bg-zinc-600';
  }
}

function statusBorderClass(status: StationStatus): string {
  switch (status) {
    case 'ready':
      return 'border-emerald-800/50 bg-emerald-500/10 text-emerald-300';
    case 'partial':
      return 'border-amber-800/40 bg-amber-500/10 text-amber-300';
    case 'blocked':
      return 'border-rose-900/40 bg-rose-500/10 text-rose-300';
    default:
      return 'border-zinc-800 bg-zinc-900/40 text-zinc-500';
  }
}

function useChapterQualityMedia(chapter: number) {
  const subscribe = useCallback(
    (onChange: () => void) => subscribePipelineStore(onChange),
    [],
  );
  const getSnapshot = useCallback(() => {
    void getPipelineStoreVersion();
    const q = getChapterQuality(chapter);
    return q
      ? `${q.mediaReady ? 1 : 0}:${q.hardErrors}:${q.wordCount}:${q.sceneCount}`
      : 'none';
  }, [chapter]);
  return useSyncExternalStore(subscribe, getSnapshot, () => 'none');
}

function StationChip({
  station,
  isNext,
  onClick,
}: {
  station: VideoReadyStation;
  isNext: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${station.label}: ${station.detail}\n${station.nextHint}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wide transition-all cursor-pointer hover:brightness-110 ${statusBorderClass(
        station.status,
      )} ${isNext ? 'ring-1 ring-amber-500/60 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : ''}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotClass(station.status)}`} />
      <span>{station.short}</span>
      <span className="tabular-nums font-mono opacity-80">
        {station.done}/{station.total}
      </span>
    </button>
  );
}

export type VideoReadyBoardProps = {
  chapter?: number;
  className?: string;
  /** Scroll to scene when user clicks TTS/prompt/image/video station */
  onFocusScene?: (sceneIndex: number) => void;
  /** Open classic Setup modal */
  onOpenSetup?: () => void;
};

export default function VideoReadyBoard({
  chapter: chapterProp,
  className = '',
  onFocusScene,
  onOpenSetup,
}: VideoReadyBoardProps) {
  const [open, setOpen] = useState(true);
  const storeChapter = useNovelStore((s) => Number(s.chuong_dang_chon) || 1);
  const chapter = chapterProp ?? storeChapter;

  const chu_de = useNovelStore((s) => s.setup?.chu_de || '');
  const phong_cach = useNovelStore((s) => s.setup?.phong_cach || '');
  const wordGoal = useNovelStore((s) => s.setup?.so_tu_chuong || 4250);
  const visualDna = useNovelStore((s) => s.visualDnaPrompt || '');
  const mediaStylePreset = useNovelStore((s) => s.mediaStylePreset || '');
  const wpm = useNovelStore((s) => s.wpm);
  const secondsPerBeat = useNovelStore((s) => s.secondsPerBeat);
  const chapterContent = useNovelStore((s) => {
    const ch = s.danh_sach_chuong.find((c) => Number(c.so_chuong) === chapter);
    return ch?.noi_dung || '';
  });
  const hookContent = useNovelStore((s) => s.chapterHooks?.[chapter]?.hook || '');
  const generatedAudioPaths = useNovelStore((s) => s.generatedAudioPaths);
  const generatedPrompts = useNovelStore((s) => s.generatedPrompts);
  const generatedImages = useNovelStore((s) => s.generatedImages);
  const generatedVideos = useNovelStore((s) => s.generatedVideos);

  const qgKey = useChapterQualityMedia(chapter);

  const report: VideoReadyReport = useMemo(() => {
    const q = getChapterQuality(chapter);
    void qgKey;
    return evaluateVideoReady({
      chapter,
      chu_de,
      phong_cach,
      visualDna,
      mediaStylePreset,
      wpm,
      secondsPerBeat,
      chapterContent,
      wordGoal,
      hookContent,
      scenes: parseScenes(chapterContent),
      qualityMediaReady: q?.mediaReady ?? null,
      qualityHardErrors: q?.hardErrors ?? null,
      generatedAudioPaths,
      generatedPrompts,
      generatedImages,
      generatedVideos,
    });
  }, [
    chapter,
    chu_de,
    phong_cach,
    visualDna,
    mediaStylePreset,
    wpm,
    secondsPerBeat,
    chapterContent,
    wordGoal,
    hookContent,
    generatedAudioPaths,
    generatedPrompts,
    generatedImages,
    generatedVideos,
    qgKey,
  ]);

  const barColor =
    report.percent >= 90
      ? 'bg-emerald-500'
      : report.percent >= 50
        ? 'bg-amber-500'
        : 'bg-orange-500';

  const onStation = (st: VideoReadyStation) => {
    toast.info(st.label, st.detail, {
      detail: `${st.nextHint}\n\n${report.nextMessage}`,
      durationMs: 12_000,
    });
    if (st.id === 'setup') {
      onOpenSetup?.();
      return;
    }
    if (st.id === 'script') {
      // Focus first body scene or editor
      onFocusScene?.(0);
      return;
    }
    // Jump to first incomplete scene for media stations
    if (st.id === 'tts' || st.id === 'prompt' || st.id === 'image' || st.id === 'video') {
      const incomplete = report.scenes.find((sc) => {
        if (st.id === 'tts') return sc.hasText && !sc.hasTts;
        if (st.id === 'prompt') return sc.hasText && sc.promptCount === 0;
        if (st.id === 'image')
          return sc.promptCount > 0 && sc.imageDone < sc.promptCount;
        if (st.id === 'video')
          return sc.promptCount > 0 && sc.videoDone < sc.promptCount;
        return false;
      });
      const idx =
        incomplete?.sceneIndex ??
        report.scenes[0]?.sceneIndex ??
        YOUTUBE_HOOK_SCENE_INDEX;
      onFocusScene?.(idx);
    }
  };

  if (!chapterContent.trim() && !hookContent.trim() && !chu_de && !phong_cach) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-zinc-800/90 bg-zinc-950/60 overflow-hidden ${className}`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900/50 cursor-pointer"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Video-ready · Ch.{chapter}
        </span>
        <span
          className={`ml-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums ${
            report.percent >= 90
              ? 'border-emerald-800/50 text-emerald-400'
              : report.canPack
                ? 'border-amber-800/40 text-amber-400'
                : 'border-zinc-700 text-zinc-400'
          }`}
        >
          {report.percent}%
        </span>
        {report.canPack ? (
          <span className="hidden sm:inline text-[9px] font-bold uppercase text-emerald-500/90">
            Pack OK
          </span>
        ) : null}
        <span className="ml-auto min-w-0 truncate text-[9px] text-zinc-500 max-w-[45%]">
          {report.nextMessage}
        </span>
      </button>

      {open ? (
        <div className="border-t border-zinc-900/80 px-3 pb-3 pt-2 space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${Math.min(100, report.percent)}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {report.stations.map((st) => (
              <StationChip
                key={st.id}
                station={st}
                isNext={st.id === report.nextStationId}
                onClick={() => onStation(st)}
              />
            ))}
          </div>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            <span className="text-zinc-400 font-semibold">Thứ tự gợi ý (voice-first): </span>
            Setup → Chữ → TTS → Prompt → Ảnh → Video → CapCut.
            <span className="text-zinc-600"> Không gộp 1-click. Bấm chip để xem thiếu gì.</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
