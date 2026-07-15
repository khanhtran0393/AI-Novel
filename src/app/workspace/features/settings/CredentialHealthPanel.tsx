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

export default function CredentialHealthPanel() {
  const store = useNovelStore();
  const [runtimeItems, setRuntimeItems] = useState<HealthItem[]>([]);
  const [runtimeScore, setRuntimeScore] = useState<string>('');
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

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

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

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
    </div>
  );
}
