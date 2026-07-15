'use client';

import React from 'react';
import { Minus, Square, X } from 'lucide-react';

function callWindowControl(action: 'minimize' | 'maximize' | 'close') {
  try {
    const w = window as Window & {
      ainovelPersist?: { isElectron?: boolean };
      ainovelTools?: { windowControls?: Record<string, () => void> };
    };
    if (w.ainovelPersist?.isElectron) {
      w.ainovelTools?.windowControls?.[action]?.();
    }
  } catch {
    /* browser preview — no-op */
  }
}

/**
 * 3 nút cửa sổ OS (thu nhỏ / phóng to / đóng) — chỉ gắn khung chính app,
 * không nằm trong toolbar workspace.
 */
export default function WindowControls() {
  return (
    <div
      className="app-window-controls flex h-full shrink-0 items-stretch"
      role="group"
      aria-label="Điều khiển cửa sổ"
      style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => callWindowControl('minimize')}
        className="flex h-full w-[46px] items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
        title="Thu nhỏ"
        style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => callWindowControl('maximize')}
        className="flex h-full w-[46px] items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
        title="Phóng to"
        style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => callWindowControl('close')}
        className="flex h-full w-[46px] items-center justify-center text-zinc-400 hover:bg-[#e81123] hover:text-white transition-colors cursor-pointer"
        title="Đóng cửa sổ"
        style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
