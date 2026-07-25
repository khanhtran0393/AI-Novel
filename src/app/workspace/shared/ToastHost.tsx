'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, XCircle, ChevronDown } from 'lucide-react';
import {
  subscribeToasts,
  type AppToast,
  type ToastKind,
} from '@/lib/toastBus';

const KIND_STYLES: Record<
  ToastKind,
  { border: string; icon: React.ReactNode; title: string }
> = {
  info: {
    border: 'border-sky-800/60 bg-sky-950/90',
    icon: <Info className="h-4 w-4 text-sky-400 shrink-0" />,
    title: 'text-sky-200',
  },
  success: {
    border: 'border-emerald-800/60 bg-emerald-950/90',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />,
    title: 'text-emerald-200',
  },
  warn: {
    border: 'border-amber-800/60 bg-amber-950/90',
    icon: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,
    title: 'text-amber-200',
  },
  error: {
    border: 'border-red-800/60 bg-red-950/90',
    icon: <XCircle className="h-4 w-4 text-red-400 shrink-0" />,
    title: 'text-red-200',
  },
};

export default function ToastHost() {
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    return subscribeToasts((t) => {
      setToasts((prev) => [...prev.slice(-7), t]);
      // Auto-expand when detail is present (user asked: bấm xem nguyên nhân)
      if (t.detail) {
        setExpanded((prev) => ({ ...prev, [t.id]: true }));
      }
      const ms = t.durationMs ?? 4500;
      if (ms > 0) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
          setExpanded((prev) => {
            const next = { ...prev };
            delete next[t.id];
            return next;
          });
        }, ms);
      }
    });
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(400px,92vw)] flex-col gap-2">
      {toasts.map((t) => {
        const st = KIND_STYLES[t.kind] || KIND_STYLES.info;
        const hasDetail = Boolean(t.detail && t.detail.trim());
        const isOpen = !!expanded[t.id];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 shadow-2xl backdrop-blur-md animate-in slide-in-from-right-4 fade-in duration-200 ${st.border}`}
          >
            {st.icon}
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className={`w-full text-left ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => {
                  if (!hasDetail) return;
                  setExpanded((prev) => ({ ...prev, [t.id]: !prev[t.id] }));
                }}
                title={
                  hasDetail
                    ? isOpen
                      ? 'Thu gọn nguyên nhân'
                      : 'Bấm để xem nguyên nhân chi tiết'
                    : undefined
                }
              >
                <div
                  className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider ${st.title}`}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {hasDetail ? (
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 opacity-80 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  ) : null}
                </div>
                {t.message ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-300 whitespace-pre-wrap">
                    {t.message}
                  </p>
                ) : null}
                {hasDetail && !isOpen ? (
                  <p className="mt-1 text-[10px] text-zinc-500 underline-offset-2 hover:underline">
                    Bấm để xem nguyên nhân…
                  </p>
                ) : null}
              </button>
              {hasDetail && isOpen ? (
                <pre className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-zinc-800/80 bg-black/40 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-200 whitespace-pre-wrap font-sans">
                  {t.detail}
                </pre>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
                setExpanded((prev) => {
                  const next = { ...prev };
                  delete next[t.id];
                  return next;
                });
              }}
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-white cursor-pointer"
              title="Đóng"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
