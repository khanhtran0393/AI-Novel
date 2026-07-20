'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '@/contracts';
import {
  CheckCircle2,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';
import { useProAccess } from '../../hooks/useProAccess';

/**
 * Mọi trạng thái phiên (Bridge / Extension / Token / Project / Login)
 * sống trên TỪNG profile — không còn dải global.
 * Multi-account (profile 2+) cần Pro trả phí.
 */
type FlowAccount = {
  id: string;
  name: string;
  email?: string;
  status: string;
  flowKeyPresent: boolean;
  sessionVerified?: boolean;
  projectId?: string;
  /** Projects bound to this profile only (from Sync/create on its session) */
  projects?: { id: string; title?: string }[];
  tokenAgeMs?: number | null;
  lastError?: string | null;
  credits?: number | null;
  browserAlive?: boolean;
  bridgeRunning?: boolean;
  extensionConnected?: boolean;
  loginSessionOpen?: boolean;
  projectReady?: boolean;
  /** Chrome user-data-dir — cookies/cache/fingerprint of this Google account */
  profileDir?: string;
  sessionInheritedAt?: number | null;
  capabilities?: {
    canGenerateImage?: boolean;
    canGenerateVideo?: boolean;
    proxyParity?: boolean;
    credits?: number | null;
    projectCount?: number;
    browserCookies?: boolean;
  } | null;
};

type BridgeSnapshot = {
  running: boolean;
  wsPort: number;
  httpPort: number;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  projectId?: string | null;
  projects?: { id: string; title?: string }[];
  activeAccountId?: string | null;
  loginSessionOpen?: boolean;
  accounts: FlowAccount[];
  metrics?: {
    requestCount: number;
    successCount: number;
    failedCount: number;
    lastError?: string | null;
  };
};

type FlowProjectOpt = { id: string; title: string };

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
  accountId?: string;
  snapshot?: BridgeSnapshot;
};

const AUTO_KEY = 'ainovel_flow_auto_bootstrap_v1';
const ENGINE_KEY = 'ainovel_flow_browser_engine';

