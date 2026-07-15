'use client';

/**
 * Quản lý SessionID TikTok (danh sách + lấy tự động + dán multi-line).
 * Tách khỏi TTSConfigModal engine tab.
 */
import React from 'react';
import { Loader2, Check, Copy, Minus, Plus } from 'lucide-react';

export type TikTokSessionsPanelProps = {
  sessions: string[];
  primarySessionId: string;
  newInput: string;
  setNewInput: (v: string) => void;
  isFetching: boolean;
  copiedIdx: number | null;
  showMissingWarn: boolean;
  onAutoFetch: () => void;
  onSetPrimary: (sid: string) => void;
  onCopy: (sid: string, idx: number) => void;
  onRemove: (sid: string) => void;
  onAddFromInput: () => void;
};

export default function TikTokSessionsPanel({
  sessions,
  primarySessionId,
  newInput,
  setNewInput,
  isFetching,
  copiedIdx,
  showMissingWarn,
  onAutoFetch,
  onSetPrimary,
  onCopy,
  onRemove,
  onAddFromInput,
}: TikTokSessionsPanelProps) {
  return (
    <div className="space-y-3 md:col-span-2 pt-2 border-t border-zinc-800">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
          SessionID TikTok
          <span className="ml-2 text-sky-400 normal-case font-semibold">
            ({sessions.length} dòng · xoay vòng khi gen)
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={onAutoFetch}
        disabled={isFetching}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-cyan-600 py-2.5 text-xs font-bold text-black shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-wait"
        title="Mở Chrome → đăng nhập TikTok → tự lấy sessionid"
      >
        {isFetching ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ĐANG CHỜ ĐĂNG NHẬP…
          </>
        ) : (
          <>🤖 Lấy Session TikTok Tự Động</>
        )}
      </button>

      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
        {sessions.map((sid, idx) => {
          const collapsed = sid.length > 36 ? `${sid.slice(0, 14)}…${sid.slice(-14)}` : sid;
          const isPrimary = (primarySessionId || '').trim() === sid;
          return (
            <div
              key={`tt-row-${idx}-${sid.slice(0, 10)}`}
              className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs ${
                isPrimary
                  ? 'border-sky-600/60 bg-sky-950/30'
                  : 'border-zinc-800 bg-black/50'
              }`}
            >
              <button
                type="button"
                onClick={() => onSetPrimary(sid)}
                className="flex flex-col overflow-hidden min-w-0 flex-1 text-left"
                title="Bấm để đặt làm session chính"
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-sky-400">
                  Dòng {idx + 1}
                  {isPrimary ? ' · Chính' : ''}
                </span>
                <span
                  className="text-[11px] text-zinc-300 font-mono break-all leading-snug"
                  title={sid}
                >
                  {collapsed}
                </span>
              </button>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onCopy(sid, idx)}
                  className="text-zinc-400 hover:text-sky-400 transition-colors p-1.5 rounded hover:bg-zinc-800"
                >
                  {copiedIdx === idx ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(sid)}
                  className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <p className="text-xs text-zinc-500 italic text-center py-3">
            Chưa có SessionID — bấm lấy tự động hoặc dán bên dưới (mỗi ID 1 dòng).
          </p>
        )}
      </div>

      <div className="flex items-start gap-2">
        <textarea
          placeholder={'Dán sessionid TikTok (mỗi ID 1 dòng)...'}
          value={newInput}
          onChange={(e) => setNewInput(e.target.value)}
          className="flex-1 h-16 min-h-[40px] max-h-32 rounded-lg border border-zinc-800 bg-black/60 p-2 text-xs text-zinc-200 outline-none focus:border-sky-500 resize-y font-mono"
        />
        <button
          type="button"
          onClick={onAddFromInput}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-black hover:bg-sky-400 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {isFetching && (
        <p className="text-[11px] text-sky-400/90 leading-relaxed">
          Chrome đang mở — đăng nhập TikTok. Poll cookie mỗi 2s (tối đa 5 phút).
        </p>
      )}
      {showMissingWarn && !isFetching && (
        <p className="text-[11px] text-amber-400/90">
          Chưa có SessionID — TikTok TTS sẽ lỗi khi gen.
        </p>
      )}
      {sessions.length > 1 && (
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          💡 Nhiều dòng = xoay vòng khi gen. Bấm 1 dòng để đặt session chính.
        </p>
      )}
    </div>
  );
}
