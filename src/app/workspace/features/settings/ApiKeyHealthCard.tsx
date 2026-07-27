'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Key } from 'lucide-react';
import type { KeyHealthStatus } from '@/lib/keyHealthTracker';

export default function ApiKeyHealthCard() {
  const store = useNovelStore();
  const allKeys = Array.from(
    new Set([store.apiKey, ...(store.apiKeys || [])].map((k) => (k || '').trim()).filter(Boolean)),
  );

  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<KeyHealthStatus[]>([]);

  const handleCheckHealth = async () => {
    if (allKeys.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/key-health/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: allKeys }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.keys)) {
        setStatuses(data.keys);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
            Bảng Giám sát Sức khỏe API Key ({allKeys.length} Keys)
          </h3>
        </div>
        <button
          type="button"
          disabled={loading || allKeys.length === 0}
          onClick={handleCheckHealth}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:bg-emerald-900/60 disabled:opacity-40"
        >
          {loading ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              Đang đo latency…
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              Đo sức khỏe Key
            </>
          )}
        </button>
      </div>

      {statuses.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {statuses.map((st, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <Key className="h-3.5 w-3.5 text-zinc-500" />
                <span className="font-mono text-zinc-300 font-semibold">{st.maskedKey}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-400">
                  {st.provider}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-zinc-400">{st.latencyMs}ms</span>
                {st.status === 'active' && (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active
                  </span>
                )}
                {st.status === 'rate_limited' && (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-bold" title={st.errorNote}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Rate Limited
                  </span>
                )}
                {st.status === 'invalid' && (
                  <span className="inline-flex items-center gap-1 text-red-400 font-bold" title={st.errorNote}>
                    <XCircle className="h-3.5 w-3.5" />
                    Invalid
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 italic">
          Bấm "Đo sức khỏe Key" để kiểm tra độ trễ (latency ms) và trạng thái quota của danh sách API Key.
        </p>
      )}
    </div>
  );
}
