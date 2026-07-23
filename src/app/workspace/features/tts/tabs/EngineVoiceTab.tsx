'use client';

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import type { TTSConfig } from '@/store/useNovelStore';
import {
  Cpu,
  ChevronDown,
  Globe,
  Volume2,
  Loader2,
  Play,
  Search,
} from 'lucide-react';
import {
  isVoiceValidForPlatform,
  resolveVoiceForPlatform,
  TTS_LANGUAGES,
  type VoiceCatalog,
  type VoiceOption,
} from '@/lib/voiceCatalog';
import { SELECT_DARK, OPTION_DARK } from '../ttsSelectStyles';
import TikTokSessionsPanel from '../TikTokSessionsPanel';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import {
  TTS_PLATFORM_LABELS,
  ENGINE_MANUAL_TTS_PLATFORMS,
  isEngineManualTtsPlatform,
  isRemovedTtsPlatform,
  isLaStudioEnvPlatform,
  suggestMigrateTtsPlatform,
} from '@/lib/tts/activePlatforms';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import type { CapCutPrepDiag } from '@/lib/voiceCatalogPrep';

function genderLabel(g?: string): string {
  if (g === 'female') return 'Nữ';
  if (g === 'male') return 'Nam';
  if (g === 'neutral') return 'Trung';
  return '';
}

const LANGUAGES = [...TTS_LANGUAGES];

const PLATFORM_LABELS = TTS_PLATFORM_LABELS;

export type EngineVoiceTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  dynamicVoices: VoiceCatalog;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentVoices: VoiceOption[];
  activeVoiceId: string;
  isPreviewing: boolean;
  /** Optional voiceId — ▶ từng hàng Voice library (giống LA Studio) */
  handlePreviewVoice: (voiceId?: string) => void | Promise<void>;
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
  /** CapCut sscronet diagnose (từ /api/tts/voices) */
  capcutDiag?: CapCutPrepDiag | null;
};

