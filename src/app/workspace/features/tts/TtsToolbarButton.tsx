'use client';

import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import TTSConfigModal from './TTSConfigModal';

/** Nút TTS + modal — feature tts */
export default function TtsToolbarButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-1 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">TTS</span>
      </button>
      <TTSConfigModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
