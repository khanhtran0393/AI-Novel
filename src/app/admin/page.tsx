'use client';

/**
 * Minimal admin surface — status + paste admin key + list orders (when cloud on).
 * Full Supabase Auth UI can be layered later; seller can use admin key for API.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';

export default function AdminPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [adminKey, setAdminKey] = useState('');
  const [orders, setOrders] = useState<unknown[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(API.cloudStatus, { cache: 'no-store' });
      setStatus(await res.json());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const loadOrders = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(API.cloudOrders, {
        headers: {
          'x-ainovel-admin-key': adminKey.trim(),
        },
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        orders?: unknown[];
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOrders(data.orders || []);
      setMsg(data.message || `Loaded ${data.orders?.length ?? 0} orders`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmOrder = async (orderId: string) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(API.cloudOrdersConfirm, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ainovel-admin-key': adminKey.trim(),
        },
        body: JSON.stringify({ orderId, issueMode: 'token' }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        token?: string;
        activationCode?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(
        data.message +
          (data.token ? `\nToken: ${data.token.slice(0, 24)}…` : '') +
          (data.activationCode ? `\nCode: ${data.activationCode}` : ''),
      );
      await loadOrders();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sb = status?.supabase as
    | { configured?: boolean; adminConfigured?: boolean }
    | undefined;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-bold tracking-wide text-amber-400">
          AI Novel · Cloud Admin
        </h1>
        <p className="text-sm text-zinc-400">
          Quản lý đơn hàng Supabase + issue license. Secret chỉ trên server/Vercel.
        </p>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs space-y-1">
          <p>
            Supabase configured:{' '}
            <b className={sb?.configured ? 'text-emerald-400' : 'text-rose-400'}>
              {String(!!sb?.configured)}
            </b>
          </p>
          <p>
            Service role:{' '}
            <b className={sb?.adminConfigured ? 'text-emerald-400' : 'text-rose-400'}>
              {String(!!sb?.adminConfigured)}
            </b>
          </p>
          <p className="text-zinc-500">
            {(status?.hybrid as { note?: string } | undefined)?.note ||
              'Load /api/cloud/status'}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
          <label className="text-[10px] font-bold uppercase text-zinc-500">
            Admin key (AINOVEL_ENTITLEMENT_ADMIN_KEY)
          </label>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm font-mono"
            placeholder="admin key"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadOrders()}
              className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
            >
              Load orders
            </button>
            <button
              type="button"
              onClick={() => void loadStatus()}
              className="rounded-lg border border-zinc-600 px-3 py-2 text-xs font-bold text-zinc-300"
            >
              Refresh status
            </button>
          </div>
        </div>

        {msg ? (
          <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black/50 p-3 text-[11px] text-sky-200">
            {msg}
          </pre>
        ) : null}

        <div className="space-y-2">
          <h2 className="text-sm font-bold text-zinc-300">Orders</h2>
          {orders.length === 0 ? (
            <p className="text-xs text-zinc-500">Chưa có / chưa load.</p>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => {
                const row = o as {
                  id: string;
                  plan: string;
                  status: string;
                  hwid?: string;
                  amount_vnd?: number;
                  transfer_content?: string;
                };
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-amber-300">{row.id.slice(0, 8)}…</span>
                      <span
                        className={
                          row.status === 'pending'
                            ? 'text-amber-400'
                            : row.status === 'paid'
                              ? 'text-emerald-400'
                              : 'text-zinc-400'
                        }
                      >
                        {row.status} · {row.plan} · {row.amount_vnd?.toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                    <p className="mt-1 text-zinc-400">HWID: {row.hwid || '—'}</p>
                    <p className="text-emerald-500/90 font-mono">{row.transfer_content}</p>
                    {row.status === 'pending' ? (
                      <button
                        type="button"
                        disabled={busy || !adminKey}
                        onClick={() => void confirmOrder(row.id)}
                        className="mt-2 rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-black disabled:opacity-40"
                      >
                        Confirm + Issue token
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-[10px] text-zinc-600">
          SQL: <code>supabase/migrations/001_commercial_rls.sql</code> · Docs:{' '}
          <code>docs/SUPABASE_VERCEL_GUIDE.md</code>
        </p>
      </div>
    </div>
  );
}