function statusDot(ok: boolean, warn = false) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        ok
          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
          : warn
            ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
            : 'bg-zinc-600'
      }`}
    />
  );
}

/** 5 đèn trạng thái — luôn gắn 1 profile */
function ProfileSessionLamps({
  a,
  bridgeUp,
}: {
  a: FlowAccount;
  bridgeUp: boolean;
}) {
  const bridge = a.bridgeRunning ?? bridgeUp;
  const ext = Boolean(a.extensionConnected);
  const token = Boolean(a.flowKeyPresent);
  const project = Boolean(a.projectReady || a.projectId);
  const login = Boolean(a.loginSessionOpen);

  const lamps: { label: string; ok: boolean; warn?: boolean; text?: string }[] =
    [
      { label: 'Bridge', ok: bridge },
      { label: 'Extension', ok: ext, warn: bridge && !ext && login },
      { label: 'Token', ok: token },
      { label: 'Project', ok: project },
      {
        label: login ? 'Login…' : 'Login off',
        ok: false,
        warn: login,
      },
    ];

  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
      {lamps.map((l) => (
        <div
          key={l.label}
          className="flex items-center gap-1 rounded border border-zinc-800/70 bg-black/40 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500"
          title={`${a.name}: ${l.label}`}
        >
          {statusDot(l.ok, l.warn)}
          <span className="truncate">{l.text || l.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function FlowAccountsPanel() {
  const { can, requirePro } = useProAccess();
  const multiFlowOk = can('flow_multi_account');
  const [snap, setSnap] = useState<BridgeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  /** Profile đang mở phiên login */
  const [loginTargetId, setLoginTargetId] = useState<string | null>(null);
  const [stepsByProfile, setStepsByProfile] = useState<
    Record<string, string[]>
  >({});
  const [name, setName] = useState('');
  const [engine, setEngine] = useState('auto');
  const [installHint, setInstallHint] = useState('');
  /** Per-profile project catalogs (Sync/select update only that card) */
  const [projectsByAccount, setProjectsByAccount] = useState<
    Record<string, FlowProjectOpt[]>
  >({});
  const [projectBusy, setProjectBusy] = useState<string | null>(null);
  const autoRan = useRef(false);
  const wasLoginOpen = useRef(false);
  const hadTokenByProfile = useRef<Record<string, boolean>>({});
  const refreshRef = useRef<() => Promise<BridgeSnapshot | null>>(async () => null);

  const mergeAccountProjects = useCallback(
    (accountId: string, list: FlowProjectOpt[]) => {
      if (!accountId) return;
      setProjectsByAccount((prev) => ({
        ...prev,
        [accountId]: list.filter((p) => p.id && !/^abc-?111$/i.test(p.id)),
      }));
    },
    [],
  );

  const refreshProjects = useCallback(
    async (accountId?: string) => {
      if (!accountId) return [];
      setProjectBusy(accountId);
      try {
        const res = await fetch(API.flowProjects, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync',
            accountId,
            refresh: true,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          projects?: { id?: string; title?: string }[];
          accountProjects?: { id?: string; title?: string }[];
          projectId?: string | null;
          error?: string;
          steps?: string[];
          snapshot?: BridgeSnapshot;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const raw = data.accountProjects?.length
          ? data.accountProjects
          : data.projects || [];
        const list = raw
          .map((p) => ({
            id: String(p.id || '').trim(),
            title: String(p.title || p.id || '').trim(),
          }))
          .filter((p) => p.id && !/^abc-?111$/i.test(p.id));
        mergeAccountProjects(accountId, list);
        if (data.snapshot) setSnap(data.snapshot);
        else await refreshRef.current();
        const stepHint = Array.isArray(data.steps)
          ? data.steps.join(' · ')
          : '';
        if (list.length) {
          toast.success(
            'Project sync',
            `${list.length} project · profile gắn ${data.projectId ? String(data.projectId).slice(0, 8) + '…' : 'chưa chọn'}`,
          );
        } else {
          toast.warn(
            'Project sync',
            stepHint ||
              'Chưa thấy project trên account — mở tab Flow trong browser profile rồi Sync lại, hoặc bấm + Tạo.',
          );
        }
        return list;
      } catch (e) {
        toast.error(
          'Project sync',
          e instanceof Error ? e.message : String(e),
        );
        return [];
      } finally {
        setProjectBusy(null);
      }
    },
    [mergeAccountProjects],
  );

  const selectProject = useCallback(
    async (accountId: string, projectId: string) => {
      if (!projectId) return;
      setProjectBusy(accountId);
      try {
        const res = await fetch(API.flowProjects, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            projectId,
            accountId,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          projects?: { id?: string; title?: string }[];
          accountProjects?: { id?: string; title?: string }[];
          snapshot?: BridgeSnapshot;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const raw = data.accountProjects?.length
          ? data.accountProjects
          : data.projects || [];
        if (raw.length) {
          mergeAccountProjects(
            accountId,
            raw.map((p) => ({
              id: String(p.id || '').trim(),
              title: String(p.title || p.id || '').trim(),
            })),
          );
        }
        toast.success('Project', 'Đã gắn project cho profile này');
        if (data.snapshot) setSnap(data.snapshot);
        else await refreshRef.current();
      } catch (e) {
        toast.error(
          'Project',
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setProjectBusy(null);
      }
    },
    [mergeAccountProjects],
  );

  const createProject = useCallback(
    async (accountId: string) => {
      setProjectBusy(accountId);
      try {
        const title = `AI Novel ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
        const res = await fetch(API.flowProjects, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            title,
            accountId,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          projectId?: string;
          projects?: { id?: string; title?: string }[];
          accountProjects?: { id?: string; title?: string }[];
          snapshot?: BridgeSnapshot;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const raw = data.accountProjects?.length
          ? data.accountProjects
          : data.projects || [];
        if (raw.length) {
          mergeAccountProjects(
            accountId,
            raw.map((p) => ({
              id: String(p.id || '').trim(),
              title: String(p.title || p.id || '').trim(),
            })),
          );
        }
        toast.success('Project', `Đã tạo: ${data.projectId || title}`);
        if (data.snapshot) setSnap(data.snapshot);
        else await refreshRef.current();
      } catch (e) {
        toast.error(
          'Tạo project',
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setProjectBusy(null);
      }
    },
    [mergeAccountProjects],
  );

  /**
   * Thừa hưởng full session browser → profile app:
   * cookies/cache/fingerprint (user-data-dir) + token + email + credits + projects.
   * Mọi gen sau đó = đúng account Google này.
   */
  const inheritSession = useCallback(async (accountId: string) => {
    if (!accountId) return;
    setProjectBusy(accountId);
    try {
      const res = await fetch(API.flowAccounts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inherit', accountId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        steps?: string[];
        account?: FlowAccount;
        browserSession?: {
          hasCookies?: boolean;
          hasCache?: boolean;
          profileDir?: string;
        };
        snapshot?: BridgeSnapshot;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.snapshot) setSnap(data.snapshot);
      else await refreshRef.current();
      if (data.account?.projects?.length) {
        mergeAccountProjects(
          accountId,
          data.account.projects.map((p) => ({
            id: String(p.id || '').trim(),
            title: String(p.title || p.id || '').trim(),
          })),
        );
      }
      toast.success(
        'Đã thừa hưởng account',
        [
          data.account?.email || 'session',
          data.account?.credits != null ? `${data.account.credits} cr` : null,
          data.account?.projects?.length
            ? `${data.account.projects.length} project`
            : null,
          data.browserSession?.hasCookies ? 'cookies OK' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    } catch (e) {
      toast.error(
        'Inherit session',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setProjectBusy(null);
    }
  }, [mergeAccountProjects]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API.flowStatus, { cache: 'no-store' });
      const data = (await res.json()) as BridgeSnapshot;
      setSnap(data);
      // Seed per-profile project catalogs from snapshot accounts
      const nextMap: Record<string, FlowProjectOpt[]> = {};
      for (const a of data.accounts || []) {
        const list = (a.projects || [])
          .map((p) => ({
            id: String(p.id || '').trim(),
            title: String(p.title || p.id || '').trim(),
          }))
          .filter((p) => p.id && !/^abc-?111$/i.test(p.id));
        if (list.length) nextMap[a.id] = list;
      }
      if (Object.keys(nextMap).length) {
        setProjectsByAccount((prev) => ({ ...prev, ...nextMap }));
      }

      const anyLogin = (data.accounts || []).some((a) => a.loginSessionOpen);
      if (anyLogin || data.loginSessionOpen) wasLoginOpen.current = true;

      for (const a of data.accounts || []) {
        if (
          wasLoginOpen.current &&
          !a.loginSessionOpen &&
          a.flowKeyPresent &&
          a.sessionVerified &&
          Boolean(a.email && a.email.includes('@')) &&
          !hadTokenByProfile.current[a.id]
        ) {
          hadTokenByProfile.current[a.id] = true;
          toast.success(
            'Đăng nhập xong',
            `${a.name || a.id}: token/cookie trên profile này — login đã đóng.`,
          );
        }
        if (a.flowKeyPresent) hadTokenByProfile.current[a.id] = true;
      }

      if (
        wasLoginOpen.current &&
        !anyLogin &&
        !data.loginSessionOpen &&
        !bootstrapping
      ) {
        setLoginTargetId(null);
      }

      return data;
    } catch (e) {
      console.warn('[FlowAccounts]', e);
      return null;
    }
  }, [bootstrapping]);

  refreshRef.current = refresh;

  const runBootstrap = useCallback(
    async (
      forceChrome = false,
      silent = false,
      accountId?: string | null,
      /** true = hồ sơ trình duyệt trống (thêm profile mới), không account cũ */
      freshSession = false,
    ) => {
      if (!accountId) {
        if (!silent) {
          toast.error(
            'Flow',
            'Chọn profile trên card rồi bấm Đăng nhập (1 profile = 1 phiên).',
          );
        }
        return null;
      }
      setBootstrapping(true);
      setLoginTargetId(accountId);
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
            accountId,
            freshSession,
            waitExtensionMs: 25000,
            waitLoginMs: forceChrome || freshSession ? 180000 : 25000,
          }),
        });
        const data = (await res.json()) as BootstrapResult;
        const boundId = data.accountId || accountId;
        setLoginTargetId(boundId);

        const stepHead = [
          freshSession
            ? `Profile ${boundId} — hồ sơ TRỐNG (trình duyệt mới, đăng nhập Google mới)`
            : `Profile ${boundId} — đăng nhập lại trên cùng user-data-dir`,
        ];
        setStepsByProfile((prev) => ({
          ...prev,
          [boundId]: [
            ...stepHead,
            ...(Array.isArray(data.steps) ? data.steps : []),
            ...(data.manualSteps || []),
          ],
        }));
        if (data.installHint) setInstallHint(data.installHint);
        if (data.snapshot) setSnap(data.snapshot);
        else await refresh();

        if (!silent) {
          if (data.flowKeyPresent) {
            toast.success(
              'Profile sẵn sàng',
              `${data.message || 'Token OK'} — đang thừa hưởng session browser…`,
            );
            // Force full inherit (token + email + credits + projects)
            void inheritSession(boundId);
          } else if (data.isStockChrome && !data.extensionConnected) {
            toast.warn(
              'Chrome chặn extension',
              'Cài Ungoogled Chromium portable → tools/browsers/ungoogled-chromium/.',
            );
          } else if (data.manualSteps?.length) {
            toast.info('Mullvad/Firefox', data.manualSteps[0] || data.message);
          } else if (data.chromeLaunched || data.loginRequired) {
            toast.info(
              freshSession ? 'Hồ sơ trình duyệt mới' : 'Đăng nhập Google',
              freshSession
                ? 'Đã mở browser trống. Đăng nhập Google account MỚI trên cửa sổ này (không phải account cũ).'
                : 'Browser của profile này đã mở. Đăng nhập trên cửa sổ app.',
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
    [refresh, engine, inheritSession],
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
        if (j.installHint) setInstallHint(String(j.installHint));
      })
      .catch(() => undefined);

    if (autoRan.current) return;
    autoRan.current = true;
    try {
      sessionStorage.setItem(AUTO_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }

    // 5s poll (was 2.5s) — getBridgeSnapshot + Chrome alive check is heavy on Windows.
    // Skip when tab hidden to avoid freezing background Electron UI.
    // Modal open only: 12s idle poll (was 5s) — login/session still refreshed on actions
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, 12_000);
    return () => clearInterval(t);
  }, [refresh]);

  /**
   * Thêm profile = tạo hồ sơ trình duyệt MỚI (trống) + mở phiên login account Google mới.
   * Không phải «đăng nhập lại» account cũ.
   */
  const addAccount = async (openBlankBrowser = true) => {
    const count = snap?.accounts?.length || 0;
    // Profile 2+ = multi-account (Pro only; Trial/Free: 1 profile)
    if (count >= 1 && !multiFlowOk) {
      const gate = requirePro('flow_multi_account');
      toast.info(
        'Pro',
        gate.message || 'Flow multi-account cần gói Pro trả phí.',
      );
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(API.flowAccounts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name:
            name.trim() ||
            `Trình duyệt ${(snap?.accounts?.length || 0) + 1}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tạo account thất bại');
      const newId = data.account?.id as string | undefined;
      const newName = data.account?.name || 'Profile';
      setName('');
      await refresh();
      toast.success(
        'Hồ sơ trình duyệt mới',
        newId
          ? `${newName}: session trống — đăng nhập Google account mới trên cửa sổ sắp mở`
          : 'Đã thêm profile',
      );
      if (openBlankBrowser && newId) {
        // freshSession=true → wipe cookies + browser trống (không account cũ)
        await runBootstrap(true, false, newId, true);
      }
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
      setStepsByProfile((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refresh();
    } catch (e) {
      toast.error('Flow', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onEngineChange = (v: string) => {
    setEngine(v);
    try {
      localStorage.setItem(ENGINE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const accounts = snap?.accounts || [];
  /** Ready = real Google email + token. Token alone (no email) is NOT "sẵn sàng". */
  const isAccountReady = (a: FlowAccount) =>
    Boolean(
      a.flowKeyPresent &&
        a.sessionVerified &&
        a.email &&
        String(a.email).includes('@'),
    );
  const readyCount = accounts.filter(isAccountReady).length;
  const bridgeUp = Boolean(snap?.running);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-300">
          <Zap className="h-4 w-4 text-amber-400" />
          Google Flow · Đăng nhập & gen
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-500">
            {readyCount}/{accounts.length || 0} profile sẵn sàng
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-white"
            title="Refresh status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">Thêm profile</strong> = mở{' '}
        <strong className="text-emerald-300">trình duyệt / hồ sơ trống</strong>{' '}
        để đăng nhập Google account <em>mới</em> — không phải đăng nhập lại
        account cũ. Mỗi card tự quản Bridge · Extension · Token · Project ·
        Login.
      </p>

      {/* Engine dùng chung khi launch browser — vẫn áp dụng theo từng profile lúc Đăng nhập */}
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
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên profile (tuỳ chọn)…"
          className="min-w-[140px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          disabled={loading || bootstrapping}
          onClick={() => void addAccount(true)}
          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1.5 text-[10px] font-bold uppercase text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-400 hover:to-violet-400 disabled:opacity-50"
          title="Tạo hồ sơ trình duyệt trống + mở cửa sổ đăng nhập Google account mới"
        >
          {loading || (bootstrapping && !loginTargetId) ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Thêm trình duyệt mới
        </button>
      </div>

      <div className="max-h-[28rem] space-y-2.5 overflow-y-auto pr-0.5">
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
            Chưa có hồ sơ. Bấm «Thêm trình duyệt mới» → mở browser trống → đăng
            nhập Google account mới (mỗi card = 1 phiên riêng).
          </div>
        ) : (
          accounts.map((a) => {
            const isThisLogin =
              loginTargetId === a.id &&
              (bootstrapping || Boolean(a.loginSessionOpen));
            // Strict: email + token + bridge. Never green from stale token alone.
            const ready = Boolean(bridgeUp && isAccountReady(a));
            const tokenOnly =
              Boolean(a.flowKeyPresent) &&
              !ready &&
              !(a.email && String(a.email).includes('@'));
            const extMissing =
              bridgeUp &&
              !a.extensionConnected &&
              !a.flowKeyPresent &&
              (isThisLogin || a.status === 'connecting');
            const waiting =
              isThisLogin ||
              (Boolean(a.loginSessionOpen) && !a.flowKeyPresent);
            const steps = stepsByProfile[a.id] || [];
            const statusLabel = isThisLogin
              ? 'đang login'
              : ready
                ? 'sẵn sàng'
                : tokenOnly
                  ? 'chưa login'
                  : a.status;

            return (
              <div
                key={a.id}
                className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 ${
                  isThisLogin
                    ? 'border-amber-500/50 bg-amber-950/15'
                    : ready
                      ? 'border-emerald-700/50 bg-emerald-950/10'
                      : tokenOnly
                        ? 'border-amber-800/40 bg-amber-950/10'
                        : 'border-zinc-800/80 bg-black/40'
                }`}
              >
                {/* Header profile */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-zinc-100">
                      {statusDot(ready, isThisLogin || tokenOnly)}
                      <span className="truncate">{a.name}</span>
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">
                        {statusLabel}
                      </span>
                      {typeof a.credits === 'number' ? (
                        <span className="text-[9px] font-normal text-amber-400/90">
                          {a.credits} cr
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-zinc-500">
                      {a.email || 'chưa đăng nhập Google'}
                      {a.projectId ? ` · project ${a.projectId}` : ' · no project'}
                      <span className="ml-1 font-mono text-zinc-700">
                        {a.id}
                      </span>
                    </div>
                    {a.sessionInheritedAt || a.capabilities?.proxyParity ? (
                      <div className="mt-0.5 text-[9px] text-emerald-400/90">
                        Account parity: app làm/nhận như Flow web
                        {a.capabilities?.canGenerateImage ? ' · ảnh' : ''}
                        {a.capabilities?.canGenerateVideo ? ' · video' : ''}
                        {a.capabilities?.browserCookies ? ' · cookies' : ''}
                        {a.capabilities?.projectCount
                          ? ` · ${a.capabilities.projectCount} project`
                          : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={bootstrapping || loading}
                      onClick={() =>
                        void runBootstrap(true, false, a.id, false)
                      }
                      className="flex items-center gap-1 rounded-lg border border-indigo-600/50 bg-indigo-950/60 px-2.5 py-1.5 text-[9px] font-bold uppercase text-indigo-100 hover:bg-indigo-900/60 disabled:opacity-50"
                      title={
                        ready
                          ? `Mở lại browser của ${a.name} (cùng hồ sơ cookies)`
                          : `Mở browser hồ sơ ${a.name} để đăng nhập`
                      }
                    >
                      {isThisLogin ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <LogIn className="h-3 w-3" />
                      )}
                      {ready ? 'Mở lại browser' : 'Đăng nhập'}
                    </button>
                    <button
                      type="button"
                      disabled={projectBusy === a.id || loading || !ready}
                      onClick={() => void inheritSession(a.id)}
                      className="rounded border border-sky-700/50 bg-sky-950/40 px-1.5 py-1.5 text-[9px] font-bold uppercase text-sky-200 hover:bg-sky-900/50 disabled:opacity-40"
                      title="Thừa hưởng full session browser (cookie/cache/token/project) vào profile app"
                    >
                      {projectBusy === a.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Inherit'
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void remove(a.id)}
                      className="rounded border border-zinc-800 p-1.5 text-zinc-500 hover:text-red-400"
                      title="Xóa profile"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* 5 trường trạng thái — thuộc profile này */}
                <ProfileSessionLamps a={a} bridgeUp={bridgeUp} />

                {/* Project dropdown — list + selection bound to THIS profile only */}
                {(() => {
                  const accProjects: FlowProjectOpt[] = (
                    projectsByAccount[a.id]?.length
                      ? projectsByAccount[a.id]
                      : (a.projects || []).map((p) => ({
                          id: String(p.id || '').trim(),
                          title: String(p.title || p.id || '').trim(),
                        }))
                  ).filter((p) => p.id && !/^abc-?111$/i.test(p.id));
                  const boundPid =
                    a.projectId && !/^abc-?111$/i.test(a.projectId)
                      ? a.projectId
                      : '';
                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-black/30 px-2 py-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wide text-sky-400/90">
                          Project
                        </span>
                        <select
                          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-200 outline-none focus:border-sky-500"
                          disabled={projectBusy === a.id || loading}
                          value={boundPid}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) void selectProject(a.id, v);
                          }}
                        >
                          <option value="">
                            {accProjects.length
                              ? '— Chọn project trong account —'
                              : '— Chưa có project (bấm Sync) —'}
                          </option>
                          {boundPid &&
                          !accProjects.some((p) => p.id === boundPid) ? (
                            <option value={boundPid}>
                              {boundPid.slice(0, 8)}… (đang gắn)
                            </option>
                          ) : null}
                          {accProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title || p.id.slice(0, 12)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={projectBusy === a.id || !ready}
                          onClick={() => void refreshProjects(a.id)}
                          className="rounded border border-zinc-700 px-1.5 py-1 text-[9px] font-bold uppercase text-zinc-400 hover:text-white disabled:opacity-40"
                          title="Đồng bộ danh sách project từ browser của profile này"
                        >
                          {projectBusy === a.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Sync'
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={projectBusy === a.id || !ready}
                          onClick={() => void createProject(a.id)}
                          className="rounded border border-emerald-700/50 bg-emerald-950/40 px-1.5 py-1 text-[9px] font-bold uppercase text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
                          title="Tạo project mới trên Google Flow (gắn profile này)"
                        >
                          + Tạo
                        </button>
                      </div>
                      {!boundPid ? (
                        <div className="rounded border border-amber-500/40 bg-amber-950/20 px-2 py-1 text-[9px] text-amber-200">
                          Profile chưa gắn project thật — bấm <b>Sync</b> (browser
                          Flow mở) hoặc <b>+ Tạo</b> trước khi gen.
                        </div>
                      ) : null}
                    </>
                  );
                })()}

                {/* Banner trạng thái trên đúng card */}
                {ready ? (
                  <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-2 py-1.5 text-[10px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Đã đăng nhập ({a.email}) · token OK · gen bằng profile này
                  </div>
                ) : tokenOnly ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-2 py-1.5 text-[10px] text-amber-100">
                    <div className="font-semibold">
                      Chưa đăng nhập Google — bấm Đăng nhập
                    </div>
                  </div>
                ) : extMissing ? (
                  <div className="rounded-lg border border-red-500/35 bg-red-950/20 px-2 py-1.5 text-[10px] text-red-200">
                    <div className="font-semibold">
                      Extension chưa nối trên profile này
                    </div>
                    <div className="mt-0.5 text-[9px] font-normal text-red-200/70">
                      {installHint ||
                        'Dùng Ungoogled/Brave. Engine Auto → bấm Đăng nhập lại trên card.'}
                    </div>
                    <button
                      type="button"
                      disabled={bootstrapping}
                      onClick={() => {
                        onEngineChange('auto');
                        void runBootstrap(true, false, a.id);
                      }}
                      className="mt-1.5 rounded bg-red-500/90 px-2 py-1 text-[9px] font-bold uppercase text-white hover:bg-red-400 disabled:opacity-50"
                    >
                      Sửa kết nối profile
                    </button>
                  </div>
                ) : waiting ? (
                  <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/35 bg-amber-950/20 px-2 py-1.5 text-[10px] text-amber-100">
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                    <div>
                      <div className="font-semibold">
                        {a.extensionConnected
                          ? 'Đang chờ token sau khi đăng nhập Google…'
                          : 'Browser hồ sơ này đã mở — đăng nhập Google (account mới nếu vừa «Thêm trình duyệt»)'}
                      </div>
                      <div className="mt-0.5 text-[9px] text-amber-200/70">
                        Cửa sổ trống / không sẵn account cũ. Cookies chỉ lưu
                        trong user-data-dir của card này.
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-500">
                    Chưa login. Bấm <strong className="text-zinc-300">Đăng nhập</strong>{' '}
                    trên card này, hoặc «Thêm trình duyệt mới» nếu cần account
                    Google khác.
                  </p>
                )}

                {steps.length > 0 ? (
                  <ul className="max-h-20 space-y-0.5 overflow-y-auto rounded border border-zinc-800/50 bg-black/30 px-2 py-1.5 text-[9px] text-zinc-500">
                    {steps.map((s, i) => (
                      <li key={i} className="flex gap-1">
                        <span className="text-indigo-500">›</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
