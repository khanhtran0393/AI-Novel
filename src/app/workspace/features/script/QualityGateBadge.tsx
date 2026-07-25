'use client';

/**
 * P0 Quality Gate badge — SceneCard / ChapterList.
 * Subscribes to pipelineStore (not full Zustand) for mediaReady state.
 * Click → show full findings (nguyên nhân chặn media).
 */
import React, { useCallback, useSyncExternalStore } from 'react';
import {
  getChapterQuality,
  getPipelineStoreVersion,
  subscribePipelineStore,
  ensureChapterQuality,
  formatQualityGateReasons,
  formatQualityGateTitle,
  type ChapterQualityReport,
} from '@/lib/pipeline';
import { effectiveSetupWordGoal } from '@/lib/commercial/freeLimitsPolicy';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';

function useChapterQuality(chapter: number): ChapterQualityReport | null {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return subscribePipelineStore(onStoreChange);
  }, []);
  const getSnapshot = useCallback(() => {
    // version touch so React sees change even if report object identity stable
    void getPipelineStoreVersion();
    return getChapterQuality(chapter);
  }, [chapter]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export type QualityGateBadgeProps = {
  chapter: number;
  /** compact = dot/number only (ChapterList); full = label + tip */
  variant?: 'full' | 'compact' | 'dot';
  className?: string;
  /** Lazy-scan chapter body if no report yet */
  lazyScan?: boolean;
};

function showGateReasons(
  live: ChapterQualityReport | null,
  chapter: number,
) {
  if (!live) {
    toast.warn(
      'Quality Gate',
      `Ch${chapter}: chưa có báo cáo. Viết/commit chương để quét lại.`,
      { durationMs: 8_000 },
    );
    return;
  }
  const title = formatQualityGateTitle(live);
  const detail = formatQualityGateReasons(live, {
    maxErrors: 12,
    maxWarnings: 6,
    includeMeta: true,
  });
  const short = live.mediaReady
    ? `Media-ready · ${live.wordCount} từ · ${live.sceneCount} cảnh. Bấm để xem chi tiết.`
    : `${live.hardErrors} lỗi chặn Gen Prompt/Ảnh/Video (không chặn đọc/sửa kịch bản). Bấm toast để xem nguyên nhân.`;
  if (live.mediaReady) {
    toast.success(title, short, { detail, durationMs: 10_000 });
  } else {
    toast.error(title, short, { detail, durationMs: 18_000 });
  }
}

export default function QualityGateBadge({
  chapter,
  variant = 'full',
  className = '',
  lazyScan = true,
}: QualityGateBadgeProps) {
  const report = useChapterQuality(chapter);
  const noiDung = useNovelStore((s) => {
    const ch = s.danh_sach_chuong.find((c) => c.so_chuong === chapter);
    return ch?.noi_dung || '';
  });
  const setupWordGoal = useNovelStore((s) => s.setup?.so_tu_chuong || 4250);
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const names = useNovelStore((s) => s.nhan_vat);
  const userRules = useNovelStore((s) => s.userRules);
  const verdict = useNovelStore((s) => s.editorReviews?.[chapter]?.verdict);
  const scriptMode = useNovelStore((s) => s.scriptMode);
  // Free/Trial: clamp quality goal to tier max so badge never demands 4250 while Free=600
  const wordGoal = React.useMemo(
    () => effectiveSetupWordGoal(setupWordGoal, { is_pro, is_trial, is_vip }),
    [setupWordGoal, is_pro, is_trial, is_vip],
  );

  // Lazy ensure once when content exists and no report
  React.useEffect(() => {
    if (!lazyScan || report || !noiDung.trim()) return;
    ensureChapterQuality({
      chapter,
      content: noiDung,
      characterNames: names,
      wordGoal,
      userRules,
      editorVerdict: verdict,
      scriptMode,
      force: true,
    });
  }, [
    lazyScan,
    report,
    chapter,
    noiDung,
    names,
    wordGoal,
    userRules,
    verdict,
    scriptMode,
  ]);

  const live = useChapterQuality(chapter);

  if (!live && !noiDung.trim()) {
    if (variant === 'dot') {
      return (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full bg-zinc-700 ${className}`}
          title="Chưa có nội dung / Quality Gate"
        />
      );
    }
    return null;
  }

  const ready = live?.mediaReady === true;
  const hard = live?.hardErrors ?? 0;
  const words = live?.wordCount ?? 0;
  const scenes = live?.sceneCount ?? 0;
  const topErrors =
    live?.findings
      ?.filter((f) => f.severity === 'error')
      .slice(0, 2)
      .map((f) => f.message)
      .join(' · ') || '';
  const tip = live
    ? ready
      ? `Quality Gate OK · ${words} từ · ${scenes} cảnh · media-ready. Bấm để xem chi tiết.`
      : `Quality Gate chặn media (không chặn đọc/sửa kịch bản): ${hard} lỗi · ${words} từ · ${scenes} cảnh.${
          topErrors ? ` ${topErrors}` : ''
        } Bấm để xem đầy đủ nguyên nhân.`
    : 'Đang quét Quality Gate…';

  const colorClass = ready
    ? 'border-emerald-800/50 bg-emerald-500/10 text-emerald-400'
    : hard > 0
      ? 'border-rose-900/40 bg-rose-500/10 text-rose-400'
      : 'border-amber-900/40 bg-amber-500/10 text-amber-400';
  const dotClass = ready
    ? 'bg-emerald-400'
    : hard > 0
      ? 'bg-rose-500'
      : 'bg-amber-400';

  const onActivate = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Force re-scan so reasons match current body
    if (noiDung.trim()) {
      ensureChapterQuality({
        chapter,
        content: noiDung,
        characterNames: names,
        wordGoal,
        userRules,
        editorVerdict: verdict,
        scriptMode,
        force: true,
      });
    }
    const latest = getChapterQuality(chapter) || live;
    showGateReasons(latest, chapter);
  };

  if (variant === 'dot') {
    // MUST NOT be <button>: ChapterList wraps chapter rows in <button>, and
    // nested buttons crash React 19 hydration (GUI white/error screen).
    return (
      <span
        role="button"
        tabIndex={0}
        className={`inline-block h-1.5 w-1.5 rounded-full cursor-pointer ${dotClass} ${className}`}
        title={tip}
        aria-label={tip}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onActivate(e);
        }}
      />
    );
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide border cursor-pointer hover:brightness-110 ${colorClass} ${className}`}
        title={tip}
        onClick={onActivate}
      >
        {ready ? 'QG✓' : hard > 0 ? `QG✗${hard}` : 'QG…'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider font-sans cursor-pointer hover:brightness-110 ${colorClass} ${className}`}
      title={tip}
      onClick={onActivate}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {ready
        ? `Gate OK · ${words}t · ${scenes}c`
        : live
          ? `Gate ${hard} lỗi · chặn media`
          : 'Gate…'}
    </button>
  );
}
