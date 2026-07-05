import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { ShieldAlert, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface EditorPanelProps {
  chapterIndex: number; // 0-indexed
  onRewrite: () => void;
  isRewriting: boolean;
}

export default function EditorPanel({ chapterIndex, onRewrite, isRewriting }: EditorPanelProps) {
  const store = useNovelStore();
  const review = store.editorReviews[chapterIndex];

  if (!review) return null;

  const { dimensions, verdict, summary } = review;
  // Make sure dimensions is an array before reducing
  const dims = Array.isArray(dimensions) ? dimensions : [];
  const averageScore = dims.length > 0 ? Math.round(dims.reduce((acc: number, dim: any) => acc + dim.score, 0) / dims.length) : 0;

  return (
    <div className={`mt-4 rounded-lg border p-4 ${
      verdict === 'accept' ? 'border-emerald-900/50 bg-emerald-950/10' : 
      verdict === 'polish' ? 'border-amber-900/50 bg-amber-950/10' : 
      'border-red-900/50 bg-red-950/10'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {verdict === 'accept' && <ShieldCheck className="h-5 w-5 text-emerald-500" />}
          {verdict === 'polish' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
          {verdict === 'rewrite' && <ShieldAlert className="h-5 w-5 text-red-500" />}
          <h4 className={`font-bold uppercase tracking-wider text-sm ${
            verdict === 'accept' ? 'text-emerald-400' : 
            verdict === 'polish' ? 'text-amber-400' : 'text-red-400'
          }`}>
            AI Editor Review {averageScore}/100
          </h4>
        </div>
        
        {verdict !== 'accept' && (
          <button
            onClick={onRewrite}
            disabled={isRewriting}
            className="flex items-center gap-1.5 rounded bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            {isRewriting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            BẮT VIẾT LẠI
          </button>
        )}
      </div>

      <p className="text-sm text-zinc-300 mb-4 bg-black/40 p-2 rounded italic">
        "{summary}"
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dims.map((dim: any, i: number) => (
          <div key={i} className="flex flex-col gap-1 bg-black/40 p-2.5 rounded border border-zinc-800/50">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{dim.dimension}</span>
              <span className={`text-[11px] font-bold ${dim.score >= 80 ? 'text-emerald-400' : dim.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {dim.score}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full ${dim.score >= 80 ? 'bg-emerald-500' : dim.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${dim.score}%` }}
              ></div>
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 leading-snug">{dim.comment}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
