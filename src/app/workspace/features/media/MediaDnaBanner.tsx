'use client';

/**
 * Live reminder bubble: generated media DNA vs current Ảnh/Video · TTS toolbar.
 * Soft warn only — sticky until dismiss / issue change; does not auto-hide.
 *
 * PERF: do NOT subscribe full generatedImages/Videos maps (every gen shot re-renders
 * the whole workspace chrome). Use cheap counts + debounced evaluate from getState().
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  chapterAssetKeys,
  evaluateMediaDnaMatch,
  liveDnaFromStoreLike,
  summarizeMediaDnaMismatches,
  type MediaDnaMatchReport,
} from '@/lib/mediaDnaMatch';

export default function MediaDnaBanner() {
  const isHydrated = useNovelStore((s) => s.isHydrated);
  const ch = useNovelStore((s) => s.chuong_dang_chon);
  // Cheap signature only — re-run DNA when counts change, not on every path rewrite
  const mediaCountSig = useNovelStore((s) => {
    const i = Object.keys(s.generatedImages || {}).length;
    const v = Object.keys(s.generatedVideos || {}).length;
    const a = Object.keys(s.generatedAudioPaths || {}).length;
    const d = Object.keys(s.generatedAssetDna || {}).length;
    return `${a}:${i}:${v}:${d}`;
  });
  const imageProvider = useNovelStore((s) => s.imageProvider);
  const imageModel = useNovelStore((s) => s.imageModel);
  const imageAspectRatio = useNovelStore((s) => s.imageAspectRatio);
  const videoProvider = useNovelStore((s) => s.videoProvider);
  const videoModel = useNovelStore((s) => s.videoModel);
  const videoAspectRatio = useNovelStore((s) => s.videoAspectRatio);
  const videoDuration = useNovelStore((s) => s.videoDuration);
  const ttsPlatform = useNovelStore((s) => s.ttsConfig?.platform);
  const ttsVoice = useNovelStore((s) => s.ttsConfig?.voice);
  const [dismissedIssueKey, setDismissedIssueKey] = useState('');
  const [report, setReport] = useState<MediaDnaMatchReport | null>(null);

  useEffect(() => {
    if (!isHydrated) {
      setReport(null);
      return;
    }
    // Debounce DNA evaluate — gen-all fires many map updates; avoid thrashing
    const t = window.setTimeout(() => {
      const s = useNovelStore.getState();
      const keys = chapterAssetKeys(s.chuong_dang_chon, {
        audio: s.generatedAudioPaths,
        images: s.generatedImages,
        videos: s.generatedVideos,
      });
      if (
        keys.audioKeys.length + keys.imageKeys.length + keys.videoKeys.length ===
        0
      ) {
        setReport(null);
        return;
      }
      setReport(
        evaluateMediaDnaMatch({
          chapterNum: s.chuong_dang_chon,
          audioKeys: keys.audioKeys,
          imageKeys: keys.imageKeys,
          videoKeys: keys.videoKeys,
          stamps: s.generatedAssetDna || {},
          live: liveDnaFromStoreLike({
            ttsConfig: s.ttsConfig,
            imageProvider: s.imageProvider,
            imageModel: s.imageModel,
            imageAspectRatio: s.imageAspectRatio,
            videoProvider: s.videoProvider,
            videoModel: s.videoModel,
            videoAspectRatio: s.videoAspectRatio,
            videoDuration: s.videoDuration,
          }),
        }),
      );
    }, 700);
    return () => window.clearTimeout(t);
  }, [
    isHydrated,
    ch,
    mediaCountSig,
    imageProvider,
    imageModel,
    imageAspectRatio,
    videoProvider,
    videoModel,
    videoAspectRatio,
    videoDuration,
    ttsPlatform,
    ttsVoice,
  ]);

  if (!report || !report.hasIssues || report.mismatches.length === 0) {
    return null;
  }

  const issueKey = report.mismatches
    .map((m) => `${m.key}:${m.field}`)
    .sort()
    .join('|');
  if (dismissedIssueKey && dismissedIssueKey === issueKey) return null;

  const rows = summarizeMediaDnaMismatches(report.mismatches).slice(0, 4);
  const summaryText = rows
    .map((r) =>
      r.count > 1 ? `${r.message} (×${r.count})` : r.message,
    )
    .join(' · ');

  return (
    <div className="mx-3 mb-1 flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100 shadow-lg backdrop-blur-sm">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <p className="font-bold text-amber-300">
          Media DNA lệch cấu hình hiện tại
        </p>
        <p className="mt-0.5 text-amber-100/80">
          {summaryText || report.warnings[0] || 'Có asset lệch DNA.'}
        </p>
        <p className="mt-1 text-[10px] text-amber-200/60">
          Ảnh/video/TTS đã gen trước có thể không khớp model/provider mới — cân
          nhắc gen lại nếu cần consistency.
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-amber-400/70 hover:bg-amber-900/40 hover:text-amber-200 cursor-pointer"
        title="Đóng gợi ý"
        onClick={() => setDismissedIssueKey(issueKey)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
