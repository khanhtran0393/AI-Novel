'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '@/contracts';
import {
  CheckCircle2,
  Loader2,
  LogIn,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';

type FlowAccount = {
  id: string;
  name: string;
  email?: string;
  status: string;
  flowKeyPresent: boolean;
  projectId?: string;
  tokenAgeMs?: number | null;
  lastError?: string | null;
};

type BridgeSnapshot = {
  running: boolean;
  wsPort: number;
  httpPort: number;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  projectId?: string | null;
  loginSessionOpen?: boolean;
  accounts: FlowAccount[];
  metrics?: {
    requestCount: number;
    successCount: number;
    failedCount: number;
    lastError?: string | null;
  };
};

type BootstrapResult = {
  ok: boolean;
  message: string;
  steps?: string[];
  extensionConnected?: boolean;
  flowKeyPresent?: boolean;
  chromeLaunched?: boolean;
  loginRequired?: boolean;
  isStockChrome?: boolean;
  browserLabel?: string;
  installHint?: string;
  manualSteps?: string[];
  snapshot?: BridgeSnapshot;
};

type BrowserItem = {
  engine: string;
  exe: string;
  label: string;
  isStockChrome?: boolean;
  family?: string;
  warning?: string;
};

const AUTO_KEY = 'ainovel_flow_auto_bootstrap_v1';
const ENGINE_KEY = 'ainovel_flow_browser_engine';

export default function FlowAccountsPanel() {
  const [snap, setSnap] = useState<BridgeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState('auto');
  const [browsers, setBrowsers] = useState<BrowserItem[]>([]);
  const [installHint, setInstallHint] = useState('');
  const autoRan = useRef(false);
  const wasLoginOpen = useRef(false);
  const hadToken = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API.flowStatus, { cache: 'no-store' });
      const data = (await res.json()) as BridgeSnapshot;
      setSnap(data);

      // Toast once when login window closed after token captured
      if (data.loginSessionOpen) wasLoginOpen.current = true;
      if (
        wasLoginOpen.current &&
        !data.loginSessionOpen &&
        data.flowKeyPresent &&
        !hadToken.current
      ) {
        hadToken.current = true;
        toast.success(
          'Đăng nhập xong',
          'Đã nhận token/cookie — cửa sổ đăng nhập đã đóng. Có thể gen ảnh/video.',
        );
      }
      if (data.flowKeyPresent) hadToken.current = true;

      return data;
    } catch (e) {
      console.warn('[FlowAccounts]', e);
      return null;
    }
  }, []);

  const runBootstrap = useCallback(
    async (forceChrome = false, silent = false) => {
      setBootstrapping(true);
      try {
        let eng = engine;
        try {
          eng = localStorage.getItem(ENGINE_KEY) || engine;
        } catch {
          /* ignore */
        }
        const res = await fetch(API.flowBootstrap, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            forceChrome,
            engine: eng,
            waitExtensionMs: 25000,
            waitLoginMs: forceChrome ? 120000 : 25000,
          }),
        });
        const data = (await res.json()) as BootstrapResult;
        setSteps(Array.isArray(data.steps) ? data.steps : []);
        if (data.installHint) setInstallHint(data.installHint);
        if (data.manualSteps?.length) {
          setSteps((prev) => [...prev, ...data.manualSteps!]);
        }
        if (data.snapshot) setSnap(data.snapshot);
        else await refresh();

        if (!silent) {
          if (data.flowKeyPresent) {
            toast.success('Flow sẵn sàng', data.message);
          } else if (data.isStockChrome && !data.extensionConnected) {
            toast.warn(
              'Chrome chặn extension',
              'Cài Ungoogled Chromium portable → tools/browsers/ungoogled-chromium/ (xem README).',
            );
          } else if (data.manualSteps?.length) {
            toast.info('Mullvad/Firefox', data.manualSteps[0] || data.message);
          } else if (data.chromeLaunched || data.loginRequired) {
            toast.info(
              'Đăng nhập Google',
              data.message ||
                'Browser đã mở. Đăng nhập xong hệ thống tự đóng cửa sổ.',
            );
          } else if (data.ok) {
            toast.info('Flow', data.message);
          } else {
            toast.error('Flow setup', data.message || 'Bootstrap thất bại');
          }
        }
        return data;
      } catch (e) {
        if (!silent) {
          toast.error(
            'Flow setup',
            e instanceof Error ? e.message : String(e),
          );
        }
        return null;
      } finally {
        setBootstrapping(false);
      }
    },
    [refresh, engine],
  );

  useEffect(() => {
    void refresh();
    try {
      const e = localStorage.getItem(ENGINE_KEY);
      if (e) setEngine(e);
    } catch {
      /* ignore */
    }
    void fetch(API.flowBrowsers, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.detected)) setBrowsers(j.detected);
        if (j.installHint) setInstallHint(String(j.installHint));
      })
      .catch(() => undefined);

    if (autoRan.current) return;
    autoRan.current = true;

    let cancelled = false;
    (async () => {
      const current = await refresh();
      if (cancelled) return;
      if (current?.flowKeyPresent && current?.extensionConnected) {
        setSteps(['Token + extension đã sẵn sàng — không mở đăng nhập.']);
        return;
      }
      try {
        const last = Number(sessionStorage.getItem(AUTO_KEY) || 0);
        if (Date.now() - last < 60_000 && current?.running) {
          setSteps([
            'Bridge đang chạy. Chọn engine (Ungoogled/Brave) rồi bấm Đăng nhập.',
          ]);
          return;
        }
        sessionStorage.setItem(AUTO_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      await runBootstrap(false, true);
    })();

    const t = setInterval(() => void refresh(), 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refresh, runBootstrap]);

  const addAccount = async () => {
    setLoading(true);
    try {
      const res = await fetch(API.flowAccounts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: name.trim() || `Account ${(snap?.accounts?.length || 0) + 1}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tạo account thất bại');
      setName('');
      await refresh();
      toast.success('Flow', `Đã thêm ${data.account?.name || 'account'}`);
    } catch (e) {
      toast.error('Flow', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    setLoading(true);
    try {
      await fetch(API.flowAccounts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      await refresh();
    } catch (e) {
      toast.error('Flow', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const statusDot = (ok: boolean, warn = false) => (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        ok
          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
          : warn
            ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
            : 'bg-zinc-600'
      }`}
    />
  );

  const allReady = Boolean(
    snap?.running && snap?.extensionConnected && snap?.flowKeyPresent,
  );
  const extMissing = Boolean(
    snap?.running && !snap?.extensionConnected && !snap?.flowKeyPresent,
  );
  const waitingLogin = Boolean(
    !allReady &&
      !extMissing &&
      (snap?.loginSessionOpen ||
        (!snap?.flowKeyPresent && bootstrapping) ||
        (!snap?.flowKeyPresent &&
          steps.some((s) => /đăng nhập|login|token/i.test(s)))),
  );

  const repairConnection = async () => {
    await runBootstrap(true, false);
  };

  const onEngineChange = (v: string) => {
    setEngine(v);
    try {
      localStorage.setItem(ENGINE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
          <Zap className="h-4 w-4 text-amber-400" />
          Google Flow · Đăng nhập & gen
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-white"
            title="Refresh status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={bootstrapping}
            onClick={() => void runBootstrap(true, false)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-400 hover:to-violet-400 disabled:opacity-50"
          >
            {bootstrapping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            {allReady ? 'Đăng nhập lại' : 'Đăng nhập Google'}
          </button>
        </div>
      </div>

      {allReady ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Đã có token — phiên login đã đóng. Gen ảnh/video (provider = flow).
        </div>
      ) : extMissing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-red-500/40 bg-red-950/25 px-3 py-2 text-xs font-semibold text-red-200">
          <div className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-red-400" />
            <div>
              <div>
                Extension chưa nối — Chrome Google thường chặn --load-extension.
              </div>
              <div className="mt-0.5 text-[10px] font-normal text-red-200/70 whitespace-pre-line">
                {installHint ||
                  'Chiến thuật FlowAgent: dùng Ungoogled Chromium / Brave (không CDP). Đặt portable tại tools/browsers/ungoogled-chromium/chrome.exe rồi chọn engine Auto/Ungoogled.'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={bootstrapping}
              onClick={() => {
                onEngineChange('auto');
                void repairConnection();
              }}
              className="rounded-lg bg-red-500/90 px-3 py-1.5 text-[10px] font-bold uppercase text-white hover:bg-red-400 disabled:opacity-50"
            >
              {bootstrapping ? 'Đang sửa…' : 'Sửa kết nối (Chromium sạch)'}
            </button>
          </div>
        </div>
      ) : waitingLogin ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-xs font-semibold text-amber-200">
          <div className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-400" />
            <div>
              <div>
                {snap?.extensionConnected
                  ? 'Extension đã nối — đang chờ token (reload tab Flow / đăng nhập)…'
                  : 'Đang chờ đăng nhập Google trên Chrome…'}
              </div>
              <div className="mt-0.5 text-[10px] font-normal text-amber-200/70">
                Token chỉ bắt được khi extension nối bridge. Khi có token, cửa sổ
                login tự đóng.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={bootstrapping}
            onClick={() => void repairConnection()}
            className="self-start rounded-lg border border-amber-500/50 px-3 py-1.5 text-[10px] font-bold uppercase text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
          >
            Vẫn xoay? Sửa kết nối
          </button>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Bấm <strong className="text-zinc-200">Đăng nhập Google</strong> →
          đăng nhập trên Chrome do app mở → hệ thống{' '}
          <strong className="text-emerald-300">tự đóng phiên</strong> sau khi
          bắt token.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:grid-cols-5">
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
          {statusDot(Boolean(snap?.running))} Bridge
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
          {statusDot(Boolean(snap?.extensionConnected))} Extension
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
          {statusDot(Boolean(snap?.flowKeyPresent))} Token
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
          {statusDot(Boolean(snap?.projectId))} Project
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
          {statusDot(false, Boolean(snap?.loginSessionOpen))}
          {snap?.loginSessionOpen ? 'Login…' : 'Login off'}
        </div>
      </div>

      {steps.length > 0 ? (
        <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800/60 bg-black/40 px-3 py-2 text-[10px] text-zinc-400">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-indigo-500">›</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 rounded-lg border border-zinc-800/60 bg-black/30 p-2 sm:grid-cols-[100px_1fr]">
        <span className="flex items-center text-[10px] font-bold uppercase text-zinc-500">
          Engine
        </span>
        <select
          value={engine}
          onChange={(e) => onEngineChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500"
        >
          <option value="auto">Auto (ưu tiên Ungoogled/Brave)</option>
          <option value="ungoogled">Ungoogled / Chromium sạch</option>
          <option value="brave">Brave</option>
          <option value="chrome">Google Chrome (hay bị chặn)</option>
          <option value="mullvad">Mullvad / Firefox (load tay)</option>
        </select>
        {browsers.length > 0 ? (
          <div className="sm:col-span-2 text-[9px] text-zinc-600">
            Detect:{' '}
            {browsers
              .slice(0, 4)
              .map((b) => b.label + (b.isStockChrome ? ' ⚠' : ''))
              .join(' · ')}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên profile thêm (tuỳ chọn)..."
          className="min-w-[140px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => void addAccount()}
          className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Thêm profile
        </button>
        <button
          type="button"
          disabled={bootstrapping}
          onClick={() => void runBootstrap(true, false)}
          className="flex items-center gap-1 rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-3 py-1.5 text-[10px] font-bold uppercase text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
        >
          <Plug className="h-3 w-3" />
          Mở Chrome login
        </button>
      </div>

      <div className="max-h-40 space-y-1.5 overflow-y-auto">
        {(snap?.accounts || []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-3 text-center text-[11px] text-zinc-600">
            Đang tự tạo profile mặc định khi bootstrap…
          </div>
        ) : (
          (snap?.accounts || []).map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-black/40 px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  {statusDot(a.flowKeyPresent || a.status === 'active')}
                  <span className="truncate">{a.name}</span>
                  <span className="text-[9px] uppercase text-zinc-500">
                    {a.status}
                  </span>
                </div>
                <div className="truncate text-[9px] text-zinc-600">
                  {a.projectId || snap?.projectId || 'no projectId'} ·{' '}
                  {a.email || '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                className="rounded border border-zinc-800 p-1 text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {snap?.metrics ? (
        <div className="text-[9px] text-zinc-600">
          Metrics: {snap.metrics.successCount}/{snap.metrics.requestCount} ok
          {snap.metrics.lastError ? ` · last: ${snap.metrics.lastError}` : ''}
        </div>
      ) : null}
    </div>
  );
}
