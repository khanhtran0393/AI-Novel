'use client';

/**
 * Toolbox layer (CÔNG CỤ) — menu + mount panel/modal.
 * Menu portals to body so header overflow never clips it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Briefcase, FlaskConical } from 'lucide-react';
import NavToolsPanel from './NavToolsPanel';
import { DownloadStudioPanel } from '../download';
import VideoEditorModal from './VideoEditorModal';
import AutoRenderModal from './AutoRenderModal';
import ProTranslateSRTModal from './ProTranslateSRTModal';
import {
  filterToolboxItems,
  writeShowLabsTools,
  type ToolKey,
} from './toolboxRegistry';
import FloatingMenu from '../../shared/FloatingMenu';

export default function ToolboxHost() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<ToolKey | null>(null);
  /** Default true so CÔNG CỤ always lists tools on first open */
  const [showLabs, setShowLabs] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Prefer stored preference; if never set, keep default true (show tools)
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('ainovel.showLabsTools');
      if (raw === '0') setShowLabs(false);
      else if (raw === '1') setShowLabs(true);
      else {
        // First visit: persist default ON so tools are usable immediately
        writeShowLabsTools(true);
        setShowLabs(true);
      }
    } catch {
      setShowLabs(true);
    }
  }, []);

  const items = filterToolboxItems(showLabs);

  const openTool = (key: ToolKey) => {
    setActive(key);
    setMenuOpen(false);
  };

  const close = () => setActive(null);

  const toggleLabs = () => {
    const next = !showLabs;
    setShowLabs(next);
    writeShowLabsTools(next);
  };

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
          className="flex shrink-0 whitespace-nowrap items-center justify-center gap-1 rounded-2xl border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
          title="Toolbox — Media / Crawler / Editor / Render / SRT"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">CÔNG CỤ</span>
        </button>

        <FloatingMenu
          open={menuOpen}
          anchorRef={triggerRef}
          onClose={() => setMenuOpen(false)}
          width="260px"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/98 p-2 shadow-2xl backdrop-blur-md"
        >
          <button
            type="button"
            onClick={toggleLabs}
            className="mb-1 w-full text-left rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-violet-300 hover:bg-violet-500/10 transition-colors cursor-pointer flex items-center gap-2 border border-violet-500/20"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {showLabs ? 'Ẩn Labs tools' : 'Hiện Labs tools'}
          </button>

          {!showLabs && (
            <p className="px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
              Core loop: Viết → TTS → Ảnh → Export. Bật Labs để mở Media Tools /
              Crawler / Editor / Render / SRT.
            </p>
          )}

          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => openTool(it.key)}
              className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
            >
              {it.labs ? (
                <span className="text-[9px] text-violet-400 font-mono">LABS</span>
              ) : null}
              {it.label}
            </button>
          ))}

          {showLabs && items.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-zinc-500">Không có tool.</p>
          ) : null}
        </FloatingMenu>
      </div>

      <NavToolsPanel isOpen={active === 'nav'} onClose={close} />
      <DownloadStudioPanel isOpen={active === 'crawler'} onClose={close} />
      <VideoEditorModal isOpen={active === 'video'} onClose={close} />
      <AutoRenderModal isOpen={active === 'render'} onClose={close} />
      <ProTranslateSRTModal isOpen={active === 'srt'} onClose={close} />
    </>
  );
}
