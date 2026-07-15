'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';

/** Lưới chọn chương — tách khỏi Sidebar */
export default function ChapterList() {
  const store = useNovelStore();
  return (
    <div className="mb-5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
        DANH SÁCH CHƯƠNG
      </label>
      <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto pr-1">
        {store.danh_sach_chuong.map((ch) => {
          const isActive = ch.so_chuong === store.chuong_dang_chon;
          const hasContent = ch.trang_thai === 'ready';
          return (
            <button
              key={ch.so_chuong}
              type="button"
              onClick={() => store.selectChuong(ch.so_chuong)}
              className={`flex h-9 items-center justify-center rounded border text-xs font-bold transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'border-amber-500 bg-amber-500/10 text-amber-500 glow-amber-sm'
                  : hasContent
                    ? 'border-emerald-800 bg-emerald-950/20 text-emerald-400'
                    : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              {ch.so_chuong}
            </button>
          );
        })}
      </div>
    </div>
  );
}
