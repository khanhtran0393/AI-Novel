'use client';
import { API } from '@/contracts';

import React, { useEffect } from 'react';
import type { TTSConfig } from '@/store/useNovelStore';
import { Cpu, ChevronDown, Globe, Volume2, Loader2, Play, Power } from 'lucide-react';
import {
  isVoiceValidForPlatform,
  resolveVoiceForPlatform,
  TTS_LANGUAGES,
  type VoiceCatalog,
} from '@/lib/voiceCatalog';
import { SELECT_DARK, SELECT_DARK_SM, OPTION_DARK } from '../ttsSelectStyles';
import TikTokSessionsPanel from '../TikTokSessionsPanel';
import { useOmniVoiceStatus } from '../hooks/useOmniVoiceStatus';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';

const LANGUAGES = [...TTS_LANGUAGES];

export type EngineVoiceTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  dynamicVoices: VoiceCatalog;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentVoices: any[];
  activeVoiceId: string;
  isPreviewing: boolean;
  handlePreviewVoice: () => void | Promise<void>;
  tiktokSessions: string[];
  newTikTokSessionInput: string;
  setNewTikTokSessionInput: (s: string) => void;
  isFetchingTikTokSession: boolean;
  copiedTikTokIdx: number | null;
  isTikTokWithoutSession: boolean;
  handleAutoFetchTikTokSession: () => void;
  handleSetPrimaryTikTokSession: (sid: string) => void;
  handleCopyTikTokSession: (sid: string, idx: number) => void;
  handleRemoveTikTokRow: (sid: string) => void;
  handleAddTikTokSessionsFromInput: () => void;
};

