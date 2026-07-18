'use client';
import { API, chapterAssetPrefix } from '@/contracts';

import React, { useMemo, useState } from 'react';
import { X, Radio, Clapperboard, Film, Download, Loader2 } from 'lucide-react';
import { useNovelStore, type ShipMode } from '@/store/useNovelStore';
import { getRecipe } from '@/lib/channelModel';
import {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
} from '@/lib/outputCriteria';
import { evaluateShipGate, healthInputFromStore } from '@/lib/shipGate';
import { appConfirm } from '@/lib/confirmDialog';

interface ShipPackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODES: Array<{
  mode: ShipMode;
  label: string;
  icon: React.ReactNode;
  desc: string;
}> = [
  {
    mode: 'radio',
    label: 'Radio / Audio drama',
    icon: <Radio className="h-4 w-4" />,
    desc: 'TTS đa vai + SRT + SEO — không bắt buộc ảnh',
  },
  {
    mode: 'short',
    label: 'Shorts / Reels 9:16',
    icon: <Clapperboard className="h-4 w-4" />,
    desc: 'Script ngắn + 1 shot/cảnh + pack dọc',
  },
  {
    mode: 'longform',
    label: 'Longform YouTube',
    icon: <Film className="h-4 w-4" />,
    desc: 'Hook + chương + storyboard + ship đầy đủ',
  },
];

