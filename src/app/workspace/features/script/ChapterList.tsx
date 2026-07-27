'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import QualityGateBadge from './QualityGateBadge';
import { hasMediaPath } from '@/lib/pipeline';

/**
 * Cheap media tint from store keys only (no full video-ready parse).
 * top-right QG = quality · bottom-left = media (TTS/ảnh/video).
 */
function chapterMediaTint(
  chapter: number,
  audio: Record<string, unknown>,
  images: Record<string, unknown>,
  videos: Record<string, unknown>,
): 'empty' | 'partial' | 'ready' {
  const re = new RegExp(`^${chapter}_`);
  let a = 0;
  let i = 0;
  let v = 0;
  for (const k of Object.keys(audio || {})) {
    if (re.test(k) && hasMediaPath(audio[k])) a += 1;
  }
  for (const k of Object.keys(images || {})) {
    if (re.test(k) && hasMediaPath(images[k])) i += 1;
  }
  for (const k of Object.keys(videos || {})) {
    if (re.test(k) && hasMediaPath(videos[k])) v += 1;
  }
  if (a > 0 && i > 0 && v > 0) return 'ready';
  if (a > 0 || i > 0 || v > 0) return 'partial';
  return 'empty';
}

/**
 * Lưới chọn chương.
 * CẤM map/object-literal trong selector (useSyncExternalStore infinite loop).
 * Subscribe raw list + active chapter; derive UI in render.
 * P0: Quality Gate dot per chapter.
 * P0b: media tint (TTS/ảnh/video) — companion to Video-ready board.
 */
export default function ChapterList() {
  const chapters = useNovelStore((s) => s.danh_sach_chuong);
  const active = useNovelStore((s) => s.chuong_dang_chon);
  const selectChuong = useNovelStore((s) => s.selectChuong);
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const generatedAudioPaths = useNovelStore((s) => s.generatedAudioPaths);
  const generatedImages = useNovelStore((s) => s.generatedImages);
  const generatedVideos = useNovelStore((s) => s.generatedVideos);
  const freeTier = !is_pro && !is_trial && !is_vip;
  const trialTier = !!is_trial;
  const maxCh = freeTier ? 2 : trialTier ? 10 : Number.POSITIVE_INFINITY;

  return (
    <div className="mb-5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
        DANH SÁCH CHƯƠNG
        <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
          (chấm trên = QG · chấm dưới = media
          {freeTier ? ' · Free ≤2 ch' : trialTier ? ' · Trial ≤10 ch' : ''})
        </span>
      </label>
      <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto pr-1">
        {chapters.map((ch) => {
          const so = Number(ch.so_chuong);
          const isActive = so === Number(active);
          const hasContent =
            ch.trang_thai === 'ready' || Boolean(String(ch.noi_dung || '').trim());
          const locked = Number.isFinite(maxCh) && so > maxCh;
          const mediaTint = hasContent
            ? chapterMediaTint(
                so,
                generatedAudioPaths as Record<string, unknown>,
                generatedImages as Record<string, unknown>,
                generatedVideos as Record<string, unknown>,
              )
            : 'empty';
          const mediaDot =
            mediaTint === 'ready'
              ? 'bg-emerald-400'
              : mediaTint === 'partial'
                ? 'bg-amber-400'
                : 'bg-zinc-700';
          const cls = locked
            ? 'border-zinc-800/80 bg-zinc-950/80 text-zinc-600 opacity-70'
            : isActive
              ? 'border-amber-500 bg-amber-500/10 text-amber-500 glow-amber-sm'
              : hasContent
                ? 'border-emerald-800 bg-emerald-950/20 text-emerald-400'
                : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200';
          return (
            <button
              key={so}
              type="button"
              title={
                locked
                  ? freeTier
                    ? `Chương ${so} ngoài Free (≤2). Nâng Trial/Pro hoặc xóa bớt chương.`
                    : `Chương ${so} ngoài Trial (≤10). Nâng Pro.`
                  : `Ch${so} · media: ${mediaTint} (TTS/ảnh/video). Chấm trên = Quality Gate.`
              }
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                selectChuong(so);
              }}
              className={`relative z-[1] flex h-9 items-center justify-center rounded border text-xs font-bold transition-all duration-200 cursor-pointer select-none ${cls}`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {so}
              {locked ? (
                <span className="pointer-events-none absolute left-0.5 top-0.5 text-[8px]">
                  🔒
                </span>
              ) : null}
              <span className="pointer-events-none absolute right-1 top-1">
                <QualityGateBadge
                  chapter={so}
                  variant="dot"
                  lazyScan={hasContent}
                />
              </span>
              <span
                className={`pointer-events-none absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full ${mediaDot}`}
                title={`Media ${mediaTint}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
