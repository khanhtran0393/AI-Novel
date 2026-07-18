'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  resolveConfirm,
  subscribeConfirm,
  type ConfirmRequest,
  type ConfirmTone,
} from '@/lib/confirmDialog';

const TONE: Record<
  ConfirmTone,
  {
    ring: string;
    iconBg: string;
    icon: React.ReactNode;
    title: string;
    confirmBtn: string;
    glow: string;
  }
> = {
  danger: {
    ring: 'border-rose-500/35',
    iconBg: 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30',
    icon: <ShieldAlert className="h-5 w-5" strokeWidth={2} />,
    title: 'text-rose-200',
    confirmBtn:
      'bg-gradient-to-r from-rose-600 to-red-500 text-white shadow-lg shadow-rose-900/40 hover:from-rose-500 hover:to-red-400',
    glow: 'shadow-[0_0_40px_rgba(244,63,94,0.12)]',
  },
  warn: {
    ring: 'border-amber-500/30',
    iconBg: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
    icon: <AlertTriangle className="h-5 w-5" strokeWidth={2} />,
    title: 'text-amber-200',
    confirmBtn:
      'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-lg shadow-amber-900/30 hover:from-amber-400 hover:to-orange-400',
    glow: 'shadow-[0_0_40px_rgba(245,158,11,0.1)]',
  },
  info: {
    ring: 'border-indigo-500/35',
    iconBg: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30',
    icon: <Info className="h-5 w-5" strokeWidth={2} />,
    title: 'text-indigo-200',
    confirmBtn:
      'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:to-violet-400',
    glow: 'shadow-[0_0_40px_rgba(99,102,241,0.12)]',
  },
  success: {
    ring: 'border-emerald-500/35',
    iconBg: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    icon: <CheckCircle2 className="h-5 w-5" strokeWidth={2} />,
    title: 'text-emerald-200',
    confirmBtn:
      'bg-gradient-to-r from-emerald-500 to-teal-400 text-black shadow-lg shadow-emerald-900/30 hover:from-emerald-400 hover:to-teal-300',
    glow: 'shadow-[0_0_40px_rgba(16,185,129,0.12)]',
  },
};

export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeConfirm(setReq), []);

  useEffect(() => {
    if (!req) return;
    const t = window.setTimeout(() => {
      if (req.mode === 'alert') confirmRef.current?.focus();
      else cancelRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveConfirm(req.id, req.mode === 'alert');
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        // Enter on focused button is enough; avoid double-fire
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;

  const st = TONE[req.tone] || TONE.warn;
  const isAlert = req.mode === 'alert';

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Đóng"
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
        onClick={() => resolveConfirm(req.id, isAlert)}
      />

      {/* Panel */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${req.id}`}
        aria-describedby={`confirm-desc-${req.id}`}
        className={`relative w-full max-w-[420px] overflow-hidden rounded-2xl border bg-zinc-950/95 ${st.ring} ${st.glow} animate-in zoom-in-95 fade-in duration-200`}
      >
        {/* Top accent line */}
        <div
          className={`h-0.5 w-full ${
            req.tone === 'danger'
              ? 'bg-gradient-to-r from-transparent via-rose-500 to-transparent'
              : req.tone === 'warn'
                ? 'bg-gradient-to-r from-transparent via-amber-400 to-transparent'
                : req.tone === 'success'
                  ? 'bg-gradient-to-r from-transparent via-emerald-400 to-transparent'
                  : 'bg-gradient-to-r from-transparent via-indigo-400 to-transparent'
          }`}
        />

        <div className="relative p-5 sm:p-6">
          {/* Close */}
          <button
            type="button"
            onClick={() => resolveConfirm(req.id, isAlert)}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800/80 hover:text-zinc-200 cursor-pointer"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex gap-3.5">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${st.iconBg}`}
            >
              {st.icon}
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <h2
                id={`confirm-title-${req.id}`}
                className={`text-sm font-bold uppercase tracking-wider ${st.title}`}
              >
                {req.title}
              </h2>
              <p
                id={`confirm-desc-${req.id}`}
                className="mt-1.5 text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap"
              >
                {req.message}
              </p>
              {req.details && req.details.length > 0 ? (
                <ul className="mt-2.5 space-y-1 rounded-lg border border-zinc-800/80 bg-black/40 px-3 py-2">
                  {req.details.map((d, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-[11px] leading-snug text-zinc-400"
                    >
                      <span className="mt-0.5 shrink-0 text-zinc-600">›</span>
                      <span className="whitespace-pre-wrap">{d}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div
            className={`mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end ${
              isAlert ? 'sm:justify-center' : ''
            }`}
          >
            {!isAlert ? (
              <button
                ref={cancelRef}
                type="button"
                onClick={() => resolveConfirm(req.id, false)}
                className="rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-white cursor-pointer"
              >
                {req.cancelLabel || 'Hủy'}
              </button>
            ) : null}
            <button
              ref={confirmRef}
              type="button"
              onClick={() => resolveConfirm(req.id, true)}
              className={`rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wide transition-all cursor-pointer ${st.confirmBtn}`}
            >
              {req.confirmLabel}
            </button>
          </div>
        </div>

        {/* Bottom glass strip */}
        <div className="border-t border-zinc-900/80 bg-zinc-900/40 px-5 py-2">
          <p className="text-[9px] font-medium uppercase tracking-widest text-zinc-600">
            AI Novel · {isAlert ? 'Thông báo' : 'Xác nhận hành động'}
          </p>
        </div>
      </div>
    </div>
  );
}
