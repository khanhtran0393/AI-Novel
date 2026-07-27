'use client';

/**
 * Setup riêng: Link nguồn (YouTube | Web) · viết lại tương tự
 *
 * Luồng:
 * 1. Dán link → bấm «Phân tích»
 *    - YouTube: captions/Whisper · Web: article extract → cache (% trùng)
 *    - AI bóc cốt truyện → điền ô 3
 * 2. Chỉnh % trùng / quy mô
 * 3. Sinh kịch bản → dùng cache để canh %, rồi xóa cache
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNovelStore } from '@/store/useNovelStore';
import {
  AlertCircle,
  Link2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import {
  detectClientSourcePlatform,
  extractUrlsFromInput,
  isAnalyzableMultiSourceInput,
  isAnalyzableSourceUrl,
  sourceUrlHint,
} from '@/lib/sourceIngestId';
import {
  chapterWordsMinutes,
  resolveWpm,
  totalScaleMinutes,
} from './setupScaleDuration';
import { closeSetupModal, setupModalNoDragStyle } from './closeSetupModal';

interface YoutubeSetupPhaseProps {
  promptError: string;
  isGeneratingIdea: boolean;
  isGeneratingOutline?: boolean;
  isAnalyzingPlot: boolean;
  /** Nút Phân tích: captions → cache + cốt truyện → ô 3 */
  handlePhanTichYoutube: (url?: string) => Promise<void>;
  handleGenerateOutline: () => Promise<void>;
  onClose?: () => void;
}

