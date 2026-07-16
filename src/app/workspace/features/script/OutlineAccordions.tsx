'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { BookOpen, Award, Book, ChevronUp, ChevronDown } from 'lucide-react';

/** Accordion dàn ý chương / tổng quan / lorebook */
export default function OutlineAccordions() {
  const chuong = useNovelStore((s) => s.chuong_dang_chon);
  const danYTongThe = useNovelStore((s) => s.dan_y_tong_the);
  const lorebook = useNovelStore((s) => s.lorebook);
  // Primitive dan_y only — no object-literal selector (avoids getSnapshot loop)
  const chapterDanY = useNovelStore((s) => {
    const ch = s.danh_sach_chuong.find((c) => c.so_chuong === s.chuong_dang_chon);
    return ch?.dan_y || '';
  });
  const hasCurrentChapter = useNovelStore((s) =>
    s.danh_sach_chuong.some((c) => c.so_chuong === s.chuong_dang_chon),
  );
  const [openOutlineTab, setOpenOutlineTab] = useState<
    'chapter' | 'overall' | 'lore' | null
  >('chapter');

  return (
    <div className="mb-5 border-t border-zinc-900 pt-4 space-y-2">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
        DÀN Ý & CẤU TRÚC KỊCH BẢN
      </label>

      <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
        <button
          type="button"
          onClick={() =>
            setOpenOutlineTab((prev) => (prev === 'chapter' ? null : 'chapter'))
          }
          className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-amber-500 hover:bg-zinc-900/70 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Tóm Tắt Chương {chuong}
          </span>
          {openOutlineTab === 'chapter' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {openOutlineTab === 'chapter' && hasCurrentChapter && (
          <div className="p-3 text-[11px] leading-relaxed text-zinc-300 bg-zinc-950/90 italic border-t border-zinc-900 font-sans whitespace-pre-line max-h-32 overflow-y-auto">
            {chapterDanY || 'Chưa có dàn ý cụ thể cho chương này.'}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
        <button
          type="button"
          onClick={() =>
            setOpenOutlineTab((prev) => (prev === 'overall' ? null : 'overall'))
          }
          className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-zinc-300 hover:bg-zinc-900/70 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Award className="h-3.5 w-3.5 text-sky-500" />
            Dàn Ý Tổng Quan
          </span>
          {openOutlineTab === 'overall' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {openOutlineTab === 'overall' && (
          <div className="p-3 text-[10px] leading-relaxed text-zinc-400 bg-zinc-950/90 border-t border-zinc-900 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
            {danYTongThe || 'Chưa có dàn ý tổng quan.'}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
        <button
          type="button"
          onClick={() =>
            setOpenOutlineTab((prev) => (prev === 'lore' ? null : 'lore'))
          }
          className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-zinc-300 hover:bg-zinc-900/70 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Book className="h-3.5 w-3.5 text-emerald-500" />
            Luật Lorebook (Lõi)
          </span>
          {openOutlineTab === 'lore' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {openOutlineTab === 'lore' && (
          <div className="p-3 text-[10px] leading-relaxed text-zinc-400 bg-zinc-950/90 border-t border-zinc-900 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
            {lorebook || 'Chưa có Lorebook.'}
          </div>
        )}
      </div>
    </div>
  );
}
