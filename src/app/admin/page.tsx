'use client';

/**
 * Seller admin — orders + licenses list/filter/revoke + quick issue.
 * Auth: paste AINOVEL_ENTITLEMENT_ADMIN_KEY (never ship in customer build).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '@/contracts';

type LicenseRow = {
  id: string;
  plan: string;
  status: string;
  hwid: string;
  exp_at: string;
  created_at?: string;
  revoked_at?: string | null;
  activation_code?: string | null;
};

type OrderRow = {
  id: string;
  plan: string;
  status: string;
  hwid?: string;
  amount_vnd?: number;
  transfer_content?: string;
};

function adminHeaders(adminKey: string, json = false): HeadersInit {
  const h: Record<string, string> = {
    'x-ainovel-admin-key': adminKey.trim(),
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function statusColor(status: string) {
  if (status === 'active' || status === 'paid') return 'text-emerald-400';
  if (status === 'pending') return 'text-amber-400';
  if (status === 'revoked' || status === 'rejected') return 'text-rose-400';
  if (status === 'expired') return 'text-zinc-500';
  return 'text-zinc-400';
}

export default function AdminPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [adminKey, setAdminKey] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [licenseTotal, setLicenseTotal] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [hwidQuery, setHwidQuery] = useState('');

  const [issueHwid, setIssueHwid] = useState('');
  const [issuePlan, setIssuePlan] = useState<'month' | 'year' | 'lifetime'>(
    'lifetime',
  );
  const [lastToken, setLastToken] = useState('');

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
    try {
      const saved = sessionStorage.getItem('ainovel.adminKey') || '';
      if (saved) setAdminKey(saved);
    } catch {
      /* ignore */
    }
  }, [loadStatus]);

  const persistKey = (key: string) => {
    setAdminKey(key);
    try {
      if (key.trim()) sessionStorage.setItem('ainovel.adminKey', key.trim());
      else sessionStorage.removeItem('ainovel.adminKey');
    } catch {
      /* ignore */
    }
  };

  const loadOrders = async () => {
    if (!adminKey.trim()) {
      setMsg('Dán Admin key trước.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(API.cloudOrders, {
        headers: adminHeaders(adminKey),
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        orders?: OrderRow[];
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOrders((data.orders || []) as OrderRow[]);
      setMsg(data.message || `Orders: ${data.orders?.length ?? 0}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadLicenses = async () => {
    if (!adminKey.trim()) {
      setMsg('Dán Admin key trước.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const qs = new URLSearchParams({
        plan: planFilter,
        status: statusFilter,
        limit: '100',
      });
      if (hwidQuery.trim().length >= 3) qs.set('q', hwidQuery.trim());
      const res = await fetch(`${API.cloudLicenseList}?${qs}`, {
        headers: adminHeaders(adminKey),
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        licenses?: LicenseRow[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLicenses(data.licenses || []);
      setLicenseTotal(data.total ?? data.licenses?.length ?? 0);
      setMsg(`Licenses: ${data.licenses?.length ?? 0} (total match ~${data.total ?? 0})`);
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
        headers: adminHeaders(adminKey, true),
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
      if (data.token) setLastToken(data.token);
      setMsg(
        (data.message || 'OK') +
          (data.token ? `\nToken: ${data.token}` : '') +
          (data.activationCode ? `\nCode: ${data.activationCode}` : ''),
      );
      await loadOrders();
      await loadLicenses();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revokeLicense = async (licenseId: string, hwid: string) => {
    if (
      !window.confirm(
        `Revoke license ${shortId(licenseId)}?\nHWID: ${hwid}\nMáy khách sẽ về Free sau heartbeat.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(API.cloudLicenseRevoke, {
        method: 'POST',
        headers: adminHeaders(adminKey, true),
        body: JSON.stringify({ licenseId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(data.message || 'Đã revoke.');
      await loadLicenses();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const issueLicense = async () => {
    const hwid = issueHwid.trim().toUpperCase();
    if (hwid.length < 8) {
      setMsg('HWID tối thiểu 8 ký tự.');
      return;
    }
    if (!adminKey.trim()) {
      setMsg('Dán Admin key trước.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(API.cloudLicenseIssue, {
        method: 'POST',
        headers: adminHeaders(adminKey, true),
        body: JSON.stringify({
          planId: issuePlan,
          hwid,
          issueMode: 'token',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        token?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.token) {
        setLastToken(data.token);
        setMsg(`Đã cấp ${issuePlan} cho ${hwid}\n\n${data.token}`);
      } else {
        setMsg(data.message || 'Issue OK (không có token trong response)');
      }
      await loadLicenses();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Đã copy clipboard.');
    } catch {
      setMsg('Copy thất bại — chọn text thủ công.');
    }
  };

  const sb = status?.supabase as
    | { configured?: boolean; adminConfigured?: boolean }
    | undefined;

  const activeProCount = useMemo(
    () =>
      licenses.filter((l) => l.status === 'active' && l.plan === 'pro').length,
    [licenses],
  );
  const activeTrialCount = useMemo(
    () =>
      licenses.filter((l) => l.status === 'active' && l.plan === 'trial').length,
    [licenses],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-1">
          <h1 className="text-xl font-bold tracking-wide text-amber-400">
            AI Novel · Seller Admin
          </h1>
          <p className="text-sm text-zinc-400">
            Orders · Licenses (HWID) · Issue · Revoke. Chỉ dùng trên máy seller /
            Vercel deploy — không đưa admin key vào app khách.
          </p>
        </header>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs space-y-1">
          <p>
            Supabase:{' '}
            <b className={sb?.configured ? 'text-emerald-400' : 'text-rose-400'}>
              {String(!!sb?.configured)}
            </b>
            {' · '}
            Service role:{' '}
            <b
              className={
                sb?.adminConfigured ? 'text-emerald-400' : 'text-rose-400'
              }
            >
              {String(!!sb?.adminConfigured)}
            </b>
          </p>
          <p className="text-zinc-500">
            {(status?.hybrid as { note?: string } | undefined)?.note ||
              'Load /api/cloud/status'}
          </p>
          <p className="text-zinc-500">
            Bảng hiện tại: Pro active ~{activeProCount} · Trial active ~
            {activeTrialCount} · rows loaded {licenses.length}/{licenseTotal}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
          <label className="text-[10px] font-bold uppercase text-zinc-500">
            Admin key (AINOVEL_ENTITLEMENT_ADMIN_KEY)
          </label>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => persistKey(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm font-mono"
            placeholder="dán admin key"
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadLicenses()}
              className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
            >
              Load licenses
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadOrders()}
              className="rounded-lg border border-amber-600/50 px-3 py-2 text-xs font-bold text-amber-200 disabled:opacity-50"
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

        {/* Quick issue */}
        <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4 space-y-2">
          <h2 className="text-sm font-bold text-emerald-300">
            Cấp key nhanh (HWID)
          </h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] uppercase text-zinc-500">HWID</label>
              <input
                value={issueHwid}
                onChange={(e) => setIssueHwid(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm font-mono"
                placeholder="A531378E7A74E609"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500">Gói</label>
              <select
                value={issuePlan}
                onChange={(e) =>
                  setIssuePlan(e.target.value as 'month' | 'year' | 'lifetime')
                }
                className="block rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
              >
                <option value="month">01 tháng</option>
                <option value="year">01 năm</option>
                <option value="lifetime">Trọn đời</option>
              </select>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void issueLicense()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-50"
            >
              Issue Pro token
            </button>
          </div>
          {lastToken ? (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">
                Token gần nhất (copy gửi khách — phải bắt đầu AINOVEL2.):
              </p>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-black/60 p-2 text-[10px] text-emerald-200">
                {lastToken}
              </pre>
              <button
                type="button"
                onClick={() => void copyText(lastToken)}
                className="rounded border border-zinc-600 px-2 py-1 text-[10px] font-bold text-zinc-300"
              >
                Copy token
              </button>
            </div>
          ) : null}
        </section>

        {msg ? (
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-black/50 p-3 text-[11px] text-sky-200 max-h-48 overflow-auto">
            {msg}
          </pre>
        ) : null}

        {/* License filters */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-sm font-bold text-zinc-300">Licenses (HWID)</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="rounded border border-zinc-700 bg-black px-2 py-1"
              >
                <option value="all">Plan: all</option>
                <option value="pro">pro</option>
                <option value="trial">trial</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-zinc-700 bg-black px-2 py-1"
              >
                <option value="all">Status: all</option>
                <option value="active">active</option>
                <option value="revoked">revoked</option>
                <option value="expired">expired</option>
              </select>
              <input
                value={hwidQuery}
                onChange={(e) => setHwidQuery(e.target.value)}
                placeholder="Tìm HWID (≥3)"
                className="rounded border border-zinc-700 bg-black px-2 py-1 font-mono w-36"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadLicenses()}
                className="rounded bg-zinc-700 px-2 py-1 font-bold disabled:opacity-50"
              >
                Lọc
              </button>
            </div>
          </div>

          {licenses.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Chưa load hoặc không có bản ghi. Bấm «Load licenses».
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-zinc-900 text-zinc-500 uppercase">
                  <tr>
                    <th className="px-2 py-2">HWID</th>
                    <th className="px-2 py-2">Plan</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Exp</th>
                    <th className="px-2 py-2">Id</th>
                    <th className="px-2 py-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-zinc-800/80 hover:bg-zinc-900/50"
                    >
                      <td className="px-2 py-2 font-mono text-amber-200">
                        {row.hwid?.toUpperCase()}
                      </td>
                      <td className="px-2 py-2">{row.plan}</td>
                      <td className={`px-2 py-2 font-bold ${statusColor(row.status)}`}>
                        {row.status}
                      </td>
                      <td className="px-2 py-2 text-zinc-400">
                        {row.exp_at
                          ? new Date(row.exp_at).toISOString().slice(0, 10)
                          : '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-zinc-500">
                        {shortId(row.id)}
                      </td>
                      <td className="px-2 py-2">
                        {row.status === 'active' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void revokeLicense(row.id, row.hwid)}
                            className="rounded bg-rose-700/80 px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-40"
                          >
                            Revoke
                          </button>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Orders */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-zinc-300">Orders</h2>
          {orders.length === 0 ? (
            <p className="text-xs text-zinc-500">Chưa có / chưa load.</p>
          ) : (
            <ul className="space-y-2">
              {orders.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-amber-300">
                      {shortId(row.id)}
                    </span>
                    <span className={statusColor(row.status)}>
                      {row.status} · {row.plan} ·{' '}
                      {row.amount_vnd?.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  <p className="mt-1 text-zinc-400">
                    HWID: {row.hwid?.toUpperCase() || '—'}
                  </p>
                  <p className="text-emerald-500/90 font-mono">
                    {row.transfer_content}
                  </p>
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
              ))}
            </ul>
          )}
        </section>

        <footer className="text-[10px] text-zinc-600 space-y-1 border-t border-zinc-900 pt-3">
          <p>
            Ops: <code>docs/COMMERCIAL_ADMIN.md</code> · SQL:{' '}
            <code>supabase/migrations/001_commercial_rls.sql</code>
          </p>
          <p>
            Telegram cấp key vẫn là luồng bán chính. Admin dùng để tra HWID /
            revoke / cấp bù.
          </p>
        </footer>
      </div>
    </div>
  );
}
