'use client';

/**
 * Live banner: generated media DNA vs current Ảnh/Video · TTS toolbar settings.
 * Soft warn only — user can re-gen or ignore until Ship/CapCut confirm.
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  chapterAssetKeys,
  evaluateMediaDnaMatch,
  liveDnaFromStoreLike,
} from '@/lib/mediaDnaMatch';

export default function MediaDnaBanner() {
  const store = useNovelStore();
  const [dismissed, setDismissed] = useState(false);
  const ch = store.chuong_dang_chon;

  const report = useMemo(() => {
    if (!store.isHydrated) return null;
    const keys = chapterAssetKeys(ch, {
      audio: store.generatedAudioPaths,
      images: store.generatedImages,
      videos: store.generatedVideos,
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
      stamps: store.generatedAssetDna || {},
      live: liveDnaFromStoreLike({
        ttsConfig: store.ttsConfig,
        imageProvider: store.imageProvider,
        imageModel: store.imageModel,
        imageAspectRatio: store.imageAspectRatio,
        videoProvider: store.videoProvider,
        videoModel: store.videoModel,
        videoAspectRatio: store.videoAspectRatio,
        videoDuration: store.videoDuration,
      }),
    });
  }, [
    store.isHydrated,
    ch,
    store.generatedAudioPaths,
    store.generatedImages,
    store.generatedVideos,
    store.generatedAssetDna,
    store.ttsConfig,
    store.imageProvider,
    store.imageModel,
    store.imageAspectRatio,
    store.videoProvider,
    store.videoModel,
    store.videoAspectRatio,
    store.videoDuration,
  ]);

  // Reset dismiss when chapter or report changes materially
  const issueKey = report?.hasIssues
    ? `${ch}:${report.mismatches.map((m) => m.field + m.actual).join('|')}`
    : '';
  React.useEffect(() => {
    setDismissed(false);
  }, [issueKey]);

  if (!report?.hasIssues || dismissed) return null;

  const lines = report.mismatches.slice(0, 3).map((m) => m.message);
  const more =
    report.mismatches.length > 3
      ? ` (+${report.mismatches.length - 3} nữa)`
      : '';

  return (
    <div
      role="status"
      className="shrink-0 border-b border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100 sm:px-4"
    >
      <div className="mx-auto flex max-w-[1600px] items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-bold uppercase tracking-wider text-amber-300">
            Media lệch cài Ảnh/Video · TTS (chương {ch})
          </div>
          <ul className="mt-0.5 list-inside list-disc text-amber-100/90">
            {lines.map((l) => (
              <li key={l} className="truncate">
                {l}
              </li>
            ))}
          </ul>
          {more ? (
            <div className="mt-0.5 text-amber-200/70">{more}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-amber-200/80">
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Gen lại TTS / ảnh theo toolbar hiện tại để khớp DNA
            </span>
            <span className="text-zinc-500">
              · stamp {report.stamped}/{report.checked}
              {report.unstamped ? ` · chưa stamp ${report.unstamped}` : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-lg p-1 text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-200 cursor-pointer"
          title="Ẩn cảnh báo"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
