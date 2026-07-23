'use client';

/**
 * Chrome Header — brand + PRO + channels + project actions + feature toolbars.
 * Selector-only: does not re-render on chapter/stream/media updates.
 */
import React, { useEffect, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectIsPro,
  selectIsVip,
  selectIsTrial,
} from '@/store/useNovelStoreSelectors';
import { APP_VERSION, formatAppVersionLabel } from '@/lib/appVersion';
import { SELLER_BANK } from '@/lib/commercial/pricingPlans';
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

const ZALO_SUPPORT_URL = SELLER_BANK.zaloSupportGroupUrl;

/** Zalo mark (simple brand glyph — blue circle + “Z”) */
function ZaloIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width="18"
      height="18"
      aria-hidden
      focusable="false"
    >
      <circle cx="16" cy="16" r="16" fill="#0068FF" />
      <path
        fill="#fff"
        d="M9.2 21.6h4.1l3.35-5.35c.22-.35.4-.66.55-.95h.04c-.05.42-.08.9-.08 1.45v4.85H20.8V10.4h-4.05l-3.4 5.45c-.2.32-.38.62-.52.9h-.04c.04-.4.06-.86.06-1.4V10.4H9.2v11.2z"
      />
    </svg>
  );
}

export default function Header() {
  const isPro = useNovelStore(selectIsPro);
  const isVip = useNovelStore(selectIsVip);
  const isTrial = useNovelStore(selectIsTrial);
  const { handleOpenFolder } = useFolderActions();
  const [appVersion, setAppVersion] = useState(APP_VERSION);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const api = (
          window as unknown as {
            ainovelUpdater?: {
              getStatus?: () => Promise<{ appVersion?: string }>;
            };
          }
        ).ainovelUpdater;
        const st = await api?.getStatus?.();
        const v = String(st?.appVersion || '').trim();
        if (!cancelled && v) setAppVersion(v);
      } catch {
        /* keep package.json fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <p className="flex min-w-0 items-baseline gap-1.5 text-[clamp(8px,0.95vw,10px)] font-semibold uppercase tracking-widest text-amber-500">
            <span className="truncate">Trợ Lý Biên Kịch</span>
            <span
              className="shrink-0 font-bold normal-case tracking-normal text-zinc-400"
              title={`Phiên bản ${formatAppVersionLabel(appVersion)}`}
            >
              {formatAppVersionLabel(appVersion)}
            </span>
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
        <div className="flex shrink-0 items-center gap-2">
          {/* Zalo support — left of plan badge; cả khối nhấp nháy rõ (icon + support) */}
          <a
            href={ZALO_SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ainovel-zalo-support-pulse group relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80"
            title="Nhóm Zalo hỗ trợ — bấm để mở"
            aria-label="Mở nhóm Zalo hỗ trợ"
          >
            <ZaloIcon className="h-[18px] w-[18px] drop-shadow-sm" />
            <span className="ainovel-zalo-support-label rounded-[3px] bg-gradient-to-r from-sky-300 to-blue-400 px-1 py-px text-[7px] font-black uppercase leading-none tracking-wide text-black ring-1 ring-sky-200/50">
              support
            </span>
          </a>

          <div className="hidden items-center sm:flex">
            {isTrial ? (
              <div
                className="flex items-center gap-1 rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-500 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-black shadow-lg shadow-sky-500/20"
                title="Trial — quyền Pro tạm (chưa mua license)"
              >
                <Sparkles className="h-3.5 w-3.5" />
                TRIAL
              </div>
            ) : isPro || isVip ? (
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
                title="Free — nhấp logo để mở Bản quyền / nâng cấp Pro"
              >
                <span>FREE</span>
              </div>
            )}
          </div>
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
