'use client';

/**
 * After desktop update install: show what changed vs previous version.
 * Data from electron updater status.justUpdated (release-notes.json + feed).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Sparkles, X } from 'lucide-react';
import { toast } from '@/lib/toastBus';

type ChangelogBlock = {
  version: string;
  date?: string;
  title?: string;
  items: string[];
};

type JustUpdated = {
  fromVersion: string;
  toVersion: string;
  blocks?: ChangelogBlock[];
  items?: string[];
  releaseNotes?: string | null;
};

type UpdaterApi = {
  isElectron?: boolean;
  getStatus?: () => Promise<{
    justUpdated?: JustUpdated | null;
    appVersion?: string;
  }>;
  ackChangelog?: () => Promise<unknown>;
  onStatus?: (handler: (s: { justUpdated?: JustUpdated | null }) => void) => () => void;
};

function getUpdater(): UpdaterApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ainovelUpdater?: UpdaterApi }).ainovelUpdater || null;
}

export default function UpdateSuccessModal() {
  const [payload, setPayload] = useState<JustUpdated | null>(null);
  const [open, setOpen] = useState(false);

  const applyJust = useCallback((just: JustUpdated | null | undefined) => {
    if (!just?.toVersion || !just?.fromVersion) return;
    if (just.fromVersion === just.toVersion) return;
    const hasItems =
      (Array.isArray(just.items) && just.items.length > 0) ||
      (Array.isArray(just.blocks) && just.blocks.some((b) => b.items?.length));
    if (!hasItems) return;
    setPayload(just);
    setOpen(true);
  }, []);

  useEffect(() => {
    const api = getUpdater();
    if (!api?.isElectron) return;

    let cancelled = false;
    void (async () => {
      try {
        const st = await api.getStatus?.();
        if (cancelled) return;
        applyJust(st?.justUpdated);
      } catch {
        /* ignore */
      }
    })();

    const unsub = api.onStatus?.((s) => {
      if (s?.justUpdated) applyJust(s.justUpdated);
    });

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [applyJust]);

  const dismiss = useCallback(async () => {
    setOpen(false);
    try {
      await getUpdater()?.ackChangelog?.();
    } catch {
      /* ignore */
    }
    if (payload) {
      toast.success(
        'Đã cập nhật',
        `AI Novel ${payload.fromVersion} → ${payload.toVersion}`,
      );
    }
    setPayload(null);
  }, [payload]);

  if (!open || !payload) return null;

  const blocks =
    Array.isArray(payload.blocks) && payload.blocks.length > 0
      ? payload.blocks
      : [
          {
            version: payload.toVersion,
            title: 'Các mục đã cập nhật',
            items: payload.items || [],
          },
        ];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-success-title"
    >
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl border border-emerald-500/40 bg-zinc-950 shadow-2xl shadow-emerald-900/30">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-950/80 to-zinc-950 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2
                id="update-success-title"
                className="text-sm font-bold tracking-wide text-zinc-50"
              >
                Cập nhật thành công
              </h2>
              <p className="mt-0.5 text-xs text-emerald-300/90">
                {payload.fromVersion} →{' '}
                <span className="font-semibold text-emerald-200">
                  {payload.toVersion}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-zinc-400">
                Các mục đã thay đổi so với bản cũ:
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto px-5 py-4">
          {blocks.map((b) => (
            <div key={b.version + (b.title || '')} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <Sparkles className="h-3 w-3" />v{b.version}
                </span>
                {b.title ? (
                  <span className="text-xs font-semibold text-zinc-200">
                    {b.title}
                  </span>
                ) : null}
                {b.date ? (
                  <span className="text-[10px] text-zinc-500">{b.date}</span>
                ) : null}
              </div>
              <ul className="space-y-1.5 border-l-2 border-emerald-800/60 pl-3">
                {(b.items || []).map((line, i) => (
                  <li
                    key={`${b.version}-${i}`}
                    className="text-[12px] leading-snug text-zinc-300"
                  >
                    <span className="mr-1.5 text-emerald-500">•</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-950/90 px-5 py-3">
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black shadow-md hover:bg-emerald-400"
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
