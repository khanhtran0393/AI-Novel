'use client';

/**
 * AINovel Dashboard — header toolbar (start/stop/sync/diag/config).
 */
import React from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Download,
  FileText,
  Stethoscope,
  PlaySquare,
  Settings,
} from 'lucide-react';

export type EngineToolbarProps = {
  status: string;
  busy: boolean;
  capsHint?: string;
  lastError?: string | null;
  onStart: () => void;
  onResume: () => void;
  onStop: () => void;
  onDownloadAll: () => void;
  onSyncScript: () => void;
  onDiag: () => void;
  onYoutube: () => void;
  onConfig: () => void;
};

export default function EngineToolbar({
  status,
  busy,
  capsHint,
  lastError,
  onStart,
  onResume,
  onStop,
  onDownloadAll,
  onSyncScript,
  onDiag,
  onYoutube,
  onConfig,
}: EngineToolbarProps) {
  return (
    <div className="flex flex-col gap-4 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 uppercase tracking-widest mb-2 flex items-center gap-2">
            🚀 AINovel Core Engine
            {status === 'running' && (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
            )}
          </h2>
          <p className="text-sm text-zinc-400">
            Engine native: Router · rules · context · sync · diag
            {capsHint ? (
              <span className="ml-2 text-[11px] text-emerald-500/90 font-mono">
                {capsHint}
              </span>
            ) : null}
          </p>
          {lastError ? (
            <p className="mt-1 text-[11px] text-red-400 font-mono">⚠ {lastError}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {status === 'running' ? (
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-2.5 text-sm font-bold text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-black transition-all cursor-pointer disabled:opacity-50"
            >
              <Square className="h-4 w-4 fill-current" />
              DỪNG
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onStart}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-black hover:bg-emerald-400 transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                START
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onResume}
                className="flex items-center gap-2 rounded-lg border border-sky-700/50 bg-sky-950/30 px-4 py-2.5 text-sm font-bold text-sky-400 hover:bg-sky-500 hover:text-black transition-all cursor-pointer disabled:opacity-50"
                title="Tiếp tục từ progress đã lưu"
              >
                <RefreshCw className="h-4 w-4" />
                RESUME
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onDownloadAll}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-bold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            title="Tải toàn bộ chương .md"
          >
            <Download className="h-4 w-4" />
            TẢI ALL
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onSyncScript}
            className="flex items-center gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2.5 text-xs font-bold text-amber-400 hover:bg-amber-500 hover:text-black cursor-pointer disabled:opacity-50"
            title="Đẩy toàn bộ chương engine sang tab Script"
          >
            <FileText className="h-4 w-4" />
            → SCRIPT
          </button>

          <button
            type="button"
            onClick={onDiag}
            className="flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/20 px-3 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500 hover:text-black cursor-pointer"
          >
            <Stethoscope className="h-4 w-4" />
            DIAG
          </button>

          <button
            type="button"
            onClick={onYoutube}
            className="flex items-center gap-2 rounded-lg bg-amber-900/40 px-3 py-2.5 text-xs font-bold text-amber-500 border border-amber-800 hover:bg-amber-800 cursor-pointer"
          >
            <PlaySquare className="h-4 w-4" />
            YT
          </button>

          <button
            type="button"
            onClick={onConfig}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2.5 text-xs font-bold text-zinc-300 border border-zinc-800 hover:bg-zinc-800 cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            CFG
          </button>
        </div>
      </div>
    </div>
  );
}
