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
    const tick = async () => {
      try {
        const res = await fetch(API.flowStatus, { cache: 'no-store' });
        const j = await res.json();
        if (dead) return;
        const ready = Boolean(j.flowKeyPresent && j.extensionConnected);
        const login = Boolean(j.loginSessionOpen);
        setFlowReady((prev) => (prev === ready ? prev : ready));
        setLoginOpen((prev) => (prev === login ? prev : login));
      } catch {
        if (!dead) {
          setFlowReady(false);
          setLoginOpen(false);
        }
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      dead = true;
      clearInterval(t);
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
      <MediaConfigModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
