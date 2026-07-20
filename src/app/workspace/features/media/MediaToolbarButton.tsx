'use client';

import React, { useEffect, useState } from 'react';
import { Image } from 'lucide-react';
import { API } from '@/contracts';
import MediaConfigModal from './MediaConfigModal';

/** Nút Ảnh/Video + modal — chấm trạng thái Flow (token / login) */
export default function MediaToolbarButton() {
  const [open, setOpen] = useState(false);
  const [flowReady, setFlowReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Idle badge: 20s. While Google login open: 6s. Hidden tab: skip. */
    const IDLE_MS = 20_000;
    const LOGIN_MS = 6_000;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(IDLE_MS);
        return;
      }
      let nextMs = IDLE_MS;
      try {
        const res = await fetch(API.flowStatus, { cache: 'no-store' });
        const j = await res.json();
        if (dead) return;
        // Ready only when at least one profile has real Google email + token
        const accounts = Array.isArray(j.accounts) ? j.accounts : [];
        const anyProfileReady = accounts.some(
          (a: {
            flowKeyPresent?: boolean;
            sessionVerified?: boolean;
            email?: string;
          }) =>
            Boolean(
              a.flowKeyPresent &&
                a.sessionVerified &&
                a.email &&
                String(a.email).includes('@'),
            ),
        );
        const ready = Boolean(
          anyProfileReady && j.flowKeyPresent && j.extensionConnected,
        );
        const login = Boolean(j.loginSessionOpen);
        setFlowReady((prev) => (prev === ready ? prev : ready));
        setLoginOpen((prev) => (prev === login ? prev : login));
        nextMs = login ? LOGIN_MS : IDLE_MS;
      } catch {
        if (!dead) {
          setFlowReady(false);
          setLoginOpen(false);
        }
      }
      if (!dead) schedule(nextMs);
    };

    void tick();
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const title = flowReady
    ? 'Flow sẵn sàng (token OK)'
    : loginOpen
      ? 'Đang chờ đăng nhập Google…'
      : 'Ảnh / Video — cấu hình Flow';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        className="relative flex shrink-0 whitespace-nowrap items-center justify-center gap-1 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
      >
        <Image className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">Ảnh / Video</span>
        <span
          className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${
            flowReady
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
              : loginOpen
                ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.9)]'
                : 'bg-zinc-600'
          }`}
        />
      </button>
      {/* Lazy-mount: tránh full-store subscribe khi modal đóng (GUI đứng) */}
      {open ? (
        <MediaConfigModal isOpen onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