export default function ShipPackModal({ isOpen, onClose }: ShipPackModalProps) {
  const store = useNovelStore();
  const channel = store.getActiveChannel();
  const [mode, setMode] = useState<ShipMode>(
    channel?.defaultShipMode || 'longform',
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    outDir?: string;
    checklist?: string[];
    error?: string;
  } | null>(null);

  const chapter = useMemo(
    () =>
      store.danh_sach_chuong.find((c) => c.so_chuong === store.chuong_dang_chon) ||
      store.danh_sach_chuong[0],
    [store.danh_sach_chuong, store.chuong_dang_chon],
  );

  const recipe = channel ? getRecipe(channel, mode) : null;

  if (!isOpen) return null;

  const handleShip = async () => {
    if (!channel || !chapter) {
      setResult({ error: 'Thiếu kênh hoặc chương.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      store.saveActiveChannelSnapshot();
      // Sync full Ảnh/Video + TTS DNA from toolbar into channel (chỉ tiêu đầu ra)
      const merged = mergeLiveSettingsIntoChannel(
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
          vinaGender: store.ttsConfig.vinaGender,
          vinaArea: store.ttsConfig.vinaArea,
          vinaGroup: store.ttsConfig.vinaGroup,
          vinaEmotion: store.ttsConfig.vinaEmotion,
          vinaUseClone: store.ttsConfig.vinaUseClone,
          vinaSpeakerSeed: store.ttsConfig.vinaSpeakerSeed,
          vinaStyleSeed: store.ttsConfig.vinaStyleSeed,
        },
      );
      store.updateChannel(channel.id, {
        narratorVoiceId: merged.narratorVoiceId,
        ttsPlatform: merged.ttsPlatform,
        visualDna: merged.visualDna,
        defaultShipMode: mode,
        outputDna: merged.outputDna,
        ttsDna: merged.ttsDna,
      });
      const liveBase = store.getActiveChannel() || channel;
      const live = mergeLiveSettingsIntoChannel(
        { ...liveBase, defaultShipMode: mode },
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
          vinaGender: store.ttsConfig.vinaGender,
          vinaArea: store.ttsConfig.vinaArea,
          vinaGroup: store.ttsConfig.vinaGroup,
          vinaEmotion: store.ttsConfig.vinaEmotion,
          vinaUseClone: store.ttsConfig.vinaUseClone,
          vinaSpeakerSeed: store.ttsConfig.vinaSpeakerSeed,
          vinaStyleSeed: store.ttsConfig.vinaStyleSeed,
        },
      );
      const hook = store.chapterHooks[chapter.so_chuong];
      const criteriaPreview = resolveOutputCriteria(live, mode);

      const chNum = chapter.so_chuong;
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
      const gate = evaluateShipGate({
        channel: live,
        mode,
        health: healthInputFromStore(store),
        hasAudio,
        hasImages,
        hasVideos,
        requireVisualAssets: criteriaPreview.recipe.includeVisual,
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
        const msg = [
          gate.summary,
          ...gate.blockers.slice(0, 6),
          gate.warnings.length
            ? `Cảnh báo: ${gate.warnings.slice(0, 3).join(' · ')}`
            : '',
          'Mở Ảnh/Video · TTS · Settings để sửa credential/cài đặt, hoặc gen media trước.',
        ]
          .filter(Boolean)
          .join('\n');
        setResult({ error: msg });
        setBusy(false);
        return;
      }
      // DNA lệch cài đặt → confirm, không chặn cứng (warn)
      if (gate.mediaDna?.hasIssues && gate.warnings.some((w) => w.includes('DNA media'))) {
        const preview = gate.warnings
          .filter((w) => w.includes('DNA media'))
          .slice(0, 4)
          .join('\n');
        const okShip = await appConfirm({
          title: 'Media lệch DNA',
          message:
            'Media không khớp cài Ảnh/Video · TTS hiện tại. Nên gen lại TTS/ảnh trước khi ship.',
          details: preview.split('\n').filter(Boolean),
          confirmLabel: 'Vẫn ship pack',
          cancelLabel: 'Hủy',
          tone: 'warn',
        });
        if (!okShip) {
          setResult({
            error: `Đã hủy ship — media lệch DNA.\n${preview}`,
          });
          setBusy(false);
          return;
        }
      }

      const res = await fetch(API.shipPack, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          channel: live,
          /** Explicit criteria mirror (server also resolves from channel DNA) */
          outputCriteria: {
            imageAspectRatio: criteriaPreview.imageAspectRatio,
            videoAspectRatio: criteriaPreview.videoAspectRatio,
            capCutAspect: criteriaPreview.capCutAspect,
            tts: criteriaPreview.tts,
            outputDna: criteriaPreview.outputDna,
          },
          ten_tac_pham: store.ten_tac_pham,
          chapter: {
            so_chuong: chapter.so_chuong,
            tieu_de: chapter.tieu_de,
            dan_y: chapter.dan_y,
            noi_dung: chapter.noi_dung,
          },
          chapterHooks: hook || null,
          voiceCast: store.voiceCast,
          nhan_vat: store.nhan_vat,
          nhan_vat_prompts: store.nhan_vat_prompts,
          generatedAudioPaths: store.generatedAudioPaths,
          generatedImages: store.generatedImages,
          generatedVideos: store.generatedVideos,
          generatedPrompts: store.generatedPrompts,
          generatedAssetDna: store.generatedAssetDna,
          liveMediaDna: {
            ttsPlatform: store.ttsConfig.platform,
            ttsVoice: store.ttsConfig.voice,
            ttsSpeed: store.ttsConfig.speed,
            ttsPitch: store.ttsConfig.pitch,
            imageProvider: store.imageProvider,
            imageModel: store.imageModel,
            imageAspectRatio: store.imageAspectRatio,
            videoProvider: store.videoProvider,
            videoModel: store.videoModel,
            videoAspectRatio: store.videoAspectRatio,
            videoDuration: store.videoDuration,
          },
          savePathRoot:
            live.savePathRoot ||
            store.savePathTTS ||
            store.googleDrivePath ||
            undefined,
          /** Align ship word-gate with Cổng từ UI / WRITE_CHAPTER */
          so_tu_chuong: store.setup?.so_tu_chuong || 4250,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Remember hook line on channel anti-reuse memory
      if (hook?.hook) store.rememberChannelMotif('hook', hook.hook.slice(0, 120));
      if (hook?.thumbnailLine) {
        store.rememberChannelMotif('thumb', hook.thumbnailLine.slice(0, 80));
      }
      setResult({ outDir: data.outDir, checklist: data.checklist });
    } catch (e: unknown) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100 mb-1">
          Ship Pack
        </h2>
        <p className="text-[11px] text-zinc-500 mb-4">
          Kênh:{' '}
          <span className="text-emerald-400 font-semibold">
            {channel?.name || '—'}
          </span>
          {' · '}
          Chương {chapter?.so_chuong}: {chapter?.tieu_de || '—'}
        </p>

        <div className="space-y-2 mb-4">
          {MODES.map((m) => {
            const on = mode === m.mode;
            const rec = channel?.shipRecipes.find((r) => r.mode === m.mode);
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => setMode(m.mode)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer ${
                  on
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-100">
                  <span className={on ? 'text-amber-400' : 'text-zinc-500'}>
                    {m.icon}
                  </span>
                  {m.label}
                  {rec?.aspectRatio && (
                    <span className="ml-auto text-[9px] font-semibold text-zinc-500">
                      {rec.aspectRatio}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-500 pl-6">{m.desc}</p>
              </button>
            );
          })}
        </div>

        {recipe && (
          <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[10px] text-zinc-400 space-y-0.5">
            <div>
              Recipe aspect:{' '}
              <strong className="text-zinc-200">{recipe.aspectRatio}</strong>
              {' · '}
              Ảnh/Video live:{' '}
              <strong className="text-indigo-300">
                {store.imageAspectRatio || '—'} / {store.videoAspectRatio || '—'}
              </strong>
            </div>
            <div>
              TTS live:{' '}
              <strong className="text-violet-300">
                {store.ttsConfig?.platform || '—'} / {store.ttsConfig?.voice || '—'}
              </strong>
            </div>
            <div>
              CapCut map:{' '}
              <strong className="text-sky-300">
                {channel
                  ? resolveOutputCriteria(
                      mergeLiveSettingsIntoChannel(
                        channel,
                        {
                          imageAspectRatio: store.imageAspectRatio,
                          videoAspectRatio: store.videoAspectRatio,
                        },
                        {
                          platform: store.ttsConfig?.platform,
                          voice: store.ttsConfig?.voice,
                        },
                      ),
                      mode,
                    ).capCutAspect
                  : '—'}
              </strong>
            </div>
            <div>
              Hook {recipe.includeHook ? '✓' : '—'} · SRT{' '}
              {recipe.includeSrt ? '✓' : '—'} · SEO{' '}
              {recipe.includeSeo ? '✓' : '—'} · Visual{' '}
              {recipe.includeVisual ? '✓' : '—'}
            </div>
            <div className="text-zinc-600">{recipe.description}</div>
          </div>
        )}

        {result?.error && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
            {result.error}
          </div>
        )}

        {result?.outDir && (
          <div className="mb-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300 space-y-1">
            <div className="font-bold">Đã xuất ship pack</div>
            <div className="text-[10px] break-all text-emerald-400/80">
              {result.outDir}
            </div>
            {result.checklist && (
              <ul className="mt-1 space-y-0.5 text-[10px] text-zinc-400">
                {result.checklist.slice(0, 6).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy || !chapter}
          onClick={handleShip}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 py-2.5 text-xs font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang đóng gói…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Xuất {MODES.find((m) => m.mode === mode)?.label}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
