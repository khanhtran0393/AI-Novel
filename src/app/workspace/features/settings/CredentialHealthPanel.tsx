'use client';

/**
 * Credential / engine health snapshot — Settings panel section.
 * Client credentials + optional runtime probes from /api/health/runtime.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  evaluateCredentialHealth,
  type HealthItem,
  type HealthLevel,
} from '@/lib/credentialHealth';
import { API } from '@/contracts';

function levelColor(level: HealthLevel): string {
  switch (level) {
    case 'ok':
      return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    case 'warn':
      return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
    case 'fail':
      return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
    default:
      return 'text-zinc-400 border-zinc-700 bg-zinc-900/40';
  }
}

function levelDot(level: HealthLevel): string {
  switch (level) {
    case 'ok':
      return 'bg-emerald-400';
    case 'warn':
      return 'bg-amber-400';
    case 'fail':
      return 'bg-rose-400';
    default:
      return 'bg-zinc-500';
  }
}

type QuotaKeyRow = {
  fp: string;
  available: boolean;
  rpmUsed: number;
  rpmLimit: number;
  rpmResetMs: number;
  rpdUsed: number;
  rpdLimit: number;
  rpdResetMs: number;
  nextReadyMs: number;
  cooling: boolean;
  coolReason?: string;
  coolUntilMs?: number;
};

function formatMs(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min}p`;
  return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}p` : ''}`;
}

export default function CredentialHealthPanel() {
  const store = useNovelStore();
  const [runtimeItems, setRuntimeItems] = useState<HealthItem[]>([]);
  const [runtimeScore, setRuntimeScore] = useState<string>('');
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [quotaRows, setQuotaRows] = useState<QuotaKeyRow[]>([]);
  const [quotaWait, setQuotaWait] = useState<string | null>(null);
  const [quotaMeta, setQuotaMeta] = useState({
    rpmLimit: 10,
    rpdLimit: 250,
    minIntervalMs: 6000,
    headroom: 0.85,
  });

  const health = useMemo(
    () =>
      evaluateCredentialHealth({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys,
        openaiApiKey: store.openaiApiKey,
        openaiApiKeys: store.openaiApiKeys,
        grokApiKey: store.grokApiKey,
        grokApiKeys: store.grokApiKeys,
        googleStudioCookie: store.googleStudioCookie,
        googleStudioCookies: store.googleStudioCookies,
        tiktokSessionIds: store.tiktokSessionIds,
        imageProvider: store.imageProvider,
        videoProvider: store.videoProvider,
        ttsConfig: store.ttsConfig,
        lumaApiKey: store.lumaApiKey,
        lumaApiKeys: store.lumaApiKeys,
      }),
    [
      store.apiKey,
      store.apiKeys,
      store.openaiApiKey,
      store.openaiApiKeys,
      store.grokApiKey,
      store.grokApiKeys,
      store.googleStudioCookie,
      store.googleStudioCookies,
      store.tiktokSessionIds,
      store.imageProvider,
      store.videoProvider,
      store.ttsConfig,
      store.lumaApiKey,
      store.lumaApiKeys,
    ],
  );

  const refreshRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const res = await fetch(API.healthRuntime, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        items?: HealthItem[];
        scoreLabel?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRuntimeItems(Array.isArray(data.items) ? data.items : []);
      setRuntimeScore(data.scoreLabel || '');
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
      setRuntimeItems([]);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const geminiKeys = useMemo(() => {
    const set = new Set<string>();
    if (store.apiKey) set.add(store.apiKey);
    for (const k of store.apiKeys || []) if (k) set.add(k);
    return [...set];
  }, [store.apiKey, store.apiKeys]);

  const refreshQuota = useCallback(async () => {
    if (geminiKeys.length === 0) {
      setQuotaRows([]);
      setQuotaWait(null);
      return;
    }
    try {
      const res = await fetch(API.keyQuota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: geminiKeys, register: true }),
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        keys?: QuotaKeyRow[];
        wait?: { message?: string } | null;
        rpmLimit?: number;
        rpdLimit?: number;
        minIntervalMs?: number;
        headroom?: number;
      };
      if (!res.ok) return;
      setQuotaRows(Array.isArray(data.keys) ? data.keys : []);
      setQuotaWait(data.wait?.message || null);
      setQuotaMeta((m) => ({
        ...m,
        rpmLimit: data.rpmLimit ?? m.rpmLimit,
        rpdLimit: data.rpdLimit ?? m.rpdLimit,
        minIntervalMs: data.minIntervalMs ?? m.minIntervalMs,
        headroom: data.headroom ?? m.headroom,
      }));
    } catch {
      /* server cold */
    }
  }, [geminiKeys]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    void refreshQuota();
    const t = setInterval(() => void refreshQuota(), 5000);
    return () => clearInterval(t);
  }, [refreshQuota]);

  const allItems = useMemo(
    () => [...health.items, ...runtimeItems],
    [health.items, runtimeItems],
  );

  return (
    <div className="mt-3 rounded-xl border border-zinc-800/80 bg-black/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
          Credential &amp; Runtime Health
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshRuntime()}
            disabled={runtimeLoading}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-400 hover:text-white cursor-pointer disabled:opacity-50"
          >
            {runtimeLoading ? '…' : 'Probe'}
          </button>
          <span className="text-[10px] font-mono text-zinc-500">
            {health.scoreLabel}
            {runtimeScore ? ` · ${runtimeScore}` : ''}
          </span>
        </div>
      </div>
      {runtimeError ? (
        <p className="mb-2 text-[10px] text-amber-400/90">
          Runtime probe: {runtimeError} (server chưa chạy?)
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {allItems.map((item) => (
          <li
            key={item.id}
            className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${levelColor(item.level)}`}
          >
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${levelDot(item.level)}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.label}</div>
              <div className="truncate opacity-80">{item.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
        Core loop: Key LLM + TTS platform + (Cookie nếu Whisk). Runtime: FFmpeg /
        public dirs / Edge package. Đỏ = chặn gen; vàng = có thể skip feature.
      </p>

      {/* Per-key RPM/RPD timers — hard gate before provider call */}
      <div className="mt-3 border-t border-zinc-800/80 pt-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h5 className="text-[10px] font-bold uppercase tracking-wider text-sky-400/90">
            Tránh chạm trần · RPM ≤{quotaMeta.rpmLimit}/phút · RPD ≤
            {quotaMeta.rpdLimit}/ngày · gap ≥
            {Math.ceil(quotaMeta.minIntervalMs / 1000)}s · headroom{' '}
            {Math.round(quotaMeta.headroom * 100)}%
          </h5>
          <button
            type="button"
            onClick={() => void refreshQuota()}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-400 hover:text-white cursor-pointer"
          >
            Sync
          </button>
        </div>
        {quotaWait ? (
          <p className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-200">
            ⏳ {quotaWait}
          </p>
        ) : null}
        {geminiKeys.length === 0 ? (
          <p className="text-[10px] text-zinc-600">
            Chưa có Gemini key — thêm key để bật bộ đếm.
          </p>
        ) : (
          <ul className="space-y-1">
            {quotaRows.map((row) => (
              <li
                key={row.fp}
                className={`rounded border px-2 py-1 font-mono text-[10px] ${
                  row.available
                    ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-300/90'
                    : 'border-rose-900/50 bg-rose-950/20 text-rose-300/90'
                }`}
              >
                <span className="font-bold">{row.fp}</span>
                {' · '}
                RPM {row.rpmUsed}/{row.rpmLimit}
                {row.rpmResetMs > 0 ? ` (chờ ${formatMs(row.rpmResetMs)})` : ''}
                {' · '}
                RPD {row.rpdUsed}/{row.rpdLimit}
                {!row.available && row.nextReadyMs > 0
                  ? ` · sẵn sàng sau ${formatMs(row.nextReadyMs)}`
                  : ''}
                {row.cooling
                  ? ` · cooldown ${row.coolReason || ''} ${formatMs(row.coolUntilMs || 0)}`
                  : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
