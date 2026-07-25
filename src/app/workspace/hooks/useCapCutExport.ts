'use client';

import { useState } from 'react';
import { chapterAssetPrefix, parseSceneAssetKey } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
  toCapCutAspect,
} from '@/lib/outputCriteria';
import { evaluateShipGate, healthInputFromStore } from '@/lib/shipGate';
import {
  exportCapCutPack,
  openBundledCapCutEditor,
} from '../modules/capCutModule';
import { useProAccess } from './useProAccess';

/**
 * CapCut/XinChao export orchestration. UI components only invoke this hook;
 * API and Electron bridge details remain in the module layer.
 */
export function useCapCutExport() {
  const { isProEquivalent, requirePro } = useProAccess();
  const [exporting, setExporting] = useState(false);

  const handleExportCapCut = async () => {
    const gatePro = requirePro('export_capcut');
    if (!gatePro.ok) {
      toast.info('Pro', gatePro.message);
      return;
    }
    const okExport = await appConfirm({
      title: 'Xuất CapCut',
      message:
        'Xuất kịch bản chương hiện tại ra CapCut (audio, video, ảnh gắn với chương).',
      details: [
        'Cần gói Pro hoặc Trial',
        'Đóng gói media + mở editor multi-track trong app',
      ],
      confirmLabel: 'Xuất CapCut',
      cancelLabel: 'Hủy',
      tone: 'info',
    });
    if (!okExport) return;

    try {
      setExporting(true);

      // Ghost paths (store but no disk) must not make a partial pack look valid.
      try {
        const beforeReconcile = useNovelStore.getState();
        const liveSceneIndices = Object.keys(
          beforeReconcile.generatedPrompts || {},
        )
          .map(parseSceneAssetKey)
          .filter(
            (
              parsed,
            ): parsed is { chapter: number; sceneIndex: number } =>
              parsed?.chapter === beforeReconcile.chuong_dang_chon,
          )
          .map((parsed) => parsed.sceneIndex);
        const ghost = await beforeReconcile.reconcileMissingMediaAssets?.({
          discoverChapterNum: beforeReconcile.chuong_dang_chon,
          discoverSceneIndices: liveSceneIndices,
        });
        const added =
          (ghost?.addedAudio || 0) +
          (ghost?.addedImage || 0) +
          (ghost?.addedVideo || 0);
        const removed =
          (ghost?.removedAudio || 0) +
          (ghost?.removedImage || 0) +
          (ghost?.removedVideo || 0);
        if (added > 0) {
          toast.success(
            'Media trên đĩa',
            ghost?.summary ||
              'Đã nạp media thật từ output nội bộ của AI Novel.',
          );
        }
        if (removed > 0) {
          toast.warn(
            'Media ảo',
            ghost.summary ||
              'Đã gỡ đường dẫn media mất file — gen lại trước khi export nếu thiếu.',
          );
        }
      } catch {
        /* reconciliation is advisory; the server pack still validates disk truth */
      }

      const store = useNovelStore.getState();
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
        throw new Error('Chưa chọn imageAspectRatio. App không tự gán tỷ lệ ảnh.');
      }
      if (!videoAspect) {
        throw new Error('Chưa chọn videoAspectRatio. App không tự gán tỷ lệ video.');
      }
      const videoDuration = Number(store.videoDuration);
      if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
        throw new Error('Chưa chọn videoDuration hợp lệ. App không tự gán thời lượng.');
      }
      if (!store.imageProvider?.trim()) {
        throw new Error('Chưa chọn imageProvider. App không tự gán provider.');
      }
      if (!store.videoProvider?.trim()) {
        throw new Error('Chưa chọn videoProvider. App không tự gán provider.');
      }
      const capCutAspect =
        criteria?.capCutAspect || toCapCutAspect(videoAspect);

      const chNum = store.chuong_dang_chon;
      const chPrefix = chapterAssetPrefix(chNum);
      const hasAudio = Object.keys(store.generatedAudioPaths || {}).some(
        (key) => key.startsWith(chPrefix) || key.startsWith(`${chNum}-`),
      );
      const hasImages = Object.keys(store.generatedImages || {}).some((key) =>
        key.startsWith(chPrefix),
      );
      const hasVideos = Object.keys(store.generatedVideos || {}).some((key) =>
        key.startsWith(chPrefix),
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
          requireAudio: false,
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
            .filter((warning) => warning.includes('DNA media'))
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

      try {
        const { isLabyrinthClientShadow, executeClientWrongPremium } =
          await import('@/lib/commercial/labyrinth/clientShadow');
        if (isLabyrinthClientShadow()) {
          executeClientWrongPremium('export_capcut', {
            chapterNum: store.chuong_dang_chon,
          });
        }
      } catch {
        /* optional commercial shadow */
      }

      const data = await exportCapCutPack({
        chapterNum: store.chuong_dang_chon,
        ten_tac_pham: store.ten_tac_pham,
        generatedAudioPaths: store.generatedAudioPaths,
        generatedImages: store.generatedImages,
        generatedVideos: store.generatedVideos,
        imageAspectRatio: imageAspect,
        videoAspectRatio: videoAspect,
        aspect: capCutAspect,
        videoDuration,
        imageProvider: store.imageProvider,
        videoProvider: store.videoProvider,
        mediaStylePreset: store.mediaStylePreset,
        visualDna: store.visualDnaPrompt,
        ttsConfig: {
          platform: store.ttsConfig.platform,
          voice: store.ttsConfig.voice,
          language: store.ttsConfig.language,
          speed: store.ttsConfig.speed,
          pitch: store.ttsConfig.pitch,
          syncMode: store.ttsConfig.syncMode,
        },
        openEditor: true,
      });

      const openNote = await openBundledCapCutEditor({
        packRoot: data.projectPath,
        mediaDir: data.mediaDir,
      });
      const media = data.media
        ? `\nMedia: ảnh ${data.media.images}/video ${data.media.videos}/audio ${data.media.audios}`
        : '';
      const crit = data.criteria
        ? `\nChỉ tiêu: CapCut ${data.criteria.capCutAspect} · TTS ${data.criteria.tts?.platform || '?'}`
        : '';
      toast.info(
        'Notice',
        `🎉 Xuất CapCut xong!\n${data.projectPath}${media}${crit}${openNote}`,
      );
      try {
        const { markOnboardingStep } = await import('@/lib/onboarding');
        markOnboardingStep('export');
      } catch {
        /* optional onboarding state */
      }
    } catch (error: unknown) {
      toast.info(
        'Notice',
        `❌ Lỗi xuất CapCut: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    isProEquivalent,
    handleExportCapCut,
  };
}