export default function EngineVoiceTab(props: EngineVoiceTabProps) {
  const {
    config,
    updateTTSConfig,
    dynamicVoices,
    currentVoices,
    // activeVoiceId kept in props for parent API compat; select binds config.voice
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
    capcutDiag,
  } = props;
  const store = { updateTTSConfig };
  const isFreeTier = useNovelStore(
    (s) => !s.is_pro && !s.is_trial && !s.is_vip,
  );
  const isCapCut = config.platform === 'capcut_tts';
  const [voiceQuery, setVoiceQuery] = useState('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Clear row spinner when parent preview ends
  useEffect(() => {
    if (!isPreviewing) setPreviewingId(null);
  }, [isPreviewing]);

  // Reset search when platform/language changes
  useEffect(() => {
    setVoiceQuery('');
  }, [config.platform, config.language]);

  const filteredVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase().normalize('NFC');
    if (!q) return currentVoices as VoiceOption[];
    return (currentVoices as VoiceOption[]).filter((v) => {
      const hay = `${v.name || ''} ${v.id || ''} ${v.locale || ''} ${v.gender || ''}`
        .toLowerCase()
        .normalize('NFC');
      return hay.includes(q);
    });
  }, [currentVoices, voiceQuery]);

  const selectVoice = useCallback(
    (id: string) => {
      store.updateTTSConfig({ voice: id });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Nghe thử đúng 1 hàng (override voiceId). Bấm lại khi đang phát = hủy.
   */
  const previewOneVoice = useCallback(
    async (id: string) => {
      if (isPreviewing) {
        // Cancel current (same or different row) via parent toggle
        void handlePreviewVoice();
        setPreviewingId(null);
        return;
      }
      setPreviewingId(id);
      if (config.voice !== id) {
        store.updateTTSConfig({ voice: id });
      }
      try {
        await handlePreviewVoice(id);
      } finally {
        // parent isPreviewing may still be true until audio ends; effect clears
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPreviewing, handlePreviewVoice, config.voice],
  );

  // Engine tab only lists manual engines. LA Studio / Omni → parent switches tab or migrates.
  const platformSelectValue = isEngineManualTtsPlatform(config.platform)
    ? config.platform
    : 'edge_tts';
  const platformInFreeList = FREE_TTS_PLATFORMS.has(
    String(platformSelectValue).toLowerCase(),
  );
  /** Persist stale / free-locked premium that still belongs in Engine list */
  const showStalePremiumOption =
    !!config.platform &&
    isEngineManualTtsPlatform(config.platform) &&
    !isRemovedTtsPlatform(config.platform) &&
    isFreeTier &&
    !platformInFreeList;

  // Persist cũ platform đã gỡ → auto-migrate (không silent gen bằng engine chết).
  // Không migrate la_studio/omnivoice ở đây — parent modal đưa sang tab LA Studio.
  useEffect(() => {
    const plat = String(config.platform || '').trim();
    if (!plat || isEngineManualTtsPlatform(plat) || isLaStudioEnvPlatform(plat)) {
      return;
    }
    const next = suggestMigrateTtsPlatform(plat);
    // Prefer an Engine-manual target when user is already on this tab
    const engineNext =
      next && isEngineManualTtsPlatform(next) ? next : 'edge_tts';
    if (engineNext === plat) return;
    const fromLabel = PLATFORM_LABELS[plat] || plat;
    const toLabel = PLATFORM_LABELS[engineNext] || engineNext;
    store.updateTTSConfig({
      platform: engineNext,
      language: config.language || 'vi',
      voice: '',
      vinaUseClone: false,
    });
    toast.info(
      'Notice',
      `Nền tảng «${fromLabel}» đã gỡ. Đã chuyển sang «${toLabel}» — chọn lại giọng trong Voice library.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.platform]);

  // B10: không auto-swap sang giọng default khi stale.
  // Chỉ map giọng khi user đổi platform/language (onChange). Select phản ánh store.
  const voiceInList = currentVoices.some(
    (v: { id: string }) => v.id === (config.voice || ''),
  );
  const selectVoiceId = config.voice || '';
  const voiceStale =
    !!config.voice &&
    currentVoices.length > 0 &&
    !voiceInList &&
    !isVoiceValidForPlatform(
      dynamicVoices,
      config.platform,
      config.language || 'vi',
      config.voice || '',
    );

  return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  <Cpu className="h-3.5 w-3.5 text-sky-400" /> Nền tảng
                </label>
                <div className="relative w-full">
                  <select
                    value={
                      showStalePremiumOption
                        ? config.platform
                        : platformSelectValue
                    }
                    onChange={(e) => {
                      const newPlatform = e.target.value as TTSConfig['platform'];
                      if (!isEngineManualTtsPlatform(newPlatform)) {
                        toast.error(
                          'Engine chọn tay',
                          'LA Studio / OmniVoice chỉ dùng ở tab «LA Studio».',
                        );
                        return;
                      }
                      if (
                        isFreeTier &&
                        !FREE_TTS_PLATFORMS.has(String(newPlatform).toLowerCase())
                      ) {
                        toast.error(
                          'Gói Free',
                          `«${PLATFORM_LABELS[newPlatform] || newPlatform}» cần Trial/Pro (CapCut, TikTok, Gemini…). Free chỉ Edge TTS hoặc Piper.`,
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
                        vinaUseClone: false,
                      });
                    }}
                    className={SELECT_DARK}
                  >
                    <option className={OPTION_DARK} value="edge_tts">
                      Microsoft Edge TTS
                    </option>
                    <option className={OPTION_DARK} value="piper">
                      Piper VN (.onnx local)
                    </option>
                    {!isFreeTier
                      ? ENGINE_MANUAL_TTS_PLATFORMS.filter(
                          (p) => p !== 'edge_tts' && p !== 'piper',
                        ).map((p) => (
                          <option key={p} className={OPTION_DARK} value={p}>
                            {PLATFORM_LABELS[p] || p}
                          </option>
                        ))
                      : null}
                    {showStalePremiumOption ? (
                      <option className={OPTION_DARK} value={config.platform}>
                        {PLATFORM_LABELS[config.platform] || config.platform}
                        {' (cần Trial/Pro)'}
                      </option>
                    ) : null}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
                <p className="text-[9px] text-zinc-500 leading-snug">
                  Engine chọn tay: Edge · Piper · CapCut · TikTok · Gemini. LA Studio /
                  OmniVoice → tab <strong className="text-violet-300">LA Studio</strong>.
                </p>
                {isFreeTier &&
                  isEngineManualTtsPlatform(config.platform) &&
                  !platformInFreeList && (
                  <p className="text-[10px] text-amber-400/95 leading-snug">
                    Gói Free không dùng «{PLATFORM_LABELS[config.platform] || config.platform}».
                    Chọn <strong>Edge TTS</strong> hoặc <strong>Piper</strong>, hoặc nhấp logo → Trial/Pro.
                  </p>
                )}
                {isCapCut && capcutDiag && !capcutDiag.ok && (
                  <div className="mt-1.5 rounded border border-rose-900/50 bg-rose-950/30 px-2 py-1.5 space-y-1">
                    <p className="text-[10px] text-rose-300 leading-snug font-semibold">
                      CapCut TTS chưa sẵn sàng trên máy này
                    </p>
                    <p className="text-[9px] text-zinc-400 leading-snug">
                      {capcutDiag.message ||
                        'Thiếu sscronet.dll (cài CapCut PC → %LOCALAPPDATA%/CapCut/Apps). Không tự đổi sang Edge.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = resolveVoiceForPlatform(
                          dynamicVoices,
                          'edge_tts',
                          config.language || 'vi',
                          '',
                          { keepPreferred: false },
                        );
                        store.updateTTSConfig({
                          platform: 'edge_tts',
                          language: next.language,
                          voice: next.voice || 'vi-VN-NamMinhNeural',
                          vinaUseClone: false,
                        });
                        toast.info(
                          'Notice',
                          'Đã chuyển sang Edge TTS (bạn chọn tay — không fallback ngầm khi gen).',
                        );
                      }}
                      className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white"
                    >
                      Chuyển sang Edge TTS
                    </button>
                  </div>
                )}
                {isCapCut && capcutDiag?.ok && (
                  <p className="text-[9px] text-emerald-400/90 leading-snug">
                    CapCut OK · {capcutDiag.version || 'sscronet'} · {capcutDiag.voiceCount} giọng
                  </p>
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
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Voice library
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({currentVoices.length}
                      {voiceQuery.trim() && filteredVoices.length !== currentVoices.length
                        ? ` · lọc ${filteredVoices.length}`
                        : ''}
                      )
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isPreviewing) {
                          void handlePreviewVoice();
                          setPreviewingId(null);
                        } else {
                          void previewOneVoice(config.voice || selectVoiceId);
                        }
                      }}
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

                {/* Search — useful for Edge EN / CapCut multi-lang catalogs */}
                {currentVoices.length > 6 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
                    <input
                      type="search"
                      value={voiceQuery}
                      onChange={(e) => setVoiceQuery(e.target.value)}
                      placeholder="Lọc theo tên / id / giới tính…"
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/60 border border-zinc-800 text-[12px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-sky-700/60"
                    />
                  </div>
                )}

                {/* Scrollable list + per-row ▶ (live gen, không phải file mẫu tĩnh) */}
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2">
                  <p className="text-[9px] text-zinc-500 mb-1.5 leading-snug px-0.5">
                    Chọn hàng = gán giọng · ▶ = gen thử live trên engine hiện tại (không
                    fallback platform khác · B10).
                  </p>
                  <div className="max-h-[260px] overflow-y-auto space-y-1 pr-0.5">
                    {currentVoices.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 px-2 py-3 text-center">
                        Không có giọng cho «
                        {PLATFORM_LABELS[config.platform] || config.platform}» ·{' '}
                        {config.language || 'vi'}. Đổi ngôn ngữ hoặc nền tảng.
                      </p>
                    ) : filteredVoices.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 px-2 py-3 text-center">
                        Không khớp «{voiceQuery.trim()}» — xóa bộ lọc.
                      </p>
                    ) : (
                      filteredVoices.map((v, i) => {
                        const on = selectVoiceId === v.id;
                        const rowBusy =
                          isPreviewing &&
                          (previewingId === v.id ||
                            (!previewingId && on));
                        const g = genderLabel(v.gender);
                        return (
                          <div
                            key={`${v.id}__${i}`}
                            className={`flex items-stretch gap-1 rounded-lg border transition-colors ${
                              on
                                ? 'bg-sky-500/15 border-sky-500/45'
                                : 'bg-zinc-900/60 border-transparent hover:border-zinc-700/80'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => selectVoice(v.id)}
                              className="min-w-0 flex-1 text-left px-2.5 py-2 text-[12px]"
                              title={`Chọn giọng ${v.name}`}
                            >
                              <div className="font-semibold text-zinc-100 truncate">
                                {v.name}
                              </div>
                              <div className="text-[10px] text-zinc-500 truncate">
                                {v.id}
                                {g ? ` · ${g}` : ''}
                                {v.locale ? ` · ${v.locale}` : ''}
                              </div>
                            </button>
                            <button
                              type="button"
                              disabled={isPreviewing && !rowBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void previewOneVoice(v.id);
                              }}
                              className={`shrink-0 self-center mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-50 ${
                                rowBusy
                                  ? 'bg-sky-500/30 text-sky-200'
                                  : 'text-sky-400'
                              }`}
                              title={
                                rowBusy
                                  ? `Đang gen «${v.name}» — bấm lại để hủy`
                                  : isTikTokWithoutSession
                                    ? 'Thiếu SessionID TikTok'
                                    : `Nghe thử «${v.name}»`
                              }
                              aria-label={`Nghe thử ${v.name}`}
                            >
                              {rowBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5 fill-current" />
                              )}
                            </button>
                          </div>
                        );
                      })
                    )}
                    {voiceStale && config.voice ? (
                      <div className="flex items-stretch gap-1 rounded-lg border border-amber-700/50 bg-amber-950/30">
                        <div className="min-w-0 flex-1 px-2.5 py-2 text-[12px]">
                          <div className="font-semibold text-amber-200 truncate">
                            ⚠ {config.voice}
                          </div>
                          <div className="text-[10px] text-amber-400/90">
                            Không thuộc{' '}
                            {PLATFORM_LABELS[config.platform] || config.platform} —
                            chọn lại trong list
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {voiceStale && (
                  <p className="text-[10px] text-amber-400/90 leading-snug">
                    Giọng «{config.voice}» không thuộc nền tảng «
                    {PLATFORM_LABELS[config.platform] || config.platform}». Chọn lại
                    trong list — nghe thử sẽ báo lỗi đúng giọng này (không tự đổi sang
                    giọng khác).
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

            </div>
  );
}
