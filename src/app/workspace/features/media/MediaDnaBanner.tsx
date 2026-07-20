'use client';

/**
 * Live reminder bubble: generated media DNA vs current Ảnh/Video · TTS toolbar.
 * Soft warn only — sticky until dismiss / issue change; does not auto-hide.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  chapterAssetKeys,
  evaluateMediaDnaMatch,
  liveDnaFromStoreLike,
  summarizeMediaDnaMismatches,
} from '@/lib/mediaDnaMatch';

export default function MediaDnaBanner() {
  // Subscribe to stable store field refs only (no object-literal selectors)
  const isHydrated = useNovelStore((s) => s.isHydrated);
  const ch = useNovelStore((s) => s.chuong_dang_chon);
  const generatedAudioPaths = useNovelStore((s) => s.generatedAudioPaths);
  const generatedImages = useNovelStore((s) => s.generatedImages);
  const generatedVideos = useNovelStore((s) => s.generatedVideos);
  const generatedAssetDna = useNovelStore((s) => s.generatedAssetDna);
  const ttsConfig = useNovelStore((s) => s.ttsConfig);
  const imageProvider = useNovelStore((s) => s.imageProvider);
  const imageModel = useNovelStore((s) => s.imageModel);
  const imageAspectRatio = useNovelStore((s) => s.imageAspectRatio);
  const videoProvider = useNovelStore((s) => s.videoProvider);
  const videoModel = useNovelStore((s) => s.videoModel);
  const videoAspectRatio = useNovelStore((s) => s.videoAspectRatio);
  const videoDuration = useNovelStore((s) => s.videoDuration);
  const [dismissedIssueKey, setDismissedIssueKey] = useState('');

  const report = useMemo(() => {
    if (!isHydrated) return null;
    const keys = chapterAssetKeys(ch, {
      audio: generatedAudioPaths,
      images: generatedImages,
      videos: generatedVideos,
    });
    if (
      keys.audioKeys.length + keys.imageKeys.length + keys.videoKeys.length ===
      0
    ) {
      return null;
    }
    return evaluateMediaDnaMatch({
      chapterNum: ch,
      audioKeys: keys.audioKeys,
      imageKeys: keys.imageKeys,
      videoKeys: keys.videoKeys,
      stamps: generatedAssetDna || {},
      live: liveDnaFromStoreLike({
        ttsConfig,
        imageProvider,
        imageModel,
        imageAspectRatio,
        videoProvider,
        videoModel,
        videoAspectRatio,
        videoDuration,
      }),
    });
  }, [
    isHydrated,
    ch,
    generatedAudioPaths,
    generatedImages,
    generatedVideos,
    generatedAssetDna,
    ttsConfig,
    imageProvider,
    imageModel,
    imageAspectRatio,
    videoProvider,
    videoModel,
    videoAspectRatio,
    videoDuration,
  ]);

  const issueRows = useMemo(
    () => summarizeMediaDnaMismatches(report?.mismatches || []),
    [report],
  );

  // Reset dismiss when chapter or report changes materially
  const issueKey = report?.hasIssues
    ? `${ch}:${issueRows.map((row) => `${row.key}:${row.count}`).join('|')}`
    : '';
  if (!report?.hasIssues || dismissedIssueKey === issueKey) return null;

  const lines = issueRows.slice(0, 3);
  const more =
    issueRows.length > 3
      ? ` (+${issueRows.length - 3} mục nữa)`
      : '';

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[190] w-[min(320px,92vw)]"
      aria-live="polite"
    >
      <div
        role="status"
        className="pointer-events-auto flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/90 px-3 py-2.5 text-[11px] text-amber-100 shadow-2xl backdrop-blur-md animate-in slide-in-from-right-4 fade-in duration-200"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-bold uppercase tracking-wider text-amber-200">
            Media lệch cài · Ch.{ch}
          </div>
          <ul className="mt-0.5 list-inside list-disc text-amber-100/90">
            {lines.map((row) => (
              <li key={row.key} className="truncate">
                {row.message}
                {row.count > 1 ? ` · ${row.count} asset` : ''}
              </li>
            ))}
          </ul>
          {more ? (
            <div className="mt-0.5 text-amber-200/70">{more}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-amber-200/75">
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3 shrink-0" />
              Gen lại TTS / ảnh theo toolbar
            </span>
            <span className="text-zinc-500">
              stamp {report.stamped}/{report.checked}
              {report.unstamped ? ` · chưa ${report.unstamped}` : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissedIssueKey(issueKey)}
          className="shrink-0 rounded p-0.5 text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-200 cursor-pointer"
          title="Ẩn nhắc nhở"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
