'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
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

  useEffect(() => {
    return subscribeToasts((t) => {
      setToasts((prev) => [...prev.slice(-7), t]);
      const ms = t.durationMs ?? 4500;
      if (ms > 0) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
        }, ms);
      }
    });
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(360px,92vw)] flex-col gap-2">
      {toasts.map((t) => {
        const st = KIND_STYLES[t.kind] || KIND_STYLES.info;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 shadow-2xl backdrop-blur-md animate-in slide-in-from-right-4 fade-in duration-200 ${st.border}`}
          >
            {st.icon}
            <div className="min-w-0 flex-1">
              <div className={`text-[11px] font-bold uppercase tracking-wider ${st.title}`}>
                {t.title}
              </div>
              {t.message ? (
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-300 whitespace-pre-wrap">
                  {t.message}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
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
