'use client';

/**
 * Toolbox layer (CÔNG CỤ) — menu + mount panel/modal.
 * Menu portals to body so header overflow never clips it.
 */
import React, { useRef, useState } from 'react';
import { Briefcase } from 'lucide-react';
import FlowAgentStudioModal from './FlowAgentStudioModal';
import BypassEngineModal from './BypassEngineModal';
import TtsBatchSrtModal from './TtsBatchSrtModal';
import {
  TOOLBOX_ITEMS,
  type ToolKey,
} from './toolboxRegistry';
import FloatingMenu from '../../shared/FloatingMenu';
import { useProAccess } from '../../hooks/useProAccess';
import { toast } from '@/lib/toastBus';

export default function ToolboxHost() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<ToolKey | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { can, requirePro } = useProAccess();
  const toolboxOk = can('toolbox_labs');

  const openTool = (key: ToolKey) => {
    const gate = requirePro('toolbox_labs');
    if (!gate.ok) {
      toast.info('Pro', gate.message);
      setMenuOpen(false);
      return;
    }
    setActive(key);
    setMenuOpen(false);
  };

  const close = () => setActive(null);

  return (
    <>
      <div className="relative shrink-0 overflow-visible">
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={`flex shrink-0 whitespace-nowrap items-center justify-center gap-1 rounded-2xl border px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
            toolboxOk
              ? 'border-sky-500/20 bg-sky-500/5 text-sky-400 hover:bg-sky-500/10'
              : 'border-zinc-700/60 bg-zinc-900/40 text-zinc-500 opacity-70'
          }`}
          title={
            toolboxOk
              ? 'Toolbox'
              : 'Toolbox cần Pro trả phí (Trial không đủ) — nhấp logo Bản quyền'
          }
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">CÔNG CỤ</span>
          {!toolboxOk ? (
            <span className="text-[8px] text-amber-600">PRO</span>
          ) : null}
        </button>

        <FloatingMenu
          open={menuOpen}
          anchorRef={triggerRef}
          onClose={() => setMenuOpen(false)}
          width="260px"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/98 p-2 shadow-2xl backdrop-blur-md"
        >
          {TOOLBOX_ITEMS.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => openTool(it.key)}
              className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
            >
              {it.label}
            </button>
          ))}

          {TOOLBOX_ITEMS.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-zinc-500">Không có tool.</p>
          ) : null}
        </FloatingMenu>
      </div>

      <FlowAgentStudioModal isOpen={active === 'batch'} onClose={close} />
      <BypassEngineModal isOpen={active === 'bypass_engine'} onClose={close} />
      <TtsBatchSrtModal isOpen={active === 'tts_batch_srt'} onClose={close} />
    </>
  );
}
