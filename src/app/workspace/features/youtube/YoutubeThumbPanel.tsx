'use client';

/**
 * YouTube Studio — Thumb prompt + competitor DNA upload + preview image + variants + lightbox.
 * Parent owns patch/handlers for rewrite, gen, and competitor DNA analysis.
 */
import React, { useRef } from 'react';
import {
  RefreshCw,
  Loader2,
  ImagePlus,
  Copy,
  Upload,
  X,
  Dna,
} from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';

export type YoutubeThumbPanelProps = {
  ch: number;
  thumbAssetKey: string;
  thumbnailLine: string;
  thumbnailPrompt: string;
  thumbImageUrl: string;
  /** DNA extracted from competitor thumbnail */
  competitorThumbDna: string;
  /** Preview of uploaded competitor thumb (data URL or path) */
  competitorThumbPreview: string;
  thumbRegenLoading: boolean;
  thumbFromLineLoading: boolean;
  thumbImageLoading: boolean;
  competitorDnaLoading: boolean;
  zoomThumbUrl: string | null;
  setZoomThumbUrl: (url: string | null) => void;
  onPromptChange: (v: string) => void;
  onRewriteNoLine: () => void;
  onRewriteWithLine: () => void;
  onGenImage: () => void;
  onPickVariant: (src: string) => void;
  onUploadCompetitor: (files: FileList | null) => void;
  onClearCompetitor: () => void;
};

