'use client';

/**
 * Chrome Header — brand + PRO + channels + project actions + feature toolbars.
 * Selector-only: does not re-render on chapter/stream/media updates.
 */
import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectIsPro,
  selectIsVip,
  selectIsTrial,
  selectCredits,
} from '@/store/useNovelStoreSelectors';
import { useFolderActions } from '../hooks/useFolderActions';
import { Sparkles } from 'lucide-react';
import CapCutExportButton from '../features/project/CapCutExportButton';
import ChannelSwitcher from '../features/channels/ChannelSwitcher';
import JobQueuePanel from '../features/channels/JobQueuePanel';
import { ToolboxHost } from '../features/toolbox';
import MediaToolbarButton from '../features/media/MediaToolbarButton';
import TtsToolbarButton from '../features/tts/TtsToolbarButton';
import { SettingsPanel } from '../features/settings';
import { BrandLogoButton } from '../features/license';

export default function Header() {
  const isPro = useNovelStore(selectIsPro);
  const isVip = useNovelStore(selectIsVip);
  const isTrial = useNovelStore(selectIsTrial);
  const credits = useNovelStore(selectCredits);
  const { handleOpenFolder } = useFolderActions();

  return (
    <header
      className="app-header-bar relative z-50 flex w-full shrink-0 items-center justify-between gap-3 overflow-visible border-b border-zinc-800/70 bg-zinc-950 px-3 sm:px-4 lg:px-5"
      style={
        {
          height: 'var(--app-header-h)',
          WebkitAppRegion: 'no-drag',
          pointerEvents: 'auto',
        } as React.CSSProperties
      }
    >
      <div className="flex min-w-0 shrink-0 items-center gap-3 select-none overflow-visible">
        <BrandLogoButton />
        <div className="min-w-0">
          <h1 className="truncate text-[clamp(11px,1.35vw,14px)] font-bold tracking-wider text-zinc-100 uppercase">
            AI Novel & Script Generator
          </h1>
          <p className="text-[clamp(8px,0.95vw,10px)] font-semibold uppercase tracking-widest text-amber-500">
            Trợ Lý Biên Kịch
          </p>
        </div>
      </div>

      <div
        className="flex min-w-0 flex-1 items-center justify-end gap-[var(--app-gap)] overflow-visible"
        style={
          {
            WebkitAppRegion: 'no-drag',
            pointerEvents: 'auto',
          } as React.CSSProperties
        }
      >
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {isVip ? (
            <div
              className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-fuchsia-400 to-amber-400 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-black shadow-lg shadow-fuchsia-500/20"
              title="VIP"
            >
              <Sparkles className="h-3.5 w-3.5" />
              VIP
            </div>
          ) : isTrial ? (
            <div
              className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-500 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-black shadow-lg shadow-sky-500/20"
              title="Trial — quyền Pro tạm (chưa mua license)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              TRIAL
            </div>
          ) : isPro ? (
            <div
              className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-yellow-400 to-yellow-600 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-black shadow-lg shadow-yellow-500/20"
              title="Pro"
            >
              <Sparkles className="h-3.5 w-3.5" />
              PRO
            </div>
          ) : (
            <div
              className="flex items-center gap-1 rounded-2xl border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-semibold tracking-wider text-zinc-400"
              title="Free — nhấp logo «up to PRO» để mở Bản quyền"
            >
              <span>FREE</span>
              <span className="text-amber-500/90">💎 {credits}</span>
            </div>
          )}
        </div>

        <ChannelSwitcher />
        <JobQueuePanel />

        <button
          type="button"
          onClick={() => void handleOpenFolder('project')}
          className="flex shrink-0 whitespace-nowrap items-center gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all duration-300 cursor-pointer"
          title="Mở thư mục lưu dự án (output / public generated)"
        >
          📁 <span className="hidden lg:inline">Mở thư mục lưu</span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5 overflow-visible">
          <ToolboxHost />
          <MediaToolbarButton />
          <TtsToolbarButton />
          <CapCutExportButton />
        </div>

        <SettingsPanel />
      </div>
    </header>
  );
}
