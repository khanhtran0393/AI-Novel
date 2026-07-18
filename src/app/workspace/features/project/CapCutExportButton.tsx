'use client';

import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { API, chapterAssetPrefix } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
  toCapCutAspect,
} from '@/lib/outputCriteria';
import { evaluateShipGate, healthInputFromStore } from '@/lib/shipGate';

/** Project export — busy riêng; không dang_tai global (không khóa nút khác) */
export default function CapCutExportButton() {
  const isPro = useNovelStore((s) => s.is_pro);
  const isVip = useNovelStore((s) => s.is_vip);
  const [exporting, setExporting] = useState(false);

  return (
    <button
      type="button"
      disabled={exporting || (!isPro && !isVip)}
      onClick={async () => {
        const store = useNovelStore.getState();
        if (!store.is_pro && !store.is_vip) {
          toast.info('Notice', '⚠️ Tính năng này yêu cầu nâng cấp gói Pro/VIP!');
          return;
        }
        const okExport = await appConfirm({
          title: 'Xuất CapCut',
          message:
            'Xuất kịch bản chương hiện tại ra CapCut (audio, video, ảnh gắn với chương).',
          details: [
            'Cần gói Pro/VIP',
            'Đảm bảo CapCut đã cài trên máy',
          ],
          confirmLabel: 'Xuất CapCut',
          cancelLabel: 'Hủy',
          tone: 'info',
        });
        if (!okExport) return;
        try {
          setExporting(true);

          const channel = store.getActiveChannel();
          const merged = channel
            ? mergeLiveSettingsIntoChannel(
                channel,
                {
                  mediaStylePreset: store.mediaStylePreset,
                  visualDnaPrompt: store.visualDnaPrompt,
                  imageProvider: store.imageProvider,
                  imageModel: store.imageModel,
                  imageAspectRatio: store.imageAspectRatio,
                  imageCount: store.imageCount,
                  videoProvider: store.videoProvider,
                  videoModel: store.videoModel,
                  videoAspectRatio: store.videoAspectRatio,
                  videoDuration: store.videoDuration,
                },
                {
                  platform: store.ttsConfig.platform,
                  voice: store.ttsConfig.voice,
                  language: store.ttsConfig.language,
                  speed: store.ttsConfig.speed,
                  pitch: store.ttsConfig.pitch,
                  syncMode: store.ttsConfig.syncMode,
                },
              )
            : null;
          const criteria = merged
            ? resolveOutputCriteria(merged, merged.defaultShipMode || 'longform')
            : null;

          const imageAspect = (store.imageAspectRatio || '').trim();
          const videoAspect = (store.videoAspectRatio || '').trim();
          if (!imageAspect) {
            throw new Error('Chua chon imageAspectRatio. App khong tu gan ty le anh.');
          }
          if (!videoAspect) {
            throw new Error('Chua chon videoAspectRatio. App khong tu gan ty le video.');
          }
          const videoDuration = Number(store.videoDuration);
          if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
            throw new Error('Chua chon videoDuration hop le. App khong tu gan thoi luong.');
          }
          if (!store.imageProvider?.trim()) {
            throw new Error('Chua chon imageProvider. App khong tu gan provider.');
          }
          if (!store.videoProvider?.trim()) {
            throw new Error('Chua chon videoProvider. App khong tu gan provider.');
          }
          const capCutAspect =
            criteria?.capCutAspect || toCapCutAspect(videoAspect);

          const chNum = store.chuong_dang_chon;
          const chPrefix = chapterAssetPrefix(chNum);
          const hasAudio = Object.keys(store.generatedAudioPaths || {}).some(
            (k) => k.startsWith(chPrefix) || k.startsWith(`${chNum}-`),
          );
          const hasImages = Object.keys(store.generatedImages || {}).some((k) =>
            k.startsWith(chPrefix),
          );
          const hasVideos = Object.keys(store.generatedVideos || {}).some((k) =>
            k.startsWith(chPrefix),
          );
          if (merged) {
            const gate = evaluateShipGate({
              channel: merged,
              mode: merged.defaultShipMode || 'longform',
              health: healthInputFromStore(store),
              hasAudio,
              hasImages,
              hasVideos,
              requireVisualAssets: true,
              chapterNum: chNum,
              liveMedia: {
                ttsConfig: store.ttsConfig,
                imageProvider: store.imageProvider,
                imageModel: store.imageModel,
                imageAspectRatio: store.imageAspectRatio,
                videoProvider: store.videoProvider,
                videoModel: store.videoModel,
                videoAspectRatio: store.videoAspectRatio,
                videoDuration: store.videoDuration,
                generatedAudioPaths: store.generatedAudioPaths,
                generatedImages: store.generatedImages,
                generatedVideos: store.generatedVideos,
                generatedAssetDna: store.generatedAssetDna,
              },
            });
            if (gate.blocked) {
              toast.info(
                'Notice',
                `⛔ CapCut bị chặn\n${gate.blockers.slice(0, 5).join('\n')}`,
              );
              return;
            }
            if (gate.mediaDna?.hasIssues) {
              const dnaLines = gate.warnings
                .filter((w) => w.includes('DNA media'))
                .slice(0, 3)
                .join('\n');
              const okDna = await appConfirm({
                title: 'Media lệch DNA',
                message:
                  'Media không khớp cài Ảnh/Video · TTS hiện tại. Vẫn xuất CapCut?',
                details: dnaLines.split('\n').filter(Boolean),
                confirmLabel: 'Vẫn xuất',
                cancelLabel: 'Hủy',
                tone: 'warn',
              });
              if (!okDna) return;
            } else if (gate.warnings.length) {
              toast.info(
                'Notice',
                `⚠️ CapCut: ${gate.warnings.slice(0, 2).join(' · ')}`,
              );
            }
          }

          const res = await fetch(API.exportCapcut, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chapterNum: store.chuong_dang_chon,
              ten_tac_pham: store.ten_tac_pham,
              generatedAudioPaths: store.generatedAudioPaths,
              generatedImages: store.generatedImages,
              generatedVideos: store.generatedVideos,
              // Chỉ tiêu từ hàng Ảnh / Video
              imageAspectRatio: imageAspect,
              videoAspectRatio: videoAspect,
              aspect: capCutAspect,
              videoDuration,
              imageProvider: store.imageProvider,
              videoProvider: store.videoProvider,
              mediaStylePreset: store.mediaStylePreset,
              visualDna: store.visualDnaPrompt,
              // Chỉ tiêu từ TTS
              ttsConfig: {
                platform: store.ttsConfig.platform,
                voice: store.ttsConfig.voice,
                language: store.ttsConfig.language,
                speed: store.ttsConfig.speed,
                pitch: store.ttsConfig.pitch,
                syncMode: store.ttsConfig.syncMode,
              },
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          const media = data.media
            ? `\nMedia: ảnh ${data.media.images}/video ${data.media.videos}/audio ${data.media.audios}`
            : '';
          const fc = data.fablecutPath ? `\nFableCut: ${data.fablecutPath}` : '';
          const crit = data.criteria
            ? `\nChỉ tiêu: CapCut ${data.criteria.capCutAspect} · TTS ${data.criteria.tts?.platform || '?'}`
            : '';
          toast.info(
            'Notice',
            `🎉 Xuất CapCut xong!\n${data.projectPath}${media}${fc}${crit}`,
          );
        } catch (error: unknown) {
          toast.info(
            'Notice',
            `❌ Lỗi xuất CapCut: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          setExporting(false);
        }
      }}
      className="flex items-center justify-center gap-1 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-sky-400 shadow-lg transition-all duration-300 hover:bg-sky-500 hover:text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
    >
      {exporting ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden sm:inline">XUẤT…</span>
        </>
      ) : (
        <>
          ✂️ <span className="hidden xl:inline">CapCut</span>
        </>
      )}
    </button>
  );
}