export default function YoutubeSetupPhase({
  promptError,
  isGeneratingIdea,
  isGeneratingOutline = false,
  isAnalyzingPlot,
  handlePhanTichYoutube,
  handleGenerateOutline,
  onClose,
}: YoutubeSetupPhaseProps) {
  const store = useNovelStore();

  const handleClose = (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    closeSetupModal(onClose);
    console.info('[YoutubeSetup] close → giai_doan=', useNovelStore.getState().giai_doan);
  };

  const handleAdjustChapters = (amount: number) => {
    const free =
      !store.is_pro && !store.is_trial && !store.is_vip;
    const maxCh = free ? 2 : 1000;
    const nextVal = Math.max(1, Math.min(maxCh, store.setup.so_chuong + amount));
    store.setSetup({ so_chuong: nextVal });
  };

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

  const sim = store.youtubeSimilarityTarget ?? 80;
  // Mỗi nút busy riêng — không dang_tai global
  const analyzeBusy = isAnalyzingPlot;
  const outlineBusy = isGeneratingOutline;
  const busy = analyzeBusy || outlineBusy || isGeneratingIdea;
  const rawYtUrl = (store.youtubeRewriteUrl || '').trim();
  const detectedUrls = extractUrlsFromInput(rawYtUrl);
  const isMultiSource = detectedUrls.length > 1;
  const sourcePlatform = detectClientSourcePlatform(rawYtUrl);
  const urlOk = isAnalyzableMultiSourceInput(rawYtUrl);
  const ytUrlHint = sourceUrlHint(rawYtUrl);
  const captionCached = (store.youtubeSourceText || '').trim().length >= 40;
  const captionWords = captionCached
    ? (store.youtubeSourceText || '').trim().split(/\s+/).filter(Boolean).length
    : 0;
  const hasPlot =
    (store.setup.mo_ta || '').trim().length > 40 &&
    !(store.setup.mo_ta || '').trim().startsWith('[NGUỒN YOUTUBE') &&
    !(store.setup.mo_ta || '').trim().startsWith('[NGUỒN WEB') &&
    !(store.setup.mo_ta || '').trim().startsWith('[RAW YOUTUBE') &&
    !(store.setup.mo_ta || '').trim().startsWith('[NGUỒN 1:');

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
      aria-labelledby="yt-setup-title"
      data-setup-modal="youtube"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose(e);
      }}
    >
      <div
        className="relative flex h-full w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-[var(--app-radius-lg)] border border-zinc-800/90 bg-zinc-950 shadow-2xl shadow-red-500/10"
        style={setupModalNoDragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950 px-3 py-2.5 sm:px-4 sm:py-3"
          style={setupModalNoDragStyle}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="yt-setup-title"
              className="truncate text-[clamp(12px,1.5vw,15px)] font-bold leading-snug tracking-wide text-red-400 uppercase"
            >
              Link YouTube & Đa Nguồn Web (Agent-Reach)
            </h2>
            <p className="text-[9px] leading-snug text-zinc-500 mt-0.5">
              Dán 1 hoặc nhiều link (YouTube | Web) → cốt truyện hợp nhất · cache canh % trùng · xóa cache khi sinh kịch bản
            </p>
          </div>
          <button
            type="button"
            id="yt-setup-modal-close-x"
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-5 space-y-4">
          {/* 1. Link = Chủ đề + nút Phân tích */}
          <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
              <Video className="h-3.5 w-3.5" />
              1. Link nguồn (YouTube hoặc Đa Nguồn Web)
            </label>
            <p className="mb-2 text-[10px] text-zinc-500">
              Dán link → bấm <strong className="text-zinc-300">Phân tích</strong>:{' '}
              <strong className="text-zinc-300">YouTube</strong> lấy lời thoại (phụ đề → Whisper nếu
              cần); <strong className="text-zinc-300">Web</strong> lấy thân bài viết. Hỗ trợ dán{' '}
              <strong className="text-amber-400">nhiều URL</strong> (mỗi URL 1 dòng) để tổng hợp tri thức đa nguồn Agent-Reach.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row items-start">
              <div className="relative min-w-0 flex-1 w-full">
                <Link2 className="pointer-events-none absolute left-2.5 top-3 h-3.5 w-3.5 text-zinc-600" />
                <textarea
                  rows={isMultiSource || rawYtUrl.includes('\n') ? 3 : 2}
                  placeholder="https://youtube.com/… hoặc https://blog.example.com/bai-viet (Dán nhiều link: mỗi link 1 dòng)"
                  value={store.youtubeRewriteUrl || ''}
                  onChange={(e) => store.setYoutubeRewrite({ url: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      const u = (store.youtubeRewriteUrl || '').trim();
                      if (!u || busy) return;
                      if (!isAnalyzableMultiSourceInput(u)) return;
                      void handlePhanTichYoutube(u);
                    }
                  }}
                  disabled={busy}
                  className={`w-full rounded-lg border bg-black py-2 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 disabled:opacity-50 font-mono resize-y ${
                    ytUrlHint
                      ? 'border-red-500/60 focus:border-red-400'
                      : 'border-zinc-800 focus:border-red-500'
                  }`}
                />
              </div>
              <button
                type="button"
                disabled={busy || !rawYtUrl || !urlOk}
                onClick={() => void handlePhanTichYoutube(store.youtubeRewriteUrl || '')}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-sky-700/50 bg-sky-500/20 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-sky-300 hover:bg-sky-500/30 disabled:opacity-40 self-stretch sm:self-auto"
                title={
                  ytUrlHint
                    ? ytUrlHint
                    : 'Lấy nội dung nguồn (cache) + phân tích cốt truyện → ô 3'
                }
              >
                {isAnalyzingPlot ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Đang phân tích…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    {isMultiSource ? `Phân tích ${detectedUrls.length} nguồn` : 'Phân tích'}
                  </>
                )}
              </button>
            </div>

            {ytUrlHint ? (
              <p
                role="status"
                className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-400/95 leading-snug"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {ytUrlHint}
              </p>
            ) : null}

            {/* Lỗi Phân tích ngay cạnh bước 1 — user thấy đúng chỗ vừa bấm */}
            {promptError ? (
              <p
                role="alert"
                className="mt-2 flex items-start gap-1.5 text-xs text-red-400 leading-snug max-h-40 overflow-y-auto rounded-md border border-red-500/25 bg-red-950/40 px-2.5 py-2"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{promptError}</span>
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {rawYtUrl && urlOk ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700/60 bg-zinc-900/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                  {isMultiSource
                    ? `Agent-Reach · ${detectedUrls.length} nguồn`
                    : sourcePlatform === 'web'
                      ? 'Web Article'
                      : 'YouTube Video'}
                </span>
              ) : null}
              {captionCached ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                  Cache nội dung · ~{captionWords} từ · canh % trùng
                </span>
              ) : (
                <span className="text-[9px] text-zinc-600 font-medium">
                  Chưa có cache nội dung — bấm Phân tích
                </span>
              )}
              {hasPlot ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-800/50 bg-sky-950/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-400">
                  Cốt truyện đã điền
                </span>
              ) : null}
            </div>

            {store.youtubeSourceTitle ? (
              <p className="mt-1 text-[10px] text-zinc-500 truncate" title={store.youtubeSourceTitle}>
                Video: {store.youtubeSourceTitle}
              </p>
            ) : null}
          </div>

          {/* 2. % ĐỘ TRÙNG LẶP mục tiêu */}
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-amber-400">
              2. % Độ trùng lặp với ý tưởng mẫu
            </label>
            <p className="mb-2 text-[10px] text-zinc-500">
              Mức bám cốt truyện / nhịp / ý tưởng nguồn khi viết lại (mặc định 80%). Đối chiếu với
              captions cache lúc sinh kịch bản — tên NV, chi tiết, thoại phải gốc, không copy nguyên
              văn. Captions cache sẽ <strong className="text-zinc-400">bị xóa</strong> sau khi sinh
              xong.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={sim}
                onChange={(e) =>
                  store.setYoutubeRewrite({
                    similarityTarget: parseInt(e.target.value, 10) || 80,
                  })
                }
                className="min-w-[160px] flex-1 accent-amber-500"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    store.setYoutubeRewrite({ similarityTarget: Math.max(10, sim - 5) })
                  }
                  className="rounded border border-zinc-800 p-1 text-zinc-400 hover:text-white"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={sim}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) store.setYoutubeRewrite({ similarityTarget: v });
                  }}
                  className="w-16 rounded border border-zinc-800 bg-black py-1.5 text-center text-lg font-black text-amber-400 outline-none focus:border-amber-500"
                />
                <span className="text-sm font-bold text-amber-500">%</span>
                <button
                  type="button"
                  onClick={() =>
                    store.setYoutubeRewrite({ similarityTarget: Math.min(100, sim + 5) })
                  }
                  className="rounded border border-zinc-800 p-1 text-zinc-400 hover:text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {[60, 70, 80, 90].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => store.setYoutubeRewrite({ similarityTarget: p })}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      sim === p
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Cốt truyện — điền từ nút Phân tích */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                3. Cốt truyện
              </label>
              <span className="text-[9px] text-zinc-600">
                Tự điền khi bấm Phân tích · có thể chỉnh tay
              </span>
            </div>
            <textarea
              rows={6}
              placeholder="Bấm «Phân tích» cạnh link — hoặc gõ tóm tắt cốt truyện tay (khi site chặn / không lấy được nội dung)…"
              value={store.setup.mo_ta}
              onChange={(e) => store.setSetup({ mo_ta: e.target.value })}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-500 focus:bg-zinc-950 font-sans"
            />
            {/* Lỗi full nằm ở bước 1 + footer sticky — không nhét dưới cốt truyện (gây nhầm chỗ lỗi) */}
          </div>

          {/* 4. Quy mô */}
          {(() => {
            const wpm = resolveWpm(store.wpm);
            const wordsPer = store.setup.so_tu_chuong || 4250;
            const chapters =
              Number(store.setup.so_chuong) > 0 ? Number(store.setup.so_chuong) : 0;
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
                    title="Cài đặt Tốc độ đọc (WPM) — quy đổi từ → phút"
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
                        max={500}
                        value={store.setup.so_chuong}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const free =
                            !store.is_pro && !store.is_trial && !store.is_vip;
                          const maxCh = free ? 2 : 500;
                          if (!isNaN(val) && val > 0) {
                            store.setSetup({
                              so_chuong: Math.min(maxCh, val),
                            });
                          } else if (e.target.value === '') {
                            store.setSetup({ so_chuong: '' as unknown as number });
                          }
                        }}
                        onBlur={() => {
                          const free =
                            !store.is_pro && !store.is_trial && !store.is_vip;
                          const maxCh = free ? 2 : 500;
                          if (!store.setup.so_chuong || store.setup.so_chuong < 1) {
                            store.setSetup({ so_chuong: 1 });
                          } else if (store.setup.so_chuong > maxCh) {
                            store.setSetup({ so_chuong: maxCh });
                          }
                        }}
                        className="w-full rounded border border-zinc-800 bg-black p-2.5 pr-8 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-amber-500"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleAdjustChapters(1)}
                          className="text-zinc-500 hover:text-white"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustChapters(-1)}
                          className="text-zinc-500 hover:text-white"
                        >
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
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
                      <span className="h-1 w-1 rounded-full bg-emerald-500" /> Từ/chương
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={10000}
                      step={500}
                      value={(() => {
                        const free =
                          !store.is_pro && !store.is_trial && !store.is_vip;
                        return (
                          store.setup.so_tu_chuong ||
                          (free ? 600 : 4250)
                        );
                      })()}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        const free =
                          !store.is_pro && !store.is_trial && !store.is_vip;
                        const maxW = free ? 600 : 10000;
                        if (!isNaN(val) && val > 0) {
                          store.setSetup({
                            so_tu_chuong: Math.min(maxW, val),
                          });
                        } else if (e.target.value === '') {
                          store.setSetup({ so_tu_chuong: '' as unknown as number });
                        }
                      }}
                      onBlur={() => {
                        const free =
                          !store.is_pro && !store.is_trial && !store.is_vip;
                        const maxW = free ? 600 : 10000;
                        const minW = free ? 100 : 500;
                        const fallback = free ? 600 : 4250;
                        if (
                          !store.setup.so_tu_chuong ||
                          store.setup.so_tu_chuong < minW
                        ) {
                          store.setSetup({ so_tu_chuong: fallback });
                        } else if (store.setup.so_tu_chuong > maxW) {
                          store.setSetup({ so_tu_chuong: maxW });
                        }
                      }}
                      className="w-full rounded border border-zinc-800 bg-black p-2.5 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-emerald-500"
                    />
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
                      <option value="Tiếng Việt">Tiếng Việt</option>
                      <option value="English">English</option>
                      <option value="中文 (Chinese)">中文 · Chinese</option>
                      <option value="Español (Spanish)">Español · Spanish</option>
                      <option value="日本語 (Japanese)">日本語 · Japanese</option>
                      <option value="한국어 (Korean)">한국어 · Korean</option>
                      <option value="Français (French)">Français · French</option>
                      <option value="Deutsch (German)">Deutsch · German</option>
                      <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                      <option value="ไทย (Thai)">ไทย · Thai</option>
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
                  Audio dài: ~130 WPM, beat ~7s, không cold-open trailer; nhân
                  vật sâu (mặc định).
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
                  Recap dồn: ~155 WPM, beat ~4.5s, cold-open gợi ý; vả mặt,
                  dopamine hit.
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
                  2.5–4s; ~1200 từ/tập.
                </p>
              </label>
            </div>
          </div>
        </div>

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
              1) Link → <span className="text-sky-400 font-semibold">Phân tích</span> → 2) % trùng
              → 3) Sinh kịch bản (captions cache xóa sau khi xong). Cần API Key.
            </p>
          )}
          <button
            type="button"
            disabled={outlineBusy}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (outlineBusy) return;
              void handleGenerateOutline();
            }}
            className="relative z-[30] flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none"
            style={setupModalNoDragStyle}
            title="Sinh dàn ý + danh sách chương AI (cần Phân tích trước)"
            aria-busy={outlineBusy}
          >
            {outlineBusy ? (
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
