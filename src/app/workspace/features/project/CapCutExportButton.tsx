'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { API, chapterAssetPrefix } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
  toCapCutAspect,
} from '@/lib/outputCriteria';
import { evaluateShipGate, healthInputFromStore } from '@/lib/shipGate';

/** Project export — tách khỏi Header chrome; nhận chỉ tiêu Ảnh/Video + TTS */
export default function CapCutExportButton() {
  const store = useNovelStore();

  return (
    <button
      type="button"
      disabled={store.dang_tai || (!store.is_pro && !store.is_vip)}
      onClick={async () => {
        if (!store.is_pro && !store.is_vip) {
          toast.info('Notice', '⚠️ Tính năng này yêu cầu nâng cấp gói Pro/VIP!');
          return;
        }
        if (
          !confirm(
            '⚠️ Bạn có chắc chắn muốn xuất kịch bản này ra CapCut (Bao gồm Audio, Video, Ảnh)?',
          )
        ) {
          return;
        }
        try {
          store.setDangTai(true);

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

          const imageAspect =
            store.imageAspectRatio || criteria?.imageAspectRatio || '16:9';
          const videoAspect =
            store.videoAspectRatio || criteria?.videoAspectRatio || '16:9';
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
              if (
                !confirm(
                  `Media không khớp cài Ảnh/Video · TTS:\n\n${dnaLines}\n\nVẫn xuất CapCut?`,
                )
              ) {
                return;
              }
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
              videoDuration: store.videoDuration || criteria?.videoDuration || 6,
              imageProvider: store.imageProvider || criteria?.imageProvider,
              videoProvider: store.videoProvider || criteria?.videoProvider,
              mediaStylePreset: store.mediaStylePreset || criteria?.mediaStylePreset,
              visualDna: store.visualDnaPrompt || criteria?.visualDna,
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
          store.setDangTai(false);
        }
      }}
      className="flex items-center justify-center gap-1 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-sky-400 shadow-lg transition-all duration-300 hover:bg-sky-500 hover:text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
    >
      {store.dang_tai ? (
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
