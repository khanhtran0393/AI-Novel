'use client';

/**
 * Thiết lập tham số AI Novel — modal rộng trong khung app.
 * Đóng bằng X hoặc Esc.
 * Portal → document.body để tránh stacking context app-work-surface chặn click.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Sparkles,
  Minus,
  Plus,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  chapterWordsMinutes,
  resolveWpm,
  totalScaleMinutes,
} from './setupScaleDuration';
import { closeSetupModal, setupModalNoDragStyle } from './closeSetupModal';
import { useFreeLimits } from '@/app/workspace/hooks/useFreeLimits';
import { FREE_LIMITS, TRIAL_LIMITS } from '@/lib/commercial/freeLimitsPolicy';
import {
  getStyleEngineProfile,
  resolveStyleEngineProfile,
} from '@/lib/styleEngineProfiles';
import { MATRIX_THEMES, MATRIX_STYLES } from '@/lib/matrixEngine';

interface SetupPhaseProps {
  promptError: string;
  isGeneratingIdea: boolean;
  isGeneratingOutline?: boolean;
  handleRandomTemplate: () => Promise<void>;
  handleGenerateOutline: () => Promise<void>;
  onClose?: () => void;
}

/** 30 chủ đề (Theme) — single source: matrixEngine/catalog */
const THEMES = MATRIX_THEMES;

/** 30 phong cách (Style) — single source: matrixEngine/catalog */
const STYLES = MATRIX_STYLES;