export default function YoutubeThumbPanel({
  ch,
  thumbAssetKey,
  thumbnailLine,
  thumbnailPrompt,
  thumbImageUrl,
  competitorThumbDna,
  competitorThumbPreview,
  thumbRegenLoading,
  thumbFromLineLoading,
  thumbImageLoading,
  competitorDnaLoading,
  zoomThumbUrl,
  setZoomThumbUrl,
  onPromptChange,
  onRewriteNoLine,
  onRewriteWithLine,
  onGenImage,
  onPickVariant,
  onUploadCompetitor,
  onClearCompetitor,
}: YoutubeThumbPanelProps) {
  const store = useNovelStore();
  const competitorInputRef = useRef<HTMLInputElement | null>(null);
  const variants = (store.generatedImageVariants?.[thumbAssetKey] || []).filter(Boolean);
  const hasCompetitorDna = competitorThumbDna.trim().length > 20;

  return (
    <>
      <div className="sm:col-span-2 min-w-0 flex flex-col gap-2 rounded-lg border border-zinc-900 bg-zinc-950/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Thumb prompt (EN)
          </label>
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            <button
              type="button"
              disabled={thumbRegenLoading || thumbFromLineLoading}
              onClick={() => void onRewriteNoLine()}
              className="text-[9px] font-bold uppercase text-amber-500 hover:text-amber-400 border border-amber-900/30 px-2 py-1 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              title="Viết lại prompt không dùng Thumbnail line"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${thumbRegenLoading ? 'animate-spin' : ''}`} />
              {thumbRegenLoading ? 'Đang viết lại…' : 'Viết lại không Thumbnail line'}
            </button>
            <button
              type="button"
              disabled={thumbFromLineLoading || thumbRegenLoading}
              onClick={() => void onRewriteWithLine()}
              className="text-[9px] font-bold uppercase text-sky-400 hover:text-sky-300 border border-sky-900/40 px-2 py-1 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              title={`Viết lại prompt với Thumbnail line (${thumbnailLine.length}/30)`}
            >
              <RefreshCw
                className={`h-2.5 w-2.5 ${thumbFromLineLoading ? 'animate-spin' : ''}`}
              />
              {thumbFromLineLoading ? 'Đang viết lại…' : 'Viết lại với Thumbnail line'}
            </button>
            <button
              type="button"
              disabled={thumbImageLoading || !thumbnailPrompt.trim()}
              onClick={() => void onGenImage()}
              className="text-[9px] font-bold uppercase text-black bg-emerald-500 hover:bg-emerald-400 border-none px-2 py-1 rounded shadow-md transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                hasCompetitorDna
                  ? 'Gen ảnh: giữ nội dung Thumb prompt + nhái DNA thumbnail đối thủ'
                  : 'Gen ảnh từ Thumb prompt'
              }
            >
              {thumbImageLoading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <ImagePlus className="h-2.5 w-2.5" />
              )}
              {thumbImageLoading
                ? 'Đang vẽ…'
                : thumbImageUrl
                  ? hasCompetitorDna
                    ? 'Tạo lại (DNA đối thủ)'
                    : 'Tạo lại ảnh'
                  : hasCompetitorDna
                    ? 'Gen ảnh (DNA đối thủ)'
                    : 'Gen ảnh'}
            </button>
            <button
              type="button"
              disabled={!thumbnailPrompt.trim()}
              onClick={async () => {
                const v = thumbnailPrompt.trim();
                if (!v) return;
                try {
                  await navigator.clipboard.writeText(v);
                } catch {
                  /* ignore */
                }
              }}
              className="text-[9px] font-bold uppercase text-zinc-400 hover:text-white border border-zinc-800 px-2 py-1 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40"
            >
              <Copy className="h-2.5 w-2.5" />
              Copy
            </button>
          </div>
        </div>

        {/* Competitor thumbnail DNA upload */}
        <div className="rounded-lg border border-violet-900/40 bg-violet-950/15 p-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Dna className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300">
                Thumbnail đối thủ → DNA
              </span>
              {hasCompetitorDna ? (
                <span className="text-[8px] font-bold uppercase text-emerald-400 border border-emerald-800/50 rounded px-1.5 py-0.5">
                  DNA ready · Gen sẽ nhái style
                </span>
              ) : (
                <span className="text-[8px] text-zinc-500 font-medium normal-case tracking-normal">
                  Up 1–3 ảnh thumb đối thủ · mô phỏng DNA, giữ nội dung prompt
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={competitorInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  onUploadCompetitor(e.target.files);
                  if (competitorInputRef.current) competitorInputRef.current.value = '';
                }}
              />
              <button
                type="button"
                disabled={competitorDnaLoading}
                onClick={() => competitorInputRef.current?.click()}
                className="text-[9px] font-bold uppercase text-white bg-violet-600 hover:bg-violet-500 border-none px-2 py-1 rounded shadow-md transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {competitorDnaLoading ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Upload className="h-2.5 w-2.5" />
                )}
                {competitorDnaLoading ? 'Đang quét DNA…' : 'Up thumbnail đối thủ'}
              </button>
              {hasCompetitorDna || competitorThumbPreview ? (
                <button
                  type="button"
                  disabled={competitorDnaLoading}
                  onClick={() => onClearCompetitor()}
                  className="text-[9px] font-bold uppercase text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900/50 px-2 py-1 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40"
                  title="Xóa DNA đối thủ"
                >
                  <X className="h-2.5 w-2.5" />
                  Xóa
                </button>
              ) : null}
            </div>
          </div>

          {(competitorThumbPreview || hasCompetitorDna) && (
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(7rem,9rem)_1fr] gap-2 items-start">
              {competitorThumbPreview ? (
                <div className="relative w-full aspect-video overflow-hidden rounded border border-violet-800/50 bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={competitorThumbPreview}
                    alt="Competitor thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0.5 left-0.5 bg-black/80 rounded px-1 text-[7px] font-mono text-violet-300 border border-violet-900/40">
                    ref
                  </div>
                </div>
              ) : (
                <div className="w-full aspect-video rounded border border-dashed border-violet-900/40 bg-black/40 flex items-center justify-center text-[8px] text-zinc-600 uppercase font-bold">
                  DNA only
                </div>
              )}
              <div className="min-w-0 flex flex-col gap-1">
                <p className="text-[9px] leading-relaxed text-zinc-400">
                  DNA style/layout khóa khi <span className="text-violet-300 font-semibold">Gen ảnh</span>
                  — nội dung Thumb prompt (EN) không bị thay. Không ghi đè DNA thị giác global.
                </p>
                {hasCompetitorDna ? (
                  <p
                    className="text-[10px] font-mono leading-snug text-violet-200/90 line-clamp-4 break-words"
                    title={competitorThumbDna}
                  >
                    {competitorThumbDna.slice(0, 360)}
                    {competitorThumbDna.length > 360 ? '…' : ''}
                  </p>
                ) : competitorDnaLoading ? (
                  <p className="text-[9px] text-violet-400 animate-pulse font-bold uppercase">
                    Vision đang bóc DNA…
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_minmax(10rem,14rem)] gap-3 items-start">
          <textarea
            value={thumbnailPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={5}
            placeholder="16:9 cinematic thumbnail still…"
            className="w-full min-h-[6rem] resize-y rounded-lg border border-zinc-800 bg-black/50 px-3 py-2.5 text-[12px] leading-relaxed font-mono text-zinc-200 outline-none focus:border-amber-600/50 placeholder:text-zinc-600"
          />

          <div className="w-full flex flex-col gap-1.5 items-center">
            {thumbImageUrl ? (
              <button
                type="button"
                onClick={() => setZoomThumbUrl(thumbImageUrl)}
                className="relative group w-full aspect-video overflow-hidden rounded-lg border border-zinc-800/80 shadow-md transition-all duration-300 hover:border-emerald-700/60 cursor-zoom-in bg-black"
                title="Bấm để phóng to ảnh thumbnail"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbImageUrl}
                  alt={`Thumbnail ch${ch}`}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                {thumbnailLine.trim() ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-2 pt-8">
                    <span
                      className="max-w-[95%] text-center text-[11px] sm:text-sm font-black uppercase leading-tight tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                      style={{
                        fontFamily: 'Anton, Bangers, Impact, system-ui, sans-serif',
                        WebkitTextStroke: '0.5px rgba(0,0,0,0.55)',
                      }}
                    >
                      {thumbnailLine.trim().slice(0, 30)}
                    </span>
                  </div>
                ) : null}
                <div className="absolute top-1 right-1 bg-black/75 backdrop-blur-sm rounded px-1.5 py-0.5 text-[7px] font-mono text-zinc-400 border border-zinc-800">
                  thumb-01
                </div>
                {hasCompetitorDna ? (
                  <div className="absolute top-1 left-1 bg-violet-950/90 backdrop-blur-sm rounded px-1.5 py-0.5 text-[7px] font-mono text-violet-300 border border-violet-800/60">
                    DNA lock
                  </div>
                ) : null}
              </button>
            ) : (
              <div className="w-full aspect-video rounded-lg border border-dashed border-zinc-800 bg-black/40 flex flex-col items-center justify-center gap-1 text-zinc-600 px-2">
                <ImagePlus className="h-5 w-5 opacity-50" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-center">
                  Chưa có ảnh · Gen ảnh
                </span>
              </div>
            )}

            {variants.length > 1 ? (
              <div className="w-full grid grid-cols-4 gap-1">
                {variants.slice(0, 4).map((src, i) => {
                  const isWin =
                    (thumbImageUrl || '').split('?')[0] === (src || '').split('?')[0];
                  return (
                    <button
                      key={`${src}_${i}`}
                      type="button"
                      onClick={() => onPickVariant(src)}
                      className={`relative aspect-video overflow-hidden rounded border cursor-pointer ${
                        isWin
                          ? 'border-emerald-500 ring-1 ring-emerald-500/40'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                      title={isWin ? 'Winner' : `Chọn biến thể ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`v${i + 1}`} className="h-full w-full object-cover" />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {thumbImageLoading && (
              <span className="text-[9px] font-bold uppercase text-emerald-400 animate-pulse">
                {hasCompetitorDna ? 'Đang vẽ · nhái DNA đối thủ…' : 'Đang vẽ thumbnail…'}
              </span>
            )}
          </div>
        </div>
      </div>

      {zoomThumbUrl && (
        <div
          role="presentation"
          onClick={() => setZoomThumbUrl(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md cursor-zoom-out animate-in fade-in duration-200"
        >
          <button
            type="button"
            onClick={() => setZoomThumbUrl(null)}
            className="fixed top-6 right-6 z-[110] h-12 w-12 bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-amber-400 hover:scale-110 active:scale-95 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer text-xl font-bold shadow-[0_0_15px_rgba(0,0,0,0.5)]"
            title="Đóng"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomThumbUrl}
            alt="Thumbnail zoom"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] cursor-default rounded-2xl border border-zinc-800 object-contain shadow-2xl animate-in zoom-in-95 duration-200"
          />
        </div>
      )}
    </>
  );
}
