import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { ShieldAlert, ShieldCheck, RefreshCw, AlertTriangle, Wand2 } from 'lucide-react';

interface EditorPanelProps {
  chapterIndex: number;
  /** Sửa theo nhận xét (REVISE_CHAPTER) — không xóa media */
  onRevise: () => void;
  /** Viết lại từ đầu (overwrite) — xóa media chương */
  onFullRewrite: () => void;
  isRewriting: boolean;
}

export default function EditorPanel({
  chapterIndex,
  onRevise,
  onFullRewrite,
  isRewriting,
}: EditorPanelProps) {
  const store = useNovelStore();
  const review = store.editorReviews[chapterIndex];

  if (!review || !review.summary) return null;

  const { dimensions, verdict, summary } = review;
  const dims = Array.isArray(dimensions) ? dimensions : [];
  const averageScore =
    dims.length > 0
      ? Math.round(dims.reduce((acc: number, dim: { score: number }) => acc + dim.score, 0) / dims.length)
      : 0;

  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        verdict === 'accept'
          ? 'border-emerald-900/50 bg-emerald-950/10'
          : verdict === 'polish'
            ? 'border-amber-900/50 bg-amber-950/10'
            : 'border-red-900/50 bg-red-950/10'
      }`}
    >
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {verdict === 'accept' && <ShieldCheck className="h-5 w-5 text-emerald-500" />}
          {verdict === 'polish' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
          {verdict === 'rewrite' && <ShieldAlert className="h-5 w-5 text-red-500" />}
          <h4
            className={`font-bold uppercase tracking-wider text-sm ${
              verdict === 'accept'
                ? 'text-emerald-400'
                : verdict === 'polish'
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            AI Editor Review {averageScore}/100 · {verdict}
          </h4>
        </div>

        {verdict !== 'accept' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRevise}
              disabled={isRewriting}
              className="flex items-center gap-1.5 rounded bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              {isRewriting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              {verdict === 'polish' ? 'TRAU CHUỐT THEO NHẬN XÉT' : 'SỬA THEO NHẬN XÉT'}
            </button>
            <button
              type="button"
              onClick={onFullRewrite}
              disabled={isRewriting}
              className="flex items-center gap-1.5 rounded bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              VIẾT LẠI TỪ ĐẦU
            </button>
          </div>
        )}
      </div>

      <p className="text-sm text-zinc-300 mb-4 bg-black/40 p-2 rounded italic">&ldquo;{summary}&rdquo;</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dims.map((dim: { dimension: string; score: number; comment: string }, i: number) => (
          <div
            key={i}
            className="flex flex-col gap-1 bg-black/40 p-2.5 rounded border border-zinc-800/50"
          >
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {dim.dimension}
              </span>
              <span
                className={`text-[11px] font-bold ${
                  dim.score >= 80
                    ? 'text-emerald-400'
                    : dim.score >= 60
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}
              >
                {dim.score}
              </span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  dim.score >= 80
                    ? 'bg-emerald-500'
                    : dim.score >= 60
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 leading-snug">{dim.comment}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
