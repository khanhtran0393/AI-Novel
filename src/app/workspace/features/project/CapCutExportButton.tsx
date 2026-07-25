'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useCapCutExport } from '../../hooks/useCapCutExport';

/**
 * Nút CapCut (tên GUI cũ) — engine: pack media + editor multi-track trong app.
 * Component chỉ render; hook sở hữu toàn bộ orchestration.
 */
export default function CapCutExportButton() {
  const { exporting, isProEquivalent, handleExportCapCut } =
    useCapCutExport();

  return (
    <button
      type="button"
      disabled={exporting || !isProEquivalent}
      title={
        isProEquivalent
          ? 'Xuất CapCut — đóng gói media chương + mở editor'
          : 'Cần Pro/Trial — nhấp logo up to PRO'
      }
      onClick={() => {
        void handleExportCapCut();
      }}
      className="flex items-center justify-center gap-1 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-sky-400 shadow-lg transition-all duration-300 hover:bg-sky-500 hover:text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
    >
      {!isProEquivalent ? (
        <span className="text-[8px] font-black text-amber-400/90">🔒</span>
      ) : null}
      {exporting ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden sm:inline">XUẤT…</span>
        </>
      ) : (
        <>
          ✂️ <span className="hidden xl:inline">CapCut</span>
        </>
      )}
    </button>
  );
}
