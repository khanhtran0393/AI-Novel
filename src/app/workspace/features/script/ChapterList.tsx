'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import QualityGateBadge from './QualityGateBadge';

/**
 * Lưới chọn chương.
 * CẤM map/object-literal trong selector (useSyncExternalStore infinite loop).
 * Subscribe raw list + active chapter; derive UI in render.
 * P0: Quality Gate dot per chapter.
 */
export default function ChapterList() {
  const chapters = useNovelStore((s) => s.danh_sach_chuong);
  const active = useNovelStore((s) => s.chuong_dang_chon);
  const selectChuong = useNovelStore((s) => s.selectChuong);
  const is_pro = useNovelStore((s) => s.is_pro);
  const is_trial = useNovelStore((s) => s.is_trial);
  const is_vip = useNovelStore((s) => s.is_vip);
  const freeTier = !is_pro && !is_trial && !is_vip;
  const trialTier = !!is_trial;
  const maxCh = freeTier ? 2 : trialTier ? 10 : Number.POSITIVE_INFINITY;

  return (
    <div className="mb-5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
        DANH SÁCH CHƯƠNG
        <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
          (chấm = Quality Gate
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
                  : undefined
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