export default function SetupPhase({
  promptError,
  isGeneratingIdea,
  isGeneratingOutline = false,
  handleRandomTemplate,
  handleGenerateOutline,
  onClose,
}: SetupPhaseProps) {
  const store = useNovelStore();
  const { free, trial, FREE_LIMITS: freeCaps, TRIAL_LIMITS: trialCaps } =
    useFreeLimits();
  const maxChapters = free
    ? freeCaps.maxChapters
    : trial
      ? trialCaps.maxChapters
      : 1000;
  const maxWords = free
    ? freeCaps.maxWordsPerChapter
    : trial
      ? trialCaps.maxWordsPerChapter
      : 50_000;
  const minWords = free ? 100 : 500;

  const handleClose = (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    // Direct store write — no dependency on parent onClose
    closeSetupModal(onClose);
    console.info('[SetupPhase] close → giai_doan=', useNovelStore.getState().giai_doan);
  };

  const handleAdjustChapters = (amount: number) => {
    const nextVal = Math.max(1, Math.min(maxChapters, store.setup.so_chuong + amount));
    store.setSetup({ so_chuong: nextVal });
  };

  // Free: 2 chương · 600 từ. Trial: ≤10 chương · ≤3000 từ.
  useEffect(() => {
    if (free) {
      const ch = Number(store.setup.so_chuong) || 1;
      const words =
        Number(store.setup.so_tu_chuong) || FREE_LIMITS.maxWordsPerChapter;
      const nextCh = Math.min(FREE_LIMITS.maxChapters, Math.max(1, ch));
      const nextWords = Math.min(
        FREE_LIMITS.maxWordsPerChapter,
        Math.max(minWords, words),
      );
      if (ch !== nextCh || words !== nextWords) {
        store.setSetup({ so_chuong: nextCh, so_tu_chuong: nextWords });
      }
      return;
    }
    if (trial) {
      const ch = Number(store.setup.so_chuong) || 1;
      const words =
        Number(store.setup.so_tu_chuong) || TRIAL_LIMITS.maxWordsPerChapter;
      const nextCh = Math.min(TRIAL_LIMITS.maxChapters, Math.max(1, ch));
      const nextWords = Math.min(
        TRIAL_LIMITS.maxWordsPerChapter,
        Math.max(minWords, words),
      );
      if (ch !== nextCh || words !== nextWords) {
        store.setSetup({ so_chuong: nextCh, so_tu_chuong: nextWords });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free, trial]);

  // Core-loop step: Setup đủ Chủ đề + Phong cách
  useEffect(() => {
    const cd = String(store.setup.chu_de || '').trim();
    const pc = String(store.setup.phong_cach || '').trim();
    if (!cd || !pc) return;
    void import('@/lib/onboarding').then(({ markOnboardingStep }) => {
      markOnboardingStep('setup');
    });
  }, [store.setup.chu_de, store.setup.phong_cach]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose(e);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-black/75 p-2 sm:p-3 md:p-4"
      style={
        {
          paddingTop: 'calc(var(--app-chrome-h, 32px) + 8px)',
          ...setupModalNoDragStyle,
        } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-params-title"
      data-setup-modal="classic"
      onClick={(e) => {
        // Click nền (không phải panel) → đóng
        if (e.target === e.currentTarget) handleClose(e);
      }}
    >
      {/* Khung rộng gần full app work area */}
      <div
        className="relative flex h-full w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-[var(--app-radius-lg)] border border-zinc-800/90 bg-zinc-950 shadow-2xl shadow-amber-500/10"
        style={setupModalNoDragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + X */}
        <div
          className="relative flex shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950 px-3 py-2.5 sm:px-4 sm:py-3"
          style={setupModalNoDragStyle}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="setup-params-title"
              className="truncate text-[clamp(12px,1.5vw,15px)] font-bold leading-snug tracking-wide text-amber-400 uppercase"
            >
              Setup · Tham số AI Novel
            </h2>
          </div>
          <button
            type="button"
            id="setup-modal-close-x"
            data-testid="setup-close-x"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose(e);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose(e);
            }}
            className="relative z-[100] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-white transition-colors hover:border-red-500 hover:bg-red-950/50 hover:text-red-400 cursor-pointer select-none"
            style={setupModalNoDragStyle}
            title="Đóng (Esc)"
            aria-label="Đóng"
          >
            <X className="pointer-events-none h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-5 space-y-4">
          {/* 1. Chủ đề — tên gọn */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-amber-500">
              1. Chủ đề
            </label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {THEMES.map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => store.setSetup({ chu_de: theme.name })}
                  title={theme.desc}
                  className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-all ${
                    store.setup.chu_de === theme.name
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-zinc-100 leading-tight line-clamp-2">
                    {theme.name}
                  </span>
                  <span className="mt-0.5 text-[9px] text-zinc-500 leading-snug line-clamp-1">
                    {theme.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Phong cách — tên gọn */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-sky-400">
              2. Phong cách
            </label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {STYLES.map((style) => (
                <button
                  key={style.name}
                  type="button"
                  onClick={() => store.setSetup({ phong_cach: style.name })}
                  title={style.desc}
                  className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-all ${
                    store.setup.phong_cach === style.name
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-zinc-100 leading-tight line-clamp-2">
                    {style.name}
                  </span>
                  <span className="mt-0.5 text-[9px] text-zinc-500 leading-snug line-clamp-1">
                    {style.desc}
                  </span>
                </button>
              ))}
            </div>
            {(() => {
              const eng =
                getStyleEngineProfile(store.activeStyleEngineId) ||
                resolveStyleEngineProfile(
                  store.setup.chu_de,
                  store.setup.phong_cach,
                );
              if (!eng) return null;
              return (
                <div
                  className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5"
                  title={eng.audienceCraving}
                  data-testid="style-engine-chip"
                  data-style-engine={eng.id}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    Engine
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-100">
                    {eng.labelVi}
                  </span>
                  <span className="text-[9px] text-zinc-400">·</span>
                  <span className="text-[9px] text-zinc-300">
                    {eng.wpm} WPM
                  </span>
                  <span className="text-[9px] text-zinc-400">·</span>
                  <span className="text-[9px] text-zinc-300">
                    shot {eng.shotSecMin}–{eng.shotSecMax}s
                  </span>
                  <span className="text-[9px] text-zinc-400">·</span>
                  <span className="text-[9px] text-amber-300/90">
                    CTR: {eng.ctr.primaryHookType}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* 3. Cốt truyện */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                3. Cốt truyện
              </label>
              <button
                type="button"
                onClick={() => void handleRandomTemplate()}
                disabled={isGeneratingIdea}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-500 hover:text-amber-400 disabled:opacity-40"
              >
                {isGeneratingIdea ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {isGeneratingIdea ? 'Đang sinh…' : 'AI ý tưởng'}
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="Bối cảnh cốt truyện... hoặc bấm AI ý tưởng. (Link YouTube nằm ở sidebar.)"
              value={store.setup.mo_ta}
              onChange={(e) => store.setSetup({ mo_ta: e.target.value })}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-500 focus:bg-zinc-950 font-sans"
            />
            {promptError ? (
              <p
                role="alert"
                className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400 leading-snug max-h-36 overflow-y-auto rounded-md border border-red-500/20 bg-red-950/30 px-2 py-1.5"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{promptError}</span>
              </p>
            ) : null}
          </div>

          {/* 4. Quy mô */}
          {(() => {
            const wpm = resolveWpm(store.wpm);
            const wordsPer = store.setup.so_tu_chuong || 4250;
            const chapters = Number(store.setup.so_chuong) > 0 ? Number(store.setup.so_chuong) : 0;
            const perChapter = chapterWordsMinutes(wordsPer, wpm);
            const total = totalScaleMinutes(chapters, wordsPer, wpm);
            return (
          <div className="rounded-lg border border-zinc-900 bg-zinc-900/20 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                4. Quy mô
              </label>
              <span
                className="text-[9px] font-semibold text-zinc-500"
                title="Cài đặt Tốc độ đọc (WPM) trong Header / media — dùng để quy đổi từ → phút"
              >
                Tốc độ đọc: {wpm} WPM
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-500">
                  <span className="h-1 w-1 rounded-full bg-amber-500" /> Chương
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={maxChapters}
                    value={store.setup.so_chuong}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) {
                        store.setSetup({
                          so_chuong: Math.min(maxChapters, val),
                        });
                      } else if (e.target.value === '') {
                        store.setSetup({ so_chuong: '' as unknown as number });
                      }
                    }}
                    onBlur={() => {
                      if (!store.setup.so_chuong || store.setup.so_chuong < 1) {
                        store.setSetup({ so_chuong: 1 });
                      } else if (store.setup.so_chuong > maxChapters) {
                        store.setSetup({ so_chuong: maxChapters });
                      }
                    }}
                    className="w-full rounded border border-zinc-800 bg-black p-2.5 pr-8 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-amber-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                    <button type="button" onClick={() => handleAdjustChapters(1)} className="text-zinc-500 hover:text-white">
                      <Plus className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => handleAdjustChapters(-1)} className="text-zinc-500 hover:text-white">
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p
                  className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-amber-400/90"
                  title={`${chapters} chương × ${wordsPer} từ = ${total.totalWords} từ ÷ ${wpm} WPM`}
                >
                  Tổng dự tính: {total.label}
                </p>
                {free ? (
                  <p className="mt-1 text-center text-[9px] font-semibold text-amber-500/90">
                    Free: tối đa {FREE_LIMITS.maxChapters} chương
                  </p>
                ) : null}
                {trial ? (
                  <p className="mt-1 text-center text-[9px] font-semibold text-cyan-500/90">
                    Trial: tối đa {TRIAL_LIMITS.maxChapters} chương · 5 lượt
                    viết/ngày
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
                  <span className="h-1 w-1 rounded-full bg-emerald-500" /> Từ/chương
                </label>
                <input
                  type="number"
                  min={minWords}
                  max={maxWords}
                  step={free ? 50 : 500}
                  value={
                    store.setup.so_tu_chuong ||
                    (free ? FREE_LIMITS.maxWordsPerChapter : 4250)
                  }
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      store.setSetup({
                        so_tu_chuong: Math.min(maxWords, val),
                      });
                    } else if (e.target.value === '') {
                      store.setSetup({ so_tu_chuong: '' as unknown as number });
                    }
                  }}
                  onBlur={() => {
                    const fallback = free
                      ? FREE_LIMITS.maxWordsPerChapter
                      : trial
                        ? TRIAL_LIMITS.maxWordsPerChapter
                        : 4250;
                    if (
                      !store.setup.so_tu_chuong ||
                      store.setup.so_tu_chuong < minWords
                    ) {
                      store.setSetup({ so_tu_chuong: fallback });
                    } else if (
                      free &&
                      store.setup.so_tu_chuong > FREE_LIMITS.maxWordsPerChapter
                    ) {
                      store.setSetup({
                        so_tu_chuong: FREE_LIMITS.maxWordsPerChapter,
                      });
                    } else if (
                      trial &&
                      store.setup.so_tu_chuong > TRIAL_LIMITS.maxWordsPerChapter
                    ) {
                      store.setSetup({
                        so_tu_chuong: TRIAL_LIMITS.maxWordsPerChapter,
                      });
                    }
                  }}
                  className="w-full rounded border border-zinc-800 bg-black p-2.5 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-emerald-500"
                />
                {free ? (
                  <p className="mt-1 text-center text-[9px] font-semibold text-emerald-500/90">
                    Free: tối đa {FREE_LIMITS.maxWordsPerChapter} từ · 3 lượt viết/ngày
                  </p>
                ) : null}
                {trial ? (
                  <p className="mt-1 text-center text-[9px] font-semibold text-cyan-500/90">
                    Trial: tối đa {TRIAL_LIMITS.maxWordsPerChapter} từ · 5 lượt
                    viết/ngày
                  </p>
                ) : null}
                <p
                  className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-emerald-400/90"
                  title={`${wordsPer} từ ÷ ${wpm} WPM = thời lượng đọc 1 chương`}
                >
                  ≈ {perChapter.label}/chương
                </p>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-sky-500">
                  <span className="h-1 w-1 rounded-full bg-sky-500" /> Ngôn ngữ
                </label>
                <select
                  value={store.setup.ngon_ngu || 'Tiếng Việt'}
                  onChange={(e) => store.setSetup({ ngon_ngu: e.target.value })}
                  className="w-full rounded border border-zinc-800 bg-black p-2.5 text-sm font-bold text-zinc-100 outline-none focus:border-sky-500 cursor-pointer"
                >
                  {/* 20 ngôn ngữ phổ biến nhất (nội dung / người nói) */}
                  <option value="Tiếng Việt">Tiếng Việt</option>
                  <option value="English">English</option>
                  <option value="中文 (Chinese)">中文 · Chinese</option>
                  <option value="Español (Spanish)">Español · Spanish</option>
                  <option value="हिन्दी (Hindi)">हिन्दी · Hindi</option>
                  <option value="العربية (Arabic)">العربية · Arabic</option>
                  <option value="Português (Portuguese)">Português · Portuguese</option>
                  <option value="বাংলা (Bengali)">বাংলা · Bengali</option>
                  <option value="Русский (Russian)">Русский · Russian</option>
                  <option value="日本語 (Japanese)">日本語 · Japanese</option>
                  <option value="Français (French)">Français · French</option>
                  <option value="Deutsch (German)">Deutsch · German</option>
                  <option value="한국어 (Korean)">한국어 · Korean</option>
                  <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                  <option value="Italiano (Italian)">Italiano · Italian</option>
                  <option value="Türkçe (Turkish)">Türkçe · Turkish</option>
                  <option value="ไทย (Thai)">ไทย · Thai</option>
                  <option value="Polski (Polish)">Polski · Polish</option>
                  <option value="Nederlands (Dutch)">Nederlands · Dutch</option>
                  <option value="Українська (Ukrainian)">Українська · Ukrainian</option>
                </select>
              </div>
            </div>
          </div>
            );
          })()}

          {/* 5. Phong Cách Kịch Bản */}
          <div className="rounded-lg border border-purple-900/50 bg-purple-950/10 p-3">
            <label className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-400">
              <Sparkles className="h-3.5 w-3.5" />
              5. Phong Cách Kịch Bản
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label
                className={`relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                  store.scriptMode === 'chuyen_sau'
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-zinc-800 bg-black/50 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scriptMode"
                    value="chuyen_sau"
                    checked={store.scriptMode === 'chuyen_sau'}
                    onChange={() => store.setScriptMode('chuyen_sau')}
                    className="accent-purple-500"
                  />
                  <span
                    className={`text-[11px] font-bold uppercase ${
                      store.scriptMode === 'chuyen_sau'
                        ? 'text-purple-300'
                        : 'text-zinc-400'
                    }`}
                  >
                    Kịch Bản Chuyên Sâu
                  </span>
                </div>
                <p className="ml-5 text-[10px] text-zinc-500 leading-snug">
                  Audio dài: ~130 WPM, beat ~7s, không cold-open trailer; logic
                  hiện thực, nhân vật sâu (mặc định).
                </p>
              </label>

              <label
                className={`relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                  store.scriptMode === 'sang_van'
                    ? 'border-rose-500 bg-rose-500/10'
                    : 'border-zinc-800 bg-black/50 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scriptMode"
                    value="sang_van"
                    checked={store.scriptMode === 'sang_van'}
                    onChange={() => store.setScriptMode('sang_van')}
                    className="accent-rose-500"
                  />
                  <span
                    className={`text-[11px] font-bold uppercase ${
                      store.scriptMode === 'sang_van'
                        ? 'text-rose-300'
                        : 'text-zinc-400'
                    }`}
                  >
                    Sảng Văn (Dopamine Hit)
                  </span>
                </div>
                <p className="ml-5 text-[10px] text-zinc-500 leading-snug">
                  Recap dồn: ~155 WPM, beat ~4.5s, cold-open gợi ý; vả mặt, câu
                  ngắn, buff có giới hạn logic.
                </p>
              </label>

              <label
                className={`relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${
                  store.scriptMode === 'short_manhua'
                    ? 'border-teal-500 bg-teal-500/10'
                    : 'border-zinc-800 bg-black/50 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scriptMode"
                    value="short_manhua"
                    checked={store.scriptMode === 'short_manhua'}
                    onChange={() => {
                      // Soft WPM/beat/word + cold-open on — setScriptMode
                      store.setScriptMode('short_manhua');
                    }}
                    className="accent-teal-500"
                  />
                  <span
                    className={`text-[11px] font-bold uppercase ${
                      store.scriptMode === 'short_manhua'
                        ? 'text-teal-300'
                        : 'text-zinc-400'
                    }`}
                  >
                    Short / Manhua
                  </span>
                </div>
                <p className="ml-5 text-[10px] text-zinc-500 leading-snug">
                  Shorts/Reels: ~170 WPM, beat ~3.5s, cold-open bắt buộc, shot
                  2.5–4s; ~1200 từ/tập, storyboard sẵn.
                </p>
              </label>
            </div>
          </div>
        </div>

        {/* Footer: CTA + lỗi sticky (không ẩn giữa form khi cuộn) */}
        <div
          className="relative z-20 shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 p-3 sm:px-4 space-y-2"
          style={setupModalNoDragStyle}
        >
          {promptError ? (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs text-red-400 leading-snug max-h-40 overflow-y-auto rounded-md border border-red-500/20 bg-red-950/30 px-2 py-1.5"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{promptError}</span>
            </p>
          ) : (
            <p className="text-[10px] text-zinc-500 leading-snug">
              Cần: Chủ đề + Phong cách + Cốt truyện + API Key → bấm nút. Toast báo tiến trình /
              lỗi (không silent).
            </p>
          )}
          <button
            type="button"
            disabled={isGeneratingOutline}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isGeneratingOutline) return;
              void handleGenerateOutline();
            }}
            className="relative z-[30] flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none"
            style={setupModalNoDragStyle}
            title="Sinh dàn ý + danh sách chương AI"
            aria-busy={isGeneratingOutline}
          >
            {isGeneratingOutline ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                Đang sinh kịch bản AI… (chờ toast)
              </>
            ) : (
              <>🚀 TIẾN HÀNH SINH KỊCH BẢN AI</>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
