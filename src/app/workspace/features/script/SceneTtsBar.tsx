'use client';

import React, { useMemo, useState } from 'react';
import { sceneAssetKey } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { Play, RefreshCw, Sparkles, Square } from 'lucide-react';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';
import {
  clearMultiPartial,
  countPartialParts,
  loadMultiPartial,
} from '@/lib/multiTtsPartialCache';
import { runCastPreflight } from '../../modules/castPreflight';
import RoleCastStudioModal from '../tts/RoleCastStudioModal';

type SceneTtsBarProps = {
  sceneContent: string;
  sceneIndex: number;
  chapterNum: number;
  manualDuration: string;
  setManualDuration: (value: string) => void;
  voiceDurationReference: number | null;
  isPlayingTTS: boolean;
  generatingTTS: boolean;
  ttsProgress: number;
  ttsStatus?: string;
  handlePlayTTS: (text: string, sceneIndex: number, voice: string) => Promise<void>;
  handleStopTTS: () => void;
  handleGenerateTTS: (
    sceneText: string,
    sceneIndex: number,
    voice: string,
    targetDuration?: number,
    options?: { forceFullMulti?: boolean; silent?: boolean; bypassYoutubeGate?: boolean },
  ) => Promise<number | undefined>;
};

export default function SceneTtsBar({
  sceneContent,
  sceneIndex,
  chapterNum,
  manualDuration,
  setManualDuration,
  voiceDurationReference,
  isPlayingTTS,
  generatingTTS,
  ttsProgress,
  ttsStatus = '',
  handlePlayTTS,
  handleStopTTS,
  handleGenerateTTS,
}: SceneTtsBarProps) {
  const store = useNovelStore();
  const [castStudioOpen, setCastStudioOpen] = useState(false);
  const [, setPartialTick] = useState(0);
  const cast = normalizeVoiceCast(store.voiceCast);
  const castActive = isCastActive(cast);
  const assetKey = sceneAssetKey(chapterNum, sceneIndex);
  const audioAsset = store.generatedAudioPaths[assetKey];

  const partialEntry = loadMultiPartial(chapterNum, sceneIndex);
  const partialCached = countPartialParts(partialEntry);
  const partialInfo = {
    cached: partialCached,
    total: partialEntry?.total || 0,
    has: partialCached > 0,
  };

  const castPreview = useMemo(() => {
    if (!sceneContent?.trim()) {
      return {
        multi: false,
        segs: 0,
        voices: 0,
        label: '',
        warns: [] as string[],
      };
    }
    try {
      const pf = runCastPreflight({
        sceneText: sceneContent,
        chapter: chapterNum,
        sceneIndex,
        cast,
        characterNames: store.nhan_vat || [],
        nhanVatPrompts: store.nhan_vat_prompts || {},
        defaultVoice: store.ttsConfig.voice || '',
        platform: store.ttsConfig.platform || 'edge_tts',
        language: store.ttsConfig.language || 'vi',
        globalSpeed: store.ttsConfig.speed ?? 1,
        globalPitch: store.ttsConfig.pitch ?? 0,
      });
      const warns = pf.issues
        .filter((i) => i.level === 'warn' || i.level === 'block')
        .map((i) => i.message);
      if (!castActive) {
        return {
          multi: false,
          segs: 0,
          voices: 0,
          label: '',
          warns,
        };
      }
      return {
        multi: pf.multi,
        segs: pf.segmentCount,
        voices: pf.voiceCount,
        label: pf.multi
          ? `Multi ${pf.voiceCount} giọng · ${pf.segmentCount} đoạn`
          : pf.segmentCount
            ? `Cast · ${pf.segmentCount} đoạn (đơn giọng)`
            : 'Cast ON',
        warns,
      };
    } catch {
      return {
        multi: false,
        segs: 0,
        voices: 0,
        label: castActive ? 'Cast ON' : '',
        warns: [] as string[],
      };
    }
  }, [
    castActive,
    cast,
    sceneContent,
    sceneIndex,
    chapterNum,
    store.nhan_vat,
    store.nhan_vat_prompts,
    store.ttsConfig.voice,
    store.ttsConfig.platform,
    store.ttsConfig.language,
    store.ttsConfig.speed,
    store.ttsConfig.pitch,
  ]);

  return (
    <>
      <div className="mt-2 rounded-lg border border-amber-900/30 bg-amber-950/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-amber-500 uppercase flex items-center gap-2 font-sans">
            <Sparkles className="h-3 w-3" />
            Trình Thu Âm AI Studio
          </h4>
        </div>

        <div className="flex flex-col sm:flex-row items-end gap-3">
          <div className="flex-1 w-full flex flex-col gap-1 bg-black/20 px-3 py-1.5 rounded border border-amber-900/20">
            <span className="text-[10px] text-zinc-400 font-sans italic">
              🌍 TTS: {store.ttsConfig.platform.toUpperCase()} · người kể = giọng mặc định · thoại{' '}
              <span className="text-sky-500/90">Tên NV:</span> đổi giọng theo hồ sơ
            </span>
            {castActive && castPreview.label ? (
              <span
                className={`text-[9px] font-bold uppercase tracking-wider font-sans ${
                  castPreview.multi ? 'text-emerald-400' : 'text-sky-400/90'
                }`}
              >
                🎭 {castPreview.label}
              </span>
            ) : null}
            {partialInfo.has ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider font-sans">
                  💾 Resume {partialInfo.cached}/{partialInfo.total} đoạn
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearMultiPartial(chapterNum, sceneIndex);
                    setPartialTick((t) => t + 1);
                  }}
                  className="text-[8px] font-bold uppercase text-zinc-500 hover:text-rose-400 cursor-pointer"
                  title="Xóa cache partial - gen full lại"
                >
                  Xóa cache
                </button>
              </div>
            ) : null}
            {castPreview.warns?.length ? (
              <span className="text-[9px] text-amber-500/90 font-sans leading-snug">
                ⚠️ {castPreview.warns[0]}
                {castPreview.warns.length > 1 ? ` (+${castPreview.warns.length - 1})` : ''}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end flex-wrap">
            <button
              type="button"
              onClick={() => {
                store.ensureVoiceCastSeeded();
                setCastStudioOpen(true);
              }}
              className={`h-8 px-3 rounded border text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer font-sans ${
                castActive
                  ? 'border-emerald-700/50 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                  : 'border-sky-900/40 bg-zinc-900 text-sky-400 hover:bg-zinc-850 hover:text-sky-300'
              }`}
              title="Role Casting Studio - gán giọng từng NV cho cảnh này"
            >
              🎭 Phân vai
              {castActive ? <span className="text-[9px] opacity-80">ON</span> : null}
            </button>

            <button
              type="button"
              onClick={() => {
                if (isPlayingTTS) {
                  handleStopTTS();
                } else {
                  handlePlayTTS(sceneContent, sceneIndex, '');
                }
              }}
              className="h-8 px-3 rounded border border-amber-900/40 bg-zinc-900 text-amber-400 text-xs font-bold hover:bg-zinc-850 hover:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer font-sans"
            >
              {isPlayingTTS ? (
                <Square className="h-3.5 w-3.5 fill-amber-400 shrink-0 border-none" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-amber-400 shrink-0 border-none" />
              )}
              {isPlayingTTS ? 'Dừng phát' : 'Nghe thử'}
            </button>

            <button
              type="button"
              disabled={generatingTTS}
              onClick={async (e) => {
                const durationVal =
                  manualDuration !== ''
                    ? parseInt(manualDuration) || 5
                    : voiceDurationReference || 5;
                const forceFull = e.shiftKey;

                const newDuration = await handleGenerateTTS(
                  sceneContent,
                  sceneIndex,
                  '',
                  durationVal,
                  forceFull ? { forceFullMulti: true } : undefined,
                );

                if (store.ttsConfig.syncMode === 'pro' && newDuration) {
                  setManualDuration(newDuration.toString());
                }
              }}
              title="Click: gen resume multi nếu có. Shift+Click: gen full lại mọi đoạn"
              className="h-8 px-4 rounded bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-sans"
            >
              {generatingTTS ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {ttsProgress > 0 ? `${ttsProgress}%` : 'Gen...'}
                </>
              ) : (
                <>Gen Audio & Lưu PC</>
              )}
            </button>
          </div>
        </div>

        {generatingTTS && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-600 to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(2, ttsProgress))}%` }}
              />
            </div>
            {ttsStatus ? (
              <p className="text-[10px] text-amber-400/90 font-sans truncate" title={ttsStatus}>
                {ttsStatus}
              </p>
            ) : null}
          </div>
        )}

        {audioAsset && (
          <div className="bg-zinc-950/60 border border-zinc-900/60 p-3 rounded-lg flex flex-col gap-2 mt-2">
            <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1 font-sans">
              🔊 TỆP ÂM THANH ĐÃ SINH
            </span>
            <audio controls src={audioAsset.path} className="w-full h-8" />
            <span className="text-[9px] text-zinc-500 font-sans">
              Thời lượng: {audioAsset.duration} giây. Tệp: {audioAsset.path}
            </span>
          </div>
        )}
      </div>

      <RoleCastStudioModal
        isOpen={castStudioOpen}
        onClose={() => setCastStudioOpen(false)}
        sceneText={sceneContent}
        chapter={chapterNum}
        sceneIndex={sceneIndex}
        initialTab="board"
      />
    </>
  );
}
