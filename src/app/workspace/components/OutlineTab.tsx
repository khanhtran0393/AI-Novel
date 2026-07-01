'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface OutlineTabProps {
  handlePrevChapter: () => void;
  handleNextChapter: () => void;
}

export default function OutlineTab({
  handlePrevChapter,
  handleNextChapter
}: OutlineTabProps) {
  const store = useNovelStore();
  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
        <h2 className="text-xl font-bold text-zinc-100 tracking-wide uppercase">
          📋 Dàn Ý Tổng Quan Truyện: {store.ten_tac_pham}
        </h2>
        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded px-2 py-1 text-xs shrink-0 ml-4">
          <button
            type="button"
            disabled={store.chuong_dang_chon <= 1}
            onClick={handlePrevChapter}
            className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-semibold text-zinc-400 select-none whitespace-nowrap">
            Chương {store.chuong_dang_chon}/{store.danh_sach_chuong.length}
          </span>
          <button
            type="button"
            disabled={store.chuong_dang_chon >= store.danh_sach_chuong.length}
            onClick={handleNextChapter}
            className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      
      <div className="whitespace-pre-line bg-zinc-950/40 border border-zinc-900 rounded-lg p-5 font-mono text-zinc-400 text-xs leading-normal">
        {store.dan_y_tong_the}
      </div>

      {store.lorebook && store.lorebook.trim() !== '' && (
        <div className="mt-8 border-t border-zinc-900 pt-6">
          <h3 className="text-md font-bold text-sky-500 mb-2 uppercase">
            📖 Lorebook (Lõi Bất Biến):
          </h3>
          <div className="whitespace-pre-line bg-sky-950/20 border border-sky-900/40 rounded p-4 text-xs leading-relaxed text-sky-300 font-sans">
            {store.lorebook}
          </div>
        </div>
      )}

      {currentChapter && (
        <div className="mt-8 border-t border-zinc-900 pt-6">
          <h3 className="text-md font-bold text-amber-500 mb-2 uppercase">
            📍 Tóm Tắt {currentChapter.tieu_de}:
          </h3>
          <p className="bg-zinc-950/60 border border-zinc-900/60 rounded p-4 text-xs leading-relaxed text-zinc-300 italic font-sans">
            {currentChapter.dan_y}
          </p>
        </div>
      )}
    </div>
  );
}
