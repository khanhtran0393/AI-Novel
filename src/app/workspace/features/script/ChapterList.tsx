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

  return (
    <div className="mb-5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
        DANH SÁCH CHƯƠNG
        <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
          (chấm = Quality Gate)
        </span>
      </label>
      <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto pr-1">
        {chapters.map((ch) => {
          const isActive = ch.so_chuong === active;
          const hasContent = ch.trang_thai === 'ready';
          const cls = isActive
            ? 'border-amber-500 bg-amber-500/10 text-amber-500 glow-amber-sm'
            : hasContent
              ? 'border-emerald-800 bg-emerald-950/20 text-emerald-400'
              : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200';
          return (
            <button
              key={ch.so_chuong}
              type="button"
              onClick={() => selectChuong(ch.so_chuong)}
              className={`relative flex h-9 items-center justify-center rounded border text-xs font-bold transition-all duration-200 cursor-pointer ${cls}`}
            >
              {ch.so_chuong}
              <span className="absolute right-1 top-1">
                <QualityGateBadge
                  chapter={ch.so_chuong}
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
