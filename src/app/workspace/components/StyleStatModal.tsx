import React from 'react';
import { StyleStats } from '../modules/styleStatModule';
import { X, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface StyleStatModalProps {
  stats: StyleStats | null;
  onClose: () => void;
}

export default function StyleStatModal({ stats, onClose }: StyleStatModalProps) {
  if (!stats) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-rose-900/50 bg-zinc-950 p-6 shadow-2xl shadow-rose-900/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-rose-500" />
            <h3 className="text-lg font-bold uppercase tracking-widest text-zinc-100 font-sans">
              RADAR QUÉT LỖI VĂN PHONG AI
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 bg-zinc-900/50 border border-zinc-800 rounded p-3">
          <p className="text-xs text-zinc-400 font-sans">
            Đã quét tổng cộng <strong className="text-rose-400">{stats.chapters}</strong> chương hợp lệ.
            Các chỉ số dưới đây thể hiện sự rập khuôn của AI trên diện rộng. Nếu tần suất trung bình (Per Chapter) quá cao, hãy thêm các từ này vào Cấm Từ ở Setup.
          </p>
        </div>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {/* Khuôn Câu Phổ Biến */}
          <div>
            <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Tần suất khuôn mẫu AI (Patterns)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stats.patterns.map((p, i) => (
                <div key={i} className="bg-black border border-zinc-800 rounded p-3 flex flex-col justify-between">
                  <span className="text-[11px] font-bold text-zinc-300 mb-2">{p.name}</span>
                  <div className="flex justify-between items-end">
                    <span className="text-2xl font-black text-zinc-100">{p.total} <span className="text-[10px] font-normal text-zinc-500">lần</span></span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${parseFloat(p.per_chapter) > 2 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {p.per_chapter} / chương
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cụm từ lặp (N-grams) */}
          <div>
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Cụm từ bị lặp nhiều nhất (20 chương gần đây)
            </h4>
            <div className="flex flex-wrap gap-2">
              {stats.top_phrases.length > 0 ? stats.top_phrases.map((phrase, i) => (
                <div key={i} className="flex items-center gap-2 bg-amber-950/20 border border-amber-900/40 rounded-full px-3 py-1">
                  <span className="text-xs font-bold text-zinc-200">"{phrase.text}"</span>
                  <span className="text-[10px] bg-amber-500 text-black px-1.5 rounded-full font-bold">{phrase.count}</span>
                </div>
              )) : (
                <p className="text-xs text-zinc-500 italic">Không phát hiện cụm từ lặp bất thường.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