export default function EngineVoiceTab(props: EngineVoiceTabProps) {
  const {
    config,
    updateTTSConfig,
    dynamicVoices,
    currentVoices,
    activeVoiceId,
    isPreviewing,
    handlePreviewVoice,
    tiktokSessions,
    newTikTokSessionInput,
    setNewTikTokSessionInput,
    isFetchingTikTokSession,
    copiedTikTokIdx,
    isTikTokWithoutSession,
    handleAutoFetchTikTokSession,
    handleSetPrimaryTikTokSession,
    handleCopyTikTokSession,
    handleRemoveTikTokRow,
    handleAddTikTokSessionsFromInput,
  } = props;
  const store = { updateTTSConfig };
  const isFreeTier = useNovelStore(
    (s) => !s.is_pro && !s.is_trial && !s.is_vip,
  );
  const isOmni = config.platform === 'omnivoice_local';
  const { status: omniStatus, ensureStart: ensureOmni } = useOmniVoiceStatus(isOmni);
  const platformSelectValue = config.platform;

  // Giọng đang chọn không thuộc nền tảng hiện tại (stale sau đổi platform) → sửa ngay
  useEffect(() => {
    if (!config.platform) return;
    if (
      isVoiceValidForPlatform(
        dynamicVoices,
        config.platform,
        config.language || 'vi',
        config.voice || '',
      )
    ) {
      return;
    }
    if (!currentVoices.length && !config.voice) return;
    const fixed = resolveVoiceForPlatform(
      dynamicVoices,
      config.platform,
      config.language || 'vi',
      '',
      { keepPreferred: false },
    );
    if (!fixed.voice || fixed.voice === config.voice) return;
    store.updateTTSConfig({
      language: fixed.language,
      voice: fixed.voice,
      vinaUseClone: config.platform === 'vina_voice',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when platform/voice/list drift
  }, [config.platform, config.language, config.voice, currentVoices, dynamicVoices]);

  const selectVoiceId =
    currentVoices.some((v: { id: string }) => v.id === activeVoiceId)
      ? activeVoiceId
      : currentVoices[0]?.id || '';

  return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  <Cpu className="h-3.5 w-3.5 text-sky-400" /> Nền tảng
                </label>
                <div className="relative w-full">
                  <select
                    value={platformSelectValue}
                    onChange={(e) => {
                      const newPlatform = e.target.value as TTSConfig['platform'];
                      if (
                        isFreeTier &&
                        !FREE_TTS_PLATFORMS.has(String(newPlatform).toLowerCase())
                      ) {
                        toast.error(
                          'Gói Free',
                          `«${newPlatform}» cần Trial/Pro. Free chỉ Edge TTS hoặc Piper.`,
                        );
                        return;
                      }
                      // Đổi nền tảng = luôn gán giọng default hợp lệ (không giữ voice engine cũ)
                      const next = resolveVoiceForPlatform(
                        dynamicVoices,
                        newPlatform,
                        config.language || 'vi',
                        '',
                        { keepPreferred: false },
                      );
                      store.updateTTSConfig({
                        platform: newPlatform,
                        language: next.language,
                        voice: next.voice,
                        vinaUseClone: newPlatform === 'vina_voice',
                      });
                      if (newPlatform === 'omnivoice_local') {
                        // Fire-and-forget warm start — TTS path also ensureOmniServer
                        void fetch(API.omnivoiceStatus, { method: 'POST' }).catch(() => {});
                      }
                    }}
                    className={SELECT_DARK}
                  >
                    <option className={OPTION_DARK} value="edge_tts">Microsoft Edge TTS</option>
                    <option className={OPTION_DARK} value="piper">Piper VN (.onnx local)</option>
                    {!isFreeTier ? (
                      <>
                        <option className={OPTION_DARK} value="vieneu_tts">VieNeu SDK (local clone)</option>
                        <option className={OPTION_DARK} value="omnivoice_local">OmniVoice Local</option>
                        <option className={OPTION_DARK} value="vina_voice">VinaVoice</option>
                        <option className={OPTION_DARK} value="capcut_tts">CapCut TTS</option>
                        <option className={OPTION_DARK} value="tiktok_tts">TikTok TTS</option>
                        <option className={OPTION_DARK} value="gemini_tts">Gemini TTS</option>
                      </>
                    ) : null}
                    {/* Hotai: API fetch fail trên môi trường này — không liệt kê (B10: không fallback) */}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
                {isOmni && (
                  <div className="mt-1.5 rounded border border-sky-900/40 bg-sky-950/20 px-2 py-1.5 space-y-1.5">
                    <p className="text-[10px] text-sky-300/95 leading-snug">
                      <strong>OmniVoice</strong> — chỉ gọi engine này (exclusive GPU). Vina sẽ được
                      unload khi gen Omni. Chọn <strong>clone library</strong> (omnivoice_…) hoặc
                      preset (alloy/nova). Không tự đổi sang Edge/Piper.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          omniStatus.online
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-700/40'
                            : omniStatus.starting
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-700/40'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            omniStatus.online
                              ? 'bg-emerald-400'
                              : omniStatus.starting
                                ? 'bg-amber-400 animate-pulse'
                                : 'bg-zinc-500'
                          }`}
                        />
                        {omniStatus.starting
                          ? 'Đang khởi động…'
                          : omniStatus.online
                            ? omniStatus.modelLoaded === false
                              ? 'Online · load model…'
                              : 'Engine sẵn sàng'
                            : omniStatus.loading
                              ? 'Đang kiểm tra…'
                              : 'Engine offline'}
                      </span>
                      {!omniStatus.online && (
                        <button
                          type="button"
                          disabled={omniStatus.starting}
                          onClick={() => void ensureOmni()}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-50"
                        >
                          {omniStatus.starting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Power className="h-3 w-3" />
                          )}
                          Bật engine
                        </button>
                      )}
                    </div>
                    {omniStatus.message && !omniStatus.online && (
                      <p className="text-[9px] text-zinc-500 leading-snug">{omniStatus.message}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" /> Ngôn ngữ
                </label>
                <div className="relative w-full">
                  <select
                    value={config.language}
                    onChange={(e) => {
                      const newLang = e.target.value;
                      const next = resolveVoiceForPlatform(
                        dynamicVoices,
                        config.platform,
                        newLang,
                        config.voice,
                        { keepPreferred: true },
                      );
                      store.updateTTSConfig({
                        language: next.language,
                        voice: next.voice,
                      });
                    }}
                    className={SELECT_DARK}
                  >
                    {LANGUAGES.map((lang) => (
                      <option className={OPTION_DARK} key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Giọng đọc
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({currentVoices.length})
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      title={
                        isPreviewing
                          ? 'Bấm để hủy nghe thử'
                          : isTikTokWithoutSession
                            ? 'Thiếu SessionID TikTok — nghe thử sẽ lỗi, không tự đổi engine khác'
                            : 'Nghe thử giọng đang chọn'
                      }
                      className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
                        isPreviewing
                          ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                          : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                      }`}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {isPreviewing ? 'Hủy' : 'Nghe thử'}
                    </button>
                  )}
                </label>
                <div className="relative w-full">
                  <select
                    value={selectVoiceId}
                    onChange={(e) => store.updateTTSConfig({ voice: e.target.value })}
                    className={SELECT_DARK}
                  >
                    {currentVoices.length === 0 && (
                      <option className={OPTION_DARK} value="">
                        Không có giọng
                      </option>
                    )}
                    {currentVoices.map((v: { id: string; name: string }, i: number) => (
                      <option className={OPTION_DARK} key={`${v.id}__${i}`} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
                {config.voice &&
                  currentVoices.length > 0 &&
                  !currentVoices.some((v: { id: string }) => v.id === config.voice) && (
                    <p className="text-[10px] text-amber-400/90 leading-snug">
                      Giọng «{config.voice}» không thuộc nền tảng đang chọn — đang đồng bộ sang «
                      {selectVoiceId || '…'}».
                    </p>
                  )}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Tốc độ
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={config.speed}
                    onChange={(e) =>
                      store.updateTTSConfig({ speed: parseFloat(e.target.value) })
                    }
                    className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-10 text-right">
                    {Number(config.speed || 1).toFixed(1)}x
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Pitch (semitone)
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={config.pitch || 0}
                    onChange={(e) =>
                      store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
                    }
                    className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                    {(config.pitch || 0) > 0 ? `+${config.pitch}` : config.pitch || 0}
                  </span>
                </div>
              </div>
              {config.platform === 'tiktok_tts' && (
                <TikTokSessionsPanel
                  sessions={tiktokSessions}
                  primarySessionId={config.tiktokSessionId || ''}
                  newInput={newTikTokSessionInput}
                  setNewInput={setNewTikTokSessionInput}
                  isFetching={isFetchingTikTokSession}
                  copiedIdx={copiedTikTokIdx}
                  showMissingWarn={!!isTikTokWithoutSession}
                  onAutoFetch={handleAutoFetchTikTokSession}
                  onSetPrimary={handleSetPrimaryTikTokSession}
                  onCopy={handleCopyTikTokSession}
                  onRemove={handleRemoveTikTokRow}
                  onAddFromInput={handleAddTikTokSessionsFromInput}
                />
              )}

              {config.platform === 'vieneu_tts' && (
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-zinc-800">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu API URL
                  </label>
                  <input
                    type="text"
                    placeholder="http://localhost:3000/api/v1"
                    value={config.api_url_vieneu || ''}
                    onChange={(e) => store.updateTTSConfig({ api_url_vieneu: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500"
                  />
                </div>
              )}

            </div>
  );
}
