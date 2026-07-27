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
import {
  Sparkles,
  ChevronDown,
  Folder,
  Image as ImageIcon,
  Video as VideoIcon,
  Mic,
  FileText,
  LayoutTemplate,
  Package,
} from 'lucide-react';
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

/** Channel & output folder button with dropdown menu */
function ChannelFolderButton() {
  const activeChannel = useNovelStore((state) => {
    const id = state.activeChannelId;
    return id ? state.channels?.[id] : null;
  });
  const { handleOpenFolder, handleOpenChannelFolder } = useFolderActions();
  const [open, setOpen] = useState(false);

  const channelName = activeChannel?.name || 'Kênh Chính';

  return (
    <div className="relative shrink-0 overflow-visible">
      <div className="flex items-center rounded-2xl border border-zinc-800 bg-zinc-900/60 transition-all duration-300 hover:border-zinc-700 hover:bg-zinc-800/80">
        <button
          type="button"
          onClick={() => void handleOpenFolder('output')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-zinc-200 hover:text-white cursor-pointer"
          title="Mở thư mục output tổng (chứa danh sách tất cả các thư mục kênh)"
        >
          📁 <span className="hidden lg:inline">Thư mục lưu</span>
          <span className="lg:hidden">Thư mục lưu</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="border-l border-zinc-800/80 px-1.5 py-1.5 text-zinc-400 hover:text-white cursor-pointer"
          title="Chọn mở cụ thể thư mục của Kênh hiện tại hoặc loại tài nguyên Ảnh, Video, Audio..."
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur-md">
            <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-900 mb-1 truncate">
              Kênh hiện tại: {channelName}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'images');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-emerald-400"
            >
              <ImageIcon className="h-3.5 w-3.5 text-emerald-400" />
              Thư mục Ảnh (images)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'video');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-cyan-400"
            >
              <VideoIcon className="h-3.5 w-3.5 text-cyan-400" />
              Thư mục Video (video)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'audio');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-amber-400"
            >
              <Mic className="h-3.5 w-3.5 text-amber-400" />
              Thư mục Giọng đọc (audio)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'scripts');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-indigo-400"
            >
              <FileText className="h-3.5 w-3.5 text-indigo-400" />
              Thư mục Kịch bản (scripts)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'thumbnails');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-pink-400"
            >
              <LayoutTemplate className="h-3.5 w-3.5 text-pink-400" />
              Thư mục Thumbnails (thumbnails)
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void handleOpenChannelFolder(channelName, 'ship_pack');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 hover:text-purple-400"
            >
              <Package className="h-3.5 w-3.5 text-purple-400" />
              Thư mục Ship Pack (CapCut)
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function Header() {
  const isPro = useNovelStore(selectIsPro);
  const isVip = useNovelStore(selectIsVip);
  const isTrial = useNovelStore(selectIsTrial);
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

        <ChannelFolderButton />

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
