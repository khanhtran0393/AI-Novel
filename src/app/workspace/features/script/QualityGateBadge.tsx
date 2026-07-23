'use client';

/**
 * P0 Quality Gate badge — SceneCard / ChapterList.
 * Subscribes to pipelineStore (not full Zustand) for mediaReady state.
 */
import React, { useCallback, useSyncExternalStore } from 'react';
import {
  getChapterQuality,
  getPipelineStoreVersion,
  subscribePipelineStore,
  ensureChapterQuality,
  type ChapterQualityReport,
} from '@/lib/pipeline';
import { useNovelStore } from '@/store/useNovelStore';

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
  const wordGoal = useNovelStore((s) => s.setup?.so_tu_chuong || 4250);
  const names = useNovelStore((s) => s.nhan_vat);
  const userRules = useNovelStore((s) => s.userRules);
  const verdict = useNovelStore((s) => s.editorReviews?.[chapter]?.verdict);
  const scriptMode = useNovelStore((s) => s.scriptMode);

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
      ? `Quality Gate OK · ${words} từ · ${scenes} cảnh · media-ready (Gen Prompt/Ảnh/Video mở)`
      : `Quality Gate chặn media (không chặn đọc/sửa kịch bản): ${hard} lỗi · ${words} từ · ${scenes} cảnh.${
          topErrors ? ` ${topErrors}` : ''
        } Thường do thiếu từ (word-gate) hoặc thiếu tag [CẢNH N]. Viết thêm / continue chương rồi thử lại.`
    : 'Đang quét Quality Gate…';

  if (variant === 'dot') {
    return (
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          ready ? 'bg-emerald-400' : hard > 0 ? 'bg-rose-500' : 'bg-amber-500'
        } ${className}`}
        title={tip}
      />
    );
  }

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${
          ready
            ? 'border-emerald-800/60 bg-emerald-500/15 text-emerald-400'
            : hard > 0
              ? 'border-rose-900/50 bg-rose-500/10 text-rose-400'
              : 'border-amber-900/40 bg-amber-500/10 text-amber-400'
        } ${className}`}
        title={tip}
      >
        {ready ? 'QG✓' : hard > 0 ? `QG✗${hard}` : 'QG…'}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider font-sans ${
        ready
          ? 'border-emerald-800/50 bg-emerald-500/10 text-emerald-400'
          : hard > 0
            ? 'border-rose-900/40 bg-rose-500/10 text-rose-400'
            : 'border-amber-900/40 bg-amber-500/10 text-amber-400'
      } ${className}`}
      title={tip}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ready ? 'bg-emerald-400' : hard > 0 ? 'bg-rose-500' : 'bg-amber-400'
        }`}
      />
      {ready
        ? `Gate OK · ${words}t · ${scenes}c`
        : live
          ? `Gate ${hard} lỗi · chặn media`
          : 'Gate…'}
    </span>
  );
}
