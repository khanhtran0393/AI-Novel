/**
 * Local Flow Bridge: WebSocket (extension) + HTTP (Next API / callbacks).
 * Singleton per Node process.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { FLOW_DEFAULTS, FLOW_HOST, FLOW_HTTP_PORT, FLOW_WS_PORT } from './config';
import {
  createAccount,
  deleteAccount,
  loadAccounts,
  saveAccounts,
  sanitizeAccountProjects,
  sanitizeUnverifiedAccounts,
  updateAccount,
  upsertAccountProject,
} from './accountStore';
import {
  getChromeSessionInfo,
  isProfileBrowserAlive,
  profileDirForAccount,
  reconcileLoginBrowserClosed,
} from './chromeSession';
import {
  getActiveProjectId,
  isPlausibleProjectId,
  loadProjects,
  setActiveProjectId,
  upsertProject,
  type FlowProject,
} from './projectStore';
import type {
  BridgeSnapshot,
  ExtApiResponse,
  FlowAccount,
  FlowAccountIdentity,
  FlowExecutionMode,
  FlowTask,
} from './types';
import { FlowQueueEngine } from './queueEngine';

type Pending = {
  resolve: (v: ExtApiResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeState = {
  httpServer: http.Server | null;
  wss: WebSocketServer | null;
  sockets: Map<string, WebSocket>;
  extSocket: WebSocket | null;
  /** Port already held by another Node in this machine (prior smoke/dev) */
  adoptedExternal: boolean;
  flowKey: string | null;
  /** Which profile owns the live Bearer (never paint onto other cards) */
  flowKeyAccountId: string | null;
  /** Per-profile Bearer map — gen MUST use the key of the assigned account */
  flowKeysByAccount: Map<string, string>;
  projectId: string | null;
  /** Profile that owns the current Chrome/extension session */
  activeAccountId: string | null;
  tokenCapturedAt: number | null;
  /** Epoch ms when a fresh blank login started (ignore older tokens) */
  loginEpochMs: number | null;
  tokenWatchdog: ReturnType<typeof setInterval> | null;
  loginSessionOpen: boolean;
  /** Live identity from parasitic browser (email/credits/projects) */
  identity: FlowAccountIdentity | null;
  /** Debounce full inherit after login/token */
  inheritTimers: Map<string, ReturnType<typeof setTimeout>>;
  metrics: {
    requestCount: number;
    successCount: number;
    failedCount: number;
    lastError: string | null;
  };
  pending: Map<string, Pending>;
  queue: FlowQueueEngine;
  callbackSecret: string;
  /**
   * Serialize api_request over extension WS (large uploadImage body).
   * Parallel gens otherwise race → Extension API timeout on shot 2/3.
   */
  extApiChain: Promise<unknown>;
};

const g = globalThis as unknown as { __ainovelFlowBridge?: BridgeState };

function state(): BridgeState {
  if (!g.__ainovelFlowBridge) {
    g.__ainovelFlowBridge = {
      httpServer: null,
      wss: null,
      sockets: new Map(),
      extSocket: null,
      adoptedExternal: false,
      flowKey: null,
      flowKeyAccountId: null,
      flowKeysByAccount: new Map(),
      projectId: null,
      activeAccountId: null,
      tokenCapturedAt: null,
      loginEpochMs: null,
      tokenWatchdog: null,
      loginSessionOpen: false,
      identity: null,
      inheritTimers: new Map(),
      metrics: {
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        lastError: null,
      },
      pending: new Map(),
      queue: new FlowQueueEngine(),
      callbackSecret: `ainovel_${Date.now().toString(36)}`,
      extApiChain: Promise.resolve(),
    };
  }
  // Hot-upgrade older process state (HMR / long-lived Node)
  const st = g.__ainovelFlowBridge;
  if (!st.flowKeysByAccount) st.flowKeysByAccount = new Map();
  if (!st.inheritTimers) st.inheritTimers = new Map();
  if (!st.extApiChain) st.extApiChain = Promise.resolve();
  return st;
}

function newMsgId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Bind Bearer to ONE profile. Never paint this key onto other accounts.
 * Also persists into SESSION_BUNDLE under accounts_data/<id>/.
 */
export function setAccountFlowKey(accountId: string, flowKey: string): void {
  const id = String(accountId || '').trim();
  const key = String(flowKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!id || key.length < 20) return;
  const s = state();
  s.flowKeysByAccount.set(id, key);
  s.flowKey = key;
  s.flowKeyAccountId = id;
  s.tokenCapturedAt = Date.now();
  try {
    const { writeSessionBundle } = require('./sessionInherit') as typeof import('./sessionInherit');
    writeSessionBundle(id, {
      flowKey: key,
      flowKeyPresent: true,
      tokenCapturedAt: s.tokenCapturedAt,
    });
  } catch {
    /* ignore */
  }
  updateAccount(id, {
    flowKeyPresent: true,
    status: 'active',
    sessionVerified: true,
  });
}

/** Resolve Bearer for a profile — never steal another account's key (B10). */
export function getAccountFlowKey(accountId?: string | null): string | null {
  const s = state();
  const aid = String(accountId || s.activeAccountId || '').trim();
  if (aid) {
    const fromMap = s.flowKeysByAccount.get(aid);
    if (fromMap && fromMap.length >= 20) return fromMap;
    if (s.flowKeyAccountId === aid && s.flowKey && s.flowKey.length >= 20) {
      return s.flowKey;
    }
    try {
      const { loadSessionBundle } = require('./sessionInherit') as typeof import('./sessionInherit');
      const b = loadSessionBundle(aid);
      if (b?.flowKey && String(b.flowKey).length >= 20) {
        s.flowKeysByAccount.set(aid, String(b.flowKey));
        return String(b.flowKey);
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return s.flowKey && s.flowKey.length >= 20 ? s.flowKey : null;
}

function sendWs(obj: unknown, accountId?: string): boolean {
  const s = state();
  const want = String(accountId || '').trim();
  let sock: WebSocket | null = null;
  if (want) {
    // Strict: only this profile's extension — never borrow another account socket
    const bound = s.sockets.get(want);
    if (bound && bound.readyState === 1) sock = bound;
    else return false;
  } else {
    sock = s.extSocket;
    if (!sock || sock.readyState !== 1) {
      for (const sck of s.sockets.values()) {
        if (sck.readyState === 1) {
          sock = sck;
          break;
        }
      }
    }
  }
  if (!sock || sock.readyState !== 1) return false;
  try {
    sock.send(JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

/** FlowAgent: refresh token when age > 45 minutes (expiry ~60m). */
function ensureTokenWatchdog(): void {
  const s = state();
  if (s.tokenWatchdog) return;
  s.tokenWatchdog = setInterval(() => {
    const st = state();
    if (!st.tokenCapturedAt || !st.extSocket) return;
    const age = Date.now() - st.tokenCapturedAt;
    if (age < FLOW_DEFAULTS.tokenRefreshMs) return;
    console.log(
      `[FlowBridge] Token age ${Math.round(age / 60000)}m ≥ 45m — refresh_flow_tab`,
    );
    sendWs({
      id: newMsgId(),
      method: 'refresh_flow_tab',
      params: {},
    });
  }, 60_000);
  // Don't keep process alive solely for watchdog
  if (typeof s.tokenWatchdog.unref === 'function') s.tokenWatchdog.unref();
}

export function isBridgeRunning(): boolean {
  const s = state();
  return Boolean(s.httpServer || s.adoptedExternal);
}

/** True when another process owns WS/HTTP (daemon) — use remote HTTP for gen. */
export function isAdoptedExternalBridge(): boolean {
  const s = state();
  return Boolean(s.adoptedExternal && !s.httpServer);
}

/**
 * Run one gen task on the process that owns the extension socket.
 * If we only adopted the port, proxy to daemon HTTP /api/generate-one.
 */
export async function runGenerateOne(body: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  resultPaths?: string[];
  mediaIds?: string[];
  task?: unknown;
}> {
  if (isAdoptedExternalBridge()) {
    const { remoteGenerateOne } = await import('./remoteBridge');
    return remoteGenerateOne(body);
  }
  return getQueue().runOne(body);
}

async function probeExistingBridge(): Promise<boolean> {
  try {
    const res = await fetch(`http://${FLOW_HOST}:${FLOW_HTTP_PORT}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { running?: boolean };
    return j.running !== false;
  } catch {
    return false;
  }
}

/** Restore active projectId from disk once per process. */
function hydrateProjectIdFromDisk(): void {
  const s = state();
  if (s.projectId) return;
  const active = getActiveProjectId();
  if (active) s.projectId = active;
}

/**
 * Detect closed login browser → stop "Đang login…" spin; mark profile idle.
 * Cheap when login not open.
 */
function reconcileLiveBrowserState(): void {
  const r = reconcileLoginBrowserClosed();
  if (r.closed && r.accountId) {
    const acc = loadAccounts().find((a) => a.id === r.accountId);
    if (acc && (acc.status === 'connecting' || !acc.sessionVerified)) {
      updateAccount(r.accountId, {
        status: acc.sessionVerified ? 'active' : 'idle',
        flowKeyPresent: Boolean(acc.flowKeyPresent) || Boolean(acc.sessionVerified && acc.email),
        lastError: acc.sessionVerified
          ? acc.lastError
          : 'Browser đã đóng — chưa hoàn tất đăng nhập',
      });
    }
    state().loginSessionOpen = false;
  }
}

export function getBridgeSnapshot(): BridgeSnapshot {
  const s = state();
  hydrateProjectIdFromDisk();
  reconcileLiveBrowserState();

  // NEVER paint global s.flowKey onto every account — that made Account 1 green without login.
  const chromeInfo = getChromeSessionInfo();
  const bridgeUp = isBridgeRunning();
  const anyExt =
    Array.from(s.sockets.values()).some((sck) => sck.readyState === 1) ||
    Boolean(s.extSocket && s.extSocket.readyState === 1);

  const accounts = loadAccounts().map((a) => {
    const perChrome = getChromeSessionInfo(a.id);
    const isBound =
      s.activeAccountId === a.id ||
      chromeInfo.accountId === a.id ||
      perChrome.accountId === a.id;

    // Extension socket bound to THIS accountId (or active bind while login)
    const sock = s.sockets.get(a.id);
    const sockLive = Boolean(sock && sock.readyState === 1);
    const extForProfile =
      sockLive ||
      (isBound && anyExt) ||
      (s.activeAccountId === a.id && anyExt);

    // Token: persisted on account OR live key owned by THIS account only
    // (cấm s.flowKey của profile A sơn xanh profile B)
    const liveToken =
      Boolean(a.flowKeyPresent) ||
      Boolean(s.flowKey && s.flowKeyAccountId === a.id);
    const verified =
      Boolean(a.sessionVerified && a.email) ||
      Boolean(liveToken && (a.sessionVerified || a.email || s.flowKeyAccountId === a.id));

    let browserAlive = Boolean(perChrome.profileBrowserAlive);
    if (!browserAlive && (a.status === 'connecting' || isBound || liveToken)) {
      browserAlive = isProfileBrowserAlive(profileDirForAccount(a.id));
    }

    const loginOpen = Boolean(
      (perChrome.loginOpen || (isBound && s.loginSessionOpen)) && browserAlive,
    );

    // Only real Flow project ids count as ready (reject abc-111 placeholders)
    const projectId = isPlausibleProjectId(a.projectId) ? String(a.projectId) : '';
    const projectReady = Boolean(projectId);
    // Per-profile token (map / bundle) — not global s.flowKey of another card
    const ownKey = Boolean(getAccountFlowKey(a.id));
    const tokenOk = liveToken || ownKey;

    let status = a.status;
    if (tokenOk && status !== 'cooldown' && status !== 'error') {
      status = 'active';
    } else if (status === 'connecting' && !loginOpen && !browserAlive) {
      status = 'idle';
    }

    return {
      ...a,
      status,
      flowKeyPresent: tokenOk,
      sessionVerified: verified || tokenOk,
      tokenAgeMs:
        (isBound || ownKey) && s.tokenCapturedAt
          ? Date.now() - s.tokenCapturedAt
          : a.tokenAgeMs,
      projectId,
      browserAlive,
      profileDir: a.profileDir || profileDirForAccount(a.id),
      // Per-profile management fields (UI card owns all of these)
      bridgeRunning: bridgeUp,
      extensionConnected: extForProfile,
      loginSessionOpen: loginOpen,
      projectReady,
    } as FlowAccount;
  });

  const projects = loadProjects();
  const bound =
    accounts.find((a) => a.id === s.activeAccountId) ||
    accounts.find((a) => a.sessionVerified) ||
    null;
  const identity: FlowAccountIdentity | null =
    s.identity?.email
      ? s.identity
      : bound?.email
        ? {
            email: bound.email || '',
            name: bound.displayName || bound.name || '',
            credits: bound.credits ?? null,
            paygateTier: bound.paygateTier ?? null,
            sessionExpires: bound.sessionExpires ?? null,
            lastSyncedAt: bound.lastSyncedAt ?? null,
            projectCount: (bound.projects || projects).length,
          }
        : null;

  const anyVerified = accounts.some((a) => a.sessionVerified);
  // Live Bearer only — never green from account.sessionVerified alone (NO_FLOW_KEY false positive)
  const liveKeyOk = Boolean(s.flowKey && String(s.flowKey).length >= 20) && anyVerified;

  return {
    running: isBridgeRunning(),
    wsPort: FLOW_WS_PORT,
    httpPort: FLOW_HTTP_PORT,
    extensionConnected: Array.from(s.sockets.values()).some((sck) => sck.readyState === 1) || Boolean(s.extSocket && s.extSocket.readyState === 1),
    flowKeyPresent: liveKeyOk,
    activeAccountId: s.activeAccountId,
    projectId: s.projectId,
    projects,
    identity,
    tokenAgeMs: s.tokenCapturedAt ? Date.now() - s.tokenCapturedAt : null,
    loginSessionOpen: Boolean(
      s.loginSessionOpen && chromeInfo.profileBrowserAlive,
    ),
    metrics: { ...s.metrics },
    accounts,
    queue: s.queue.snapshot(),
  };
}

/** Bind login/extension session to a profile (each profile = own Chrome user-data-dir). */
export function setActiveAccountId(accountId: string | null): void {
  const s = state();
  s.activeAccountId = accountId ? String(accountId) : null;
}

/**
 * Bắt đầu phiên login HỒ SƠ TRỐNG cho 1 profile.
 * Không gán token cũ của account khác cho profile mới.
 */
export function beginFreshProfileLogin(accountId: string): {
  accountId: string;
  loginEpochMs: number;
} {
  const s = state();
  const id = String(accountId || '').trim();
  s.activeAccountId = id || null;
  s.loginSessionOpen = true;
  s.loginEpochMs = Date.now();
  // Nếu live key đang thuộc profile khác — giữ nguyên để gen profile cũ không gãy,
  // nhưng không paint key đó lên profile mới (flowKeyAccountId khác id).
  // Nếu live key đang gán nhầm profile này (chưa login) → gỡ flag.
  if (s.flowKeyAccountId && s.flowKeyAccountId !== id) {
    /* keep s.flowKey for other profile */
  } else if (!s.flowKeyAccountId) {
    // Key mồ côi / chưa bind — không dùng cho profile mới
    s.flowKey = null;
    s.tokenCapturedAt = null;
  } else if (s.flowKeyAccountId === id) {
    // Re-login cùng profile: clear để bắt token mới sau khi user đăng nhập
    s.flowKey = null;
    s.flowKeyAccountId = null;
    s.tokenCapturedAt = null;
  }
  console.log(
    `[FlowBridge] Fresh login session account=${id} epoch=${s.loginEpochMs}`,
  );
  return { accountId: id, loginEpochMs: s.loginEpochMs };
}

/** True if current live token was captured for this account after loginEpoch. */
export function isFreshTokenForAccount(accountId: string): boolean {
  const s = state();
  const id = String(accountId || '').trim();
  if (!s.flowKey || !id) return false;
  if (s.flowKeyAccountId !== id) return false;
  if (s.loginEpochMs && s.tokenCapturedAt && s.tokenCapturedAt < s.loginEpochMs) {
    return false;
  }
  return true;
}

/** Apply identity payload from extension to ONE profile (not all). */
export function applyAccountIdentity(
  payload: Record<string, unknown>,
  accountIdHint?: string | null,
): void {
  const s = state();
  const email = String(payload.email || '').trim();
  const name = String(payload.name || '').trim();
  const credits =
    typeof payload.credits === 'number' ? payload.credits : null;
  const paygateTier = payload.paygateTier
    ? String(payload.paygateTier)
    : null;
  const sessionExpires = payload.sessionExpires
    ? String(payload.sessionExpires)
    : null;
  const syncedAt =
    typeof payload.syncedAt === 'number' ? payload.syncedAt : Date.now();

  const targetId =
    String(accountIdHint || payload.accountId || s.activeAccountId || '').trim() ||
    loadAccounts().find((a) => a.status === 'connecting')?.id ||
    loadAccounts()[0]?.id ||
    '';

  // Harvest projects → global catalog + THIS profile only
  const harvested: { id: string; title: string; source: 'capture' }[] = [];
  const projectsRaw = Array.isArray(payload.projects) ? payload.projects : [];
  for (const p of projectsRaw) {
    if (!p || typeof p !== 'object') continue;
    const row = p as Record<string, unknown>;
    const id = String(row.id || row.projectId || '').trim();
    if (!id || !isPlausibleProjectId(id)) continue;
    const title = String(row.title || row.projectTitle || id.slice(0, 8));
    try {
      upsertProject({ id, title, source: 'capture' });
      harvested.push({ id, title, source: 'capture' });
    } catch {
      /* ignore */
    }
  }

  // Only accept explicit real projectId from payload (never auto-steal first list item)
  const rawPid = String(payload.projectId || '').trim();
  const payloadProjectId =
    rawPid && isPlausibleProjectId(rawPid) ? rawPid : '';
  if (rawPid && !isPlausibleProjectId(rawPid)) {
    console.warn('[FlowBridge] skip fake projectId on identity:', rawPid);
  }

  if (payloadProjectId) {
    s.projectId = payloadProjectId;
    setActiveProjectId(payloadProjectId);
  }

  s.identity = {
    email,
    name,
    image: payload.image ? String(payload.image) : undefined,
    credits,
    paygateTier,
    sessionExpires,
    lastSyncedAt: syncedAt,
    projectCount: harvested.length || loadProjects().length,
  };

  const verified = Boolean(email && email.includes('@'));

  if (targetId) {
    const acc = loadAccounts().find((a) => a.id === targetId);
    const prevProjects = acc?.projects || [];
    // Merge harvested into this profile's project list (do not wipe manual/create)
    const byId = new Map<string, {
      id: string;
      title: string;
      source: 'create' | 'capture' | 'manual';
      createdAt: number;
      updatedAt: number;
    }>();
    const now = Date.now();
    for (const p of prevProjects) {
      if (p.id && isPlausibleProjectId(p.id)) {
        byId.set(p.id, {
          id: p.id,
          title: p.title || p.id.slice(0, 8),
          source: p.source || 'capture',
          createdAt: p.createdAt || now,
          updatedAt: p.updatedAt || now,
        });
      }
    }
    for (const p of harvested) {
      const prev = byId.get(p.id);
      byId.set(p.id, {
        id: p.id,
        title: p.title || prev?.title || p.id.slice(0, 8),
        source: prev?.source || 'capture',
        createdAt: prev?.createdAt || now,
        updatedAt: now,
      });
    }
    const mergedProjects = [...byId.values()];

    // Bind priority: explicit payload → keep previous real → first harvested
    const prevPid = String(acc?.projectId || '').trim();
    let nextProjectId = '';
    if (payloadProjectId) nextProjectId = payloadProjectId;
    else if (prevPid && isPlausibleProjectId(prevPid)) nextProjectId = prevPid;
    else if (mergedProjects[0]) nextProjectId = mergedProjects[0].id;
    // else: leave empty — UI shows Sync / Tạo (never re-write abc-111)

    if (nextProjectId && !s.projectId) {
      s.projectId = nextProjectId;
      setActiveProjectId(nextProjectId);
    }

    updateAccount(targetId, {
      email: email || acc?.email || '',
      displayName: name || acc?.displayName,
      name: name || email || acc?.name || 'Tài khoản',
      credits,
      paygateTier,
      sessionExpires,
      lastSyncedAt: syncedAt,
      sessionVerified: verified,
      flowKeyPresent:
        Boolean(s.flowKey) || Boolean(acc?.flowKeyPresent) || verified,
      status: verified ? 'active' : 'idle',
      projectId: nextProjectId,
      projects: mergedProjects,
      lastError: verified
        ? null
        : acc?.lastError || 'Session không có email',
    });
    s.activeAccountId = targetId;
  } else if (verified) {
    const acc = createAccount({
      name: name || email || 'Tài khoản Flow',
      email,
    });
    updateAccount(acc.id, {
      displayName: name,
      credits,
      paygateTier,
      sessionExpires,
      lastSyncedAt: syncedAt,
      sessionVerified: true,
      flowKeyPresent: Boolean(s.flowKey),
      status: 'active',
      projectId: payloadProjectId || harvested[0]?.id || '',
      projects: harvested.map((p) => ({
        id: p.id,
        title: p.title,
        source: 'capture' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      lastError: null,
    });
    s.activeAccountId = acc.id;
  }

  const finalPid =
    (targetId
      ? loadAccounts().find((a) => a.id === targetId)?.projectId
      : '') ||
    payloadProjectId ||
    '';
  console.log(
    `[FlowBridge] identity synced account=${s.activeAccountId || '—'} email=${email || '—'} credits=${credits ?? 'n/a'} projects=${harvested.length} projectId=${finalPid || '—'} verified=${verified}`,
  );
}

/**
 * Full inheritance after browser login:
 * browser user-data-dir (cookies/cache/fingerprint) stays on disk →
 * harvest token + email + credits + projects into app profile →
 * all gen for this profile uses THIS socket + token + project only.
 */
export async function inheritAccountSession(accountId: string): Promise<{
  ok: boolean;
  error?: string;
  steps: string[];
  accountId: string;
  identity?: FlowAccountIdentity | null;
  account?: FlowAccount | null;
  browserSession?: {
    hasCookies: boolean;
    hasLocalStorage: boolean;
    hasCache: boolean;
    profileDir: string;
  };
}> {
  const steps: string[] = [];
  const id = String(accountId || '').trim();
  if (!id) {
    return { ok: false, error: 'accountId required', steps, accountId: '' };
  }
  setActiveAccountId(id);

  const {
    profileDirForAccount,
    ensureAccountExtension,
    sourceExtensionDir,
    isProfileBrowserAlive,
    getSession,
    launchChrome,
  } = await import('./chromeSession');
  const {
    writeSessionBundle,
    profileHasBrowserSession,
    loadSessionBundle,
  } = await import('./sessionInherit');

  const profileDir = profileDirForAccount(id);
  const disk = profileHasBrowserSession(id);
  steps.push(
    `user-data-dir=${profileDir} cookies=${disk.hasCookies} ls=${disk.hasLocalStorage} cache=${disk.hasCache}`,
  );

  // Rehydrate durable token from previous inherit if live map empty
  let key = getAccountFlowKey(id);
  if (!key) {
    const b = loadSessionBundle(id);
    if (b?.flowKey && b.flowKey.length >= 20) {
      setAccountFlowKey(id, b.flowKey);
      key = b.flowKey;
      steps.push('Rehydrate Bearer từ SESSION_BUNDLE (disk)');
    }
  }

  // Harvest live session from browser of THIS profile
  try {
    await commandExtension('force_token_harvest', {}, 35_000, id);
    steps.push('force_token_harvest OK');
  } catch (e) {
    steps.push(
      `force_token_harvest: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  key = getAccountFlowKey(id) || key;
  if (key) {
    try {
      await commandExtension(
        'inject_flow_key',
        { flowKey: key, accessToken: key },
        15_000,
        id,
      );
      steps.push('inject_flow_key → extension profile');
    } catch {
      /* optional */
    }
  }

  const sync = await syncAccountIdentity(id);
  if (sync.steps?.length) steps.push(...sync.steps);
  if (!sync.ok) {
    steps.push(`sync_account: ${sync.error || 'failed'}`);
  } else {
    steps.push('sync_account OK — email/credits/projects bound to profile');
  }

  // Keep browser process on same user-data-dir so cookies/fingerprint stay live
  const acc = loadAccounts().find((a) => a.id === id);
  const sess = getSession(id);
  const browserExe = acc?.browserExe || sess?.chromePath || '';
  if (!isProfileBrowserAlive(profileDir) && browserExe) {
    try {
      const extDir =
        sess?.extDir ||
        ensureAccountExtension(id, sourceExtensionDir());
      launchChrome({
        chromePath: browserExe,
        extDir,
        profileDir,
        accountId: id,
        mode: 'background',
        forceClean: false,
        isStockChrome: /google[\\/]chrome/i.test(browserExe),
      });
      steps.push('Browser nền relaunch trên đúng profile (inherit cookies)');
    } catch (e) {
      steps.push(
        `relaunch: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (isProfileBrowserAlive(profileDir)) {
    steps.push('Browser còn sống — giữ nguyên cookies/cache/fingerprint');
  }

  key = getAccountFlowKey(id) || key;
  const accNow = loadAccounts().find((a) => a.id === id) || null;
  const finalKey = key || getAccountFlowKey(id);
  if (finalKey) setAccountFlowKey(id, finalKey);

  writeSessionBundle(id, {
    accountId: id,
    email: accNow?.email || '',
    name: accNow?.displayName || accNow?.name || '',
    credits: accNow?.credits ?? null,
    paygateTier: accNow?.paygateTier ?? null,
    projectId: accNow?.projectId || '',
    projects: (accNow?.projects || []).map((p) => ({
      id: p.id,
      title: p.title,
    })),
    profileDir,
    extensionDir: sess?.extDir || ensureAccountExtension(id, sourceExtensionDir()),
    flowKey: finalKey || null,
    flowKeyPresent: Boolean(finalKey),
    tokenCapturedAt: state().tokenCapturedAt,
    sessionExpires: accNow?.sessionExpires || null,
    browserExe: browserExe || undefined,
    inheritedAt: Date.now(),
  });

  const projectCount = accNow?.projects?.length || 0;
  const capabilities = {
    canGenerateImage: Boolean(finalKey || disk.hasCookies),
    canGenerateVideo: Boolean(finalKey || disk.hasCookies),
    canUpload: Boolean(finalKey),
    canListProjects: Boolean(finalKey || projectCount > 0),
    paygateTier: accNow?.paygateTier ?? null,
    credits: accNow?.credits ?? null,
    projectCount,
    flowKeyPresent: Boolean(finalKey),
    browserCookies: disk.hasCookies,
    /** App can invoke any Flow API as this account and receive full results */
    proxyParity: Boolean(finalKey || disk.hasCookies),
    updatedAt: Date.now(),
  };

  updateAccount(id, {
    status:
      finalKey || accNow?.sessionVerified || accNow?.email
        ? 'active'
        : accNow?.status || 'idle',
    flowKeyPresent: Boolean(finalKey || accNow?.flowKeyPresent),
    sessionVerified: Boolean(
      (accNow?.email && accNow.email.includes('@')) || finalKey,
    ),
    sessionInheritedAt: Date.now(),
    profileDir,
    browserExe: browserExe || accNow?.browserExe || '',
    capabilities,
    lastError:
      finalKey || accNow?.email
        ? null
        : accNow?.lastError || 'Chưa inherit được token/email — mở browser login',
  });

  const ready = Boolean(
    finalKey ||
      (accNow?.email && accNow.email.includes('@')) ||
      disk.hasCookies,
  );
  console.log(
    `[FlowBridge] inherit account=${id} email=${accNow?.email || '—'} key=${Boolean(finalKey)} projects=${accNow?.projects?.length || 0} ready=${ready}`,
  );

  return {
    ok: ready,
    error: ready
      ? undefined
      : sync.error || 'Browser chưa có session — đăng nhập Google trên profile này',
    steps,
    accountId: id,
    identity: state().identity,
    account: loadAccounts().find((a) => a.id === id) || null,
    browserSession: disk,
  };
}

/** Debounced full inherit after token/login — avoid spam while user logs in. */
export function scheduleInheritAccountSession(
  accountId: string,
  delayMs = 1200,
): void {
  const id = String(accountId || '').trim();
  if (!id) return;
  const s = state();
  const prev = s.inheritTimers.get(id);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    s.inheritTimers.delete(id);
    void inheritAccountSession(id).catch((e) =>
      console.warn(
        '[FlowBridge] inherit failed',
        id,
        e instanceof Error ? e.message : e,
      ),
    );
  }, delayMs);
  s.inheritTimers.set(id, t);
}

/**
 * Ask extension to harvest full account (session + credits + projects).
 * Binds result to the given profile (or active Chrome session profile).
 */
export async function syncAccountIdentity(accountId?: string): Promise<{
  ok: boolean;
  identity?: FlowAccountIdentity | null;
  projects?: ReturnType<typeof loadProjects>;
  accountId?: string | null;
  error?: string;
  steps?: string[];
}> {
  try {
    if (accountId) setActiveAccountId(accountId);
    // Daemon owns extension — proxy HTTP when Next only adopted ports
    if (isAdoptedExternalBridge()) {
      const { remoteSyncAccount } = await import('./remoteBridge');
      const remote = await remoteSyncAccount(
        accountId || state().activeAccountId || undefined,
      );
      if (!remote.ok) {
        return { ok: false, error: remote.error || 'remote sync failed' };
      }
      // Merge remote identity into local disk if returned
      if (remote.identity && typeof remote.identity === 'object') {
        applyAccountIdentity(
          remote.identity as Record<string, unknown>,
          accountId || state().activeAccountId,
        );
      }
      return {
        ok: true,
        identity: state().identity,
        projects: loadProjects(),
        accountId: state().activeAccountId,
        steps: Array.isArray((remote as { steps?: string[] }).steps)
          ? ((remote as { steps?: string[] }).steps as string[])
          : undefined,
      };
    }
    const res = await commandExtension(
      'sync_account',
      { accountId: accountId || state().activeAccountId || '' },
      90_000,
    );
    if (res.error) {
      return { ok: false, error: String(res.error) };
    }
    const result = (res.result || res.data || {}) as Record<string, unknown>;
    applyAccountIdentity(result, accountId || state().activeAccountId);
    return {
      ok: true,
      identity: state().identity,
      projects: loadProjects(),
      accountId: state().activeAccountId,
      steps: Array.isArray(result.steps)
        ? result.steps.map(String)
        : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Open the same project in the parasitic browser (app ↔ browser mirror). */
export async function openProjectInBrowser(projectId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const res = await commandExtension(
      'open_project',
      { projectId: String(projectId || '').trim() },
      30_000,
    );
    if (res.error) return { ok: false, error: String(res.error) };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Select Flow project for a profile (or active session profile). */
export function setProjectId(
  projectId: string,
  title?: string,
  accountId?: string,
): FlowProject {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('projectId required');
  if (!isPlausibleProjectId(id)) {
    throw new Error(
      `Project id giả/không hợp lệ: "${id}". Bấm Sync projects trên card profile hoặc tạo project mới.`,
    );
  }
  const s = state();
  s.projectId = id;
  setActiveProjectId(id);
  const row = upsertProject({
    id,
    title: title || undefined,
    source: 'manual',
  });
  const target =
    String(accountId || s.activeAccountId || '').trim() ||
    loadAccounts()[0]?.id ||
    '';
  if (target) {
    upsertAccountProject(target, {
      id,
      title: title || row.title,
      source: 'manual',
    });
    updateAccount(target, { projectId: id });
    s.activeAccountId = target;
  }
  // Mirror selection into parasitic browser (same as clicking project on Flow UI)
  void openProjectInBrowser(id).then((r) => {
    if (!r.ok) console.warn('[FlowBridge] open_project:', r.error);
  });
  return row;
}

/**
 * Create a new Google Flow project via extension tRPC
 * POST labs.google/fx/api/trpc/project.createProject
 */
export async function createFlowProject(
  title?: string,
  accountId?: string,
): Promise<{
  ok: boolean;
  project?: FlowProject;
  error?: string;
}> {
  const name =
    (title || '').trim() ||
    `AI Novel ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  if (accountId) setActiveAccountId(accountId);
  try {
    const res = await commandExtension(
      'trpc_request',
      {
        url: 'https://labs.google/fx/api/trpc/project.createProject',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { json: { projectTitle: name, toolName: 'PINHOLE' } },
      },
      60_000,
      accountId || state().activeAccountId || undefined,
    );
    if (res.error) {
      return { ok: false, error: String(res.error) };
    }
    const data = res.data as Record<string, unknown> | undefined;
    const result = data?.result as Record<string, unknown> | undefined;
    const dataWrap = result?.data as Record<string, unknown> | undefined;
    const json = dataWrap?.json as Record<string, unknown> | undefined;
    const inner = (json?.result || json) as Record<string, unknown> | undefined;
    const projectId = String(
      inner?.projectId ||
        (inner?.projectInfo as Record<string, unknown> | undefined)?.projectId ||
        '',
    ).trim();
    const projectInfo = inner?.projectInfo as Record<string, unknown> | undefined;
    const projectTitle = String(
      projectInfo?.projectTitle || name,
    ).trim();
    if (!projectId) {
      return {
        ok: false,
        error: `createProject response missing projectId: ${JSON.stringify(data).slice(0, 300)}`,
      };
    }
    const row = upsertProject({
      id: projectId,
      title: projectTitle,
      source: 'create',
    });
    setProjectId(projectId, projectTitle, accountId || state().activeAccountId || undefined);
    return { ok: true, project: row };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Async snapshot: pulls daemon status when adopted. */
export async function getBridgeSnapshotAsync(): Promise<BridgeSnapshot> {
  const local = getBridgeSnapshot();
  if (!isAdoptedExternalBridge()) return local;
  try {
    const { remoteStatus } = await import('./remoteBridge');
    const remote = await remoteStatus();
    if (remote) return { ...remote, running: true };
  } catch {
    /* fall through */
  }
  return local;
}

/** Called by chromeSession when login window opens/closes */
export function setLoginSessionOpen(open: boolean): void {
  state().loginSessionOpen = open;
}

export function handleExtMessage(raw: string, socketAccountId?: string): void {
  const s = state();
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === 'token_captured' && typeof msg.flowKey === 'string') {
    const chrome = (() => {
      try {
        return require('./chromeSession') as typeof import('./chromeSession');
      } catch {
        return null;
      }
    })();
    // Prefer socket accountId (per-profile extension) — never default to accounts[0]
    const bindId =
      socketAccountId && socketAccountId !== 'default'
        ? socketAccountId
        : s.activeAccountId ||
          chrome?.getChromeSessionInfo().accountId ||
          loadAccounts().find((a) => a.status === 'connecting')?.id ||
          null;
    const isNewToken =
      !bindId ||
      getAccountFlowKey(bindId) !== msg.flowKey ||
      s.flowKey !== msg.flowKey;
    s.flowKey = msg.flowKey;
    s.tokenCapturedAt = Date.now();
    if (bindId) {
      setAccountFlowKey(bindId, String(msg.flowKey));
    }
    if (isNewToken) {
      console.log(
        '[FlowBridge] Bearer token captured',
        String(msg.flowKey).slice(0, 16) + '…',
        `account=${bindId || '—'}`,
      );
    }
    ensureTokenWatchdog();
    void (async () => {
      try {
        const {
          closeLoginSessionAfterCapture,
          getChromeSessionInfo,
          getSession,
          isProfileBrowserAlive,
          launchChrome,
        } = await import('./chromeSession');
        if (bindId) {
          s.activeAccountId = bindId;
          const prev = loadAccounts().find((a) => a.id === bindId);
          const hasEmail = Boolean(prev?.email?.includes('@'));
          updateAccount(bindId, {
            status: 'active',
            flowKeyPresent: true,
            sessionVerified: true,
            projectId: prev?.projectId || s.projectId || '',
            profileDir: prev?.profileDir || undefined,
            lastError: hasEmail ? null : prev?.lastError || null,
          });
          // Full inherit: email/credits/projects + SESSION_BUNDLE
          scheduleInheritAccountSession(bindId, isNewToken ? 800 : 2500);
        }

        const activeSess = bindId ? getSession(bindId) : null;
        // CHỈ đóng khi CỬA SỔ LOGIN còn mở — không kill Chrome nền đã ổn định
        // (tránh vòng logout/login: close → relaunch → token_captured → close…)
        if (activeSess?.loginOpen || s.loginSessionOpen) {
          try {
            sendWs({
              id: newMsgId(),
              method: 'close_login_session',
              params: {},
            });
          } catch {
            /* ignore */
          }
          const r = await closeLoginSessionAfterCapture({
            delayMs: 600,
            accountId: bindId || undefined,
            keepBackground: true,
          });
          console.log('[FlowBridge] auto-close after token:', r.message);

          // Enrich identity once after first close (not on every re-broadcast)
          if (isNewToken) {
            const idr = await syncAccountIdentity(bindId || undefined);
            if (idr.ok) {
              console.log(
                '[FlowBridge] identity after token:',
                idr.identity?.email || 'no-email',
              );
            }
          }
        }

        // Chỉ spawn background nếu login vừa đóng và browser chết — không spam relaunch
        const sess = bindId ? getSession(bindId) : null;
        if (
          sess?.chromePath &&
          sess.profileDir &&
          sess.extDir &&
          !sess.loginOpen &&
          !isProfileBrowserAlive(sess.profileDir) &&
          isNewToken
        ) {
          launchChrome({
            chromePath: sess.chromePath,
            extDir: sess.extDir,
            profileDir: sess.profileDir,
            accountId: sess.accountId,
            mode: 'background',
            forceClean: false,
            isStockChrome: /google[\\/]chrome/i.test(sess.chromePath),
          });
        }
      } catch (e) {
        console.warn('[FlowBridge] token_captured handler failed', e);
      }
    })();
    return;
  }

  if (msg.type === 'account_identity') {
    const bind =
      socketAccountId && socketAccountId !== 'default'
        ? socketAccountId
        : s.activeAccountId;
    applyAccountIdentity(msg, bind);
    if (typeof msg.flowKey === 'string' && String(msg.flowKey).length > 20 && bind) {
      setAccountFlowKey(bind, String(msg.flowKey));
    }
    return;
  }

  // Lightweight poll from extension after labs.google tab load / Google login redirect
  if (msg.type === 'session_poll') {
    const email = String(msg.email || '').trim();
    const bindEarly =
      socketAccountId && socketAccountId !== 'default'
        ? socketAccountId
        : s.activeAccountId || null;
    if (typeof msg.flowKey === 'string' && msg.flowKey.length > 20) {
      if (bindEarly) setAccountFlowKey(bindEarly, String(msg.flowKey));
      else {
        s.flowKey = msg.flowKey;
        s.tokenCapturedAt = Date.now();
      }
    }
    const hasToken =
      Boolean(msg.flowKeyPresent) ||
      Boolean(bindEarly && getAccountFlowKey(bindEarly)) ||
      Boolean(s.flowKey);
    // Chỉ log khi trạng thái đổi — tránh spam CMD mỗi vài giây
    const pollKey = `${email}|${hasToken}|${msg.source || ''}|${bindEarly || ''}`;
    const gPoll = globalThis as unknown as { __ainovelLastSessionPoll?: string };
    if (gPoll.__ainovelLastSessionPoll !== pollKey) {
      gPoll.__ainovelLastSessionPoll = pollKey;
      console.log(
        `[FlowBridge] session_poll email=${email || '—'} token=${hasToken} src=${msg.source || '?'} account=${bindEarly || '—'}`,
      );
    }
    void (async () => {
      try {
        const bind =
          (socketAccountId && socketAccountId !== 'default'
            ? socketAccountId
            : null) ||
          s.activeAccountId ||
          (await import('./chromeSession')).getChromeSessionInfo().accountId ||
          loadAccounts().find((a) => a.status === 'connecting')?.id ||
          null;

        if (email && email.includes('@') && bind) {
          applyAccountIdentity(
            {
              email,
              name: msg.name || '',
              sessionExpires: msg.expires || null,
              syncedAt: Date.now(),
              credits: null,
              projects: [],
            },
            bind,
          );
          // First solid email → full inherit (projects/credits)
          scheduleInheritAccountSession(bind, 1000);
        } else if (hasToken && bind) {
          // Token without email — still mark active so UI/gen work
          updateAccount(bind, {
            status: 'active',
            flowKeyPresent: true,
            sessionVerified: true,
            lastError: 'Token OK (email session chưa đọc được)',
          });
        }

        // Chỉ đóng cửa sổ LOGIN — KHÔNG kill browser nền (profileBrowserAlive=true là OK)
        if (email || hasToken) {
          const { closeLoginSessionAfterCapture, getChromeSessionInfo } =
            await import('./chromeSession');
          const chrome = getChromeSessionInfo(bind);
          if (chrome.loginOpen || s.loginSessionOpen) {
            await closeLoginSessionAfterCapture({
              delayMs: 400,
              accountId: bind || undefined,
              keepBackground: true,
            });
            console.log('[FlowBridge] session_poll → closed login window only');
          }
          // Không sync_account lặp mỗi poll — chỉ 1 lần khi có email mới
          const acc = bind
            ? loadAccounts().find((a) => a.id === bind)
            : null;
          if (email && (!acc?.credits || !acc?.lastSyncedAt)) {
            await syncAccountIdentity(bind || undefined).catch(() => undefined);
          }
        }
      } catch (e) {
        console.warn('[FlowBridge] session_poll handle failed', e);
      }
    })();
    return;
  }

  if (msg.type === 'project_id_captured' && typeof msg.projectId === 'string') {
    const pid = String(msg.projectId).trim();
    if (!pid || !isPlausibleProjectId(pid)) {
      console.warn(
        '[FlowBridge] ignore non-plausible projectId capture:',
        pid || '(empty)',
      );
      return;
    }
    s.projectId = pid;
    setActiveProjectId(pid);
    const title =
      typeof msg.projectTitle === 'string' && msg.projectTitle.trim()
        ? String(msg.projectTitle).trim()
        : undefined;
    try {
      upsertProject({
        id: pid,
        title,
        source: 'capture',
      });
    } catch {
      /* ignore */
    }
    // Bind ONLY to the active/session profile — never paint every account
    const bindId =
      String(s.activeAccountId || '').trim() ||
      loadAccounts().find((a) => a.status === 'connecting')?.id ||
      '';
    if (bindId) {
      upsertAccountProject(bindId, {
        id: pid,
        title,
        source: 'capture',
      });
      updateAccount(bindId, { projectId: pid });
    }
    console.log(
      `[FlowBridge] projectId captured: ${pid} → account=${bindId || '—'}`,
    );
    return;
  }

  if (msg.type === 'extension_ready') {
    console.log('[FlowBridge] Extension ready', {
      flowKeyPresent: msg.flowKeyPresent,
      tokenAge: msg.tokenAge,
      socketAccountId: socketAccountId || null,
    });
    sendWs({ type: 'callback_secret', secret: s.callbackSecret });
    // Re-hydrate extension SW if bridge still holds Bearer but SW lost memory
    if (!msg.flowKeyPresent && s.flowKey) {
      const injectId = newMsgId();
      console.log(
        '[FlowBridge] extension_ready without key — inject live Bearer into SW',
      );
      sendWs(
        {
          id: injectId,
          method: 'inject_flow_key',
          params: { flowKey: s.flowKey, accessToken: s.flowKey },
        },
        socketAccountId,
      );
    }
    // Không auto force_token_harvest — gây reload/login loop. Chỉ harvest khi user Đăng nhập / Check.
    return;
  }

  if (msg.type === 'ping') {
    sendWs({ type: 'pong' });
    return;
  }

  if (msg.type === 'media_urls_refresh') {
    // reserved for future URL refresh
    return;
  }

  // Response with id (fallback via WS)
  if (typeof msg.id === 'string') {
    resolvePending(msg as unknown as ExtApiResponse);
  }
}

function resolvePending(msg: ExtApiResponse): void {
  const s = state();
  const p = s.pending.get(msg.id);
  if (!p) return;
  clearTimeout(p.timer);
  s.pending.delete(msg.id);
  p.resolve(msg);
}

export function requestViaExtension(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  captchaAction?: string;
  timeoutMs?: number;
  accountId?: string;
}): Promise<ExtApiResponse> {
  const s = state();
  // Serialize + min gap: large uploadImage + gen must not stampede extension SW
  const prev = s.extApiChain;
  let release!: () => void;
  s.extApiChain = new Promise<void>((r) => {
    release = r;
  });
  return (async () => {
    await prev.catch(() => undefined);
    try {
      // Anti-spam quiet window between api_request
      const gap = Number(FLOW_DEFAULTS.extensionMinGapMs) || 0;
      if (gap > 0) {
        await new Promise((r) => setTimeout(r, gap));
      }
      return await requestViaExtensionUnlocked(params);
    } finally {
      release();
    }
  })();
}

async function requestViaExtensionUnlocked(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  captchaAction?: string;
  timeoutMs?: number;
  accountId?: string;
}): Promise<ExtApiResponse> {
  const s = state();
  const aid = String(params.accountId || s.activeAccountId || '').trim();
  // Strict when accountId known: only that profile's extension socket
  let sock: WebSocket | null = aid ? s.sockets.get(aid) || null : null;
  if ((!sock || sock.readyState !== 1) && !aid) {
    sock = s.extSocket;
    if (!sock || sock.readyState !== 1) {
      for (const sck of s.sockets.values()) {
        if (sck.readyState === 1) {
          sock = sck;
          break;
        }
      }
    }
  }
  if (!sock || sock.readyState !== 1) {
    throw new Error(
      aid
        ? `Extension profile ${aid} chưa nối bridge. Mở browser của card profile đó (cùng user-data-dir).`
        : 'Extension chưa kết nối bridge. Load extension AI Novel Flow Bridge + mở labs.google/fx/tools/flow.',
    );
  }

  // Bearer of THIS profile only (B10 — no cross-account token)
  const flowKey = getAccountFlowKey(aid || null) || (!aid ? s.flowKey : null);
  if (!flowKey) {
    throw new Error(
      aid
        ? `Profile ${aid} chưa có Flow token. Đăng nhập Google trên browser profile này — app sẽ tự inherit session.`
        : 'Chưa có Flow token. Đăng nhập Google trên tab Flow và đợi extension capture Bearer.',
    );
  }

  const id = newMsgId();
  const timeoutMs = params.timeoutMs ?? 120_000;
  const headersOut: Record<string, string> = {
    ...(params.headers || {}),
  };
  if (!headersOut.authorization && !headersOut.Authorization) {
    headersOut.authorization = `Bearer ${flowKey}`;
  }

  return new Promise<ExtApiResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error('Extension API timeout'));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });

    const ok = sendWs(
      {
        id,
        method: 'api_request',
        params: {
          url: params.url,
          method: params.method || 'POST',
          headers: headersOut,
          body: params.body,
          captchaAction: params.captchaAction,
          flowKey,
          accessToken: flowKey,
        },
      },
      aid || undefined,
    );
    if (!ok) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(
        new Error(
          aid
            ? `Không gửi được tới extension của profile ${aid} (socket offline)`
            : 'Không gửi được message tới extension',
        ),
      );
    }
  });
}

export function commandExtension(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 60_000,
  accountId?: string,
): Promise<ExtApiResponse> {
  const s = state();
  // When Next only adopted the port, extension socket lives on daemon process
  if (isAdoptedExternalBridge()) {
    return (async () => {
      const { remoteCommand } = await import('./remoteBridge');
      return remoteCommand(method, params, timeoutMs);
    })();
  }
  const aid = String(accountId || '').trim();
  // Prefer per-account Bearer so command behaves as that Google account
  const accountKey = getAccountFlowKey(aid || s.activeAccountId);
  let outParams = { ...params };
  if (
    (method === 'inject_flow_key' ||
      method === 'download_binary' ||
      method === 'trpc_request' ||
      method === 'api_request') &&
    accountKey &&
    !outParams.flowKey &&
    !outParams.accessToken
  ) {
    outParams = {
      ...outParams,
      flowKey: accountKey,
      accessToken: accountKey,
    };
  } else if (
    method === 'inject_flow_key' &&
    s.flowKey &&
    !outParams.flowKey &&
    !outParams.accessToken
  ) {
    outParams = { ...outParams, flowKey: s.flowKey, accessToken: s.flowKey };
  }
  // Strict socket when accountId set — never run as another account
  let sock: WebSocket | null = aid ? s.sockets.get(aid) || null : null;
  if ((!sock || sock.readyState !== 1) && !aid) {
    sock = s.extSocket;
    if (!sock || sock.readyState !== 1) {
      for (const sck of s.sockets.values()) {
        if (sck.readyState === 1) {
          sock = sck;
          break;
        }
      }
    }
  }
  if (!sock || sock.readyState !== 1) {
    return Promise.reject(
      new Error(
        aid
          ? `Extension offline for profile ${aid}`
          : 'Extension offline',
      ),
    );
  }
  const id = newMsgId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`Extension ${method} timeout`));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });
    if (!sendWs({ id, method, params: outParams }, aid || undefined)) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(new Error('WS send failed'));
    }
  });
}

export function getProjectId(accountId?: string): string {
  hydrateProjectIdFromDisk();
  const s = state();
  const aid = String(accountId || s.activeAccountId || '').trim();
  if (aid) {
    const acc = loadAccounts().find((a) => a.id === aid);
    if (acc?.projectId && isPlausibleProjectId(acc.projectId)) {
      return String(acc.projectId);
    }
    // Prefer first real project on this profile catalog
    const fromList = (acc?.projects || []).find((p) =>
      isPlausibleProjectId(p.id),
    );
    if (fromList) return fromList.id;
    return '';
  }
  return isPlausibleProjectId(s.projectId) ? String(s.projectId) : '';
}

export function getQueue(): FlowQueueEngine {
  return state().queue;
}

export function getLiveAccounts(): FlowAccount[] {
  return getBridgeSnapshot().accounts;
}

async function readJson(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

let sanitizedOnce = false;

export async function ensureBridgeStarted(): Promise<BridgeSnapshot> {
  const s = state();
  if (!sanitizedOnce) {
    sanitizedOnce = true;
    try {
      const n = sanitizeUnverifiedAccounts();
      if (n > 0) {
        console.log(
          `[FlowBridge] sanitized ${n} unverified account(s) → idle (no email)`,
        );
      }
      const p = sanitizeAccountProjects();
      if (p > 0) {
        console.log(
          `[FlowBridge] cleared fake projectId on ${p} account(s)`,
        );
      }
      // Rehydrate per-account Bearers from SESSION_BUNDLE on disk
      const { loadSessionBundle } = await import('./sessionInherit');
      let rehydrated = 0;
      for (const a of loadAccounts()) {
        const b = loadSessionBundle(a.id);
        if (b?.flowKey && String(b.flowKey).length >= 20) {
          s.flowKeysByAccount.set(a.id, String(b.flowKey));
          rehydrated++;
          if (!s.flowKey) {
            s.flowKey = String(b.flowKey);
            s.flowKeyAccountId = a.id;
            s.tokenCapturedAt = b.tokenCapturedAt || Date.now();
          }
        }
      }
      if (rehydrated > 0) {
        console.log(
          `[FlowBridge] rehydrated ${rehydrated} account Bearer(s) from SESSION_BUNDLE`,
        );
      }
    } catch {
      /* ignore */
    }
  }
  // Local server already running in this process
  if (s.httpServer) return getBridgeSnapshot();

  // Adopted daemon — re-probe; if it died, clear flag and start local bridge
  if (s.adoptedExternal) {
    if (await probeExistingBridge()) {
      return getBridgeSnapshotAsync();
    }
    console.warn(
      '[FlowBridge] Adopted daemon gone — starting local bridge in this process',
    );
    s.adoptedExternal = false;
  }

  // If something already listens (previous process), adopt instead of failing
  if (await probeExistingBridge()) {
    s.adoptedExternal = true;
    console.warn(
      `[FlowBridge] Adopted existing bridge on :${FLOW_HTTP_PORT} (another process holds the port)`,
    );
    return getBridgeSnapshotAsync();
  }

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://${FLOW_HOST}:${FLOW_HTTP_PORT}`);
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }

        // Extension streams large media here (account cookies already applied)
        if (
          url.pathname === '/internal/receive-binary' &&
          req.method === 'POST'
        ) {
          const secret = String(req.headers['x-callback-secret'] || '');
          if (secret && secret !== s.callbackSecret) {
            // Allow empty secret on first connect race; reject wrong secret only
            if (s.callbackSecret && secret !== s.callbackSecret) {
              sendJson(res, 403, { error: 'bad secret' });
              return;
            }
          }
          const destHint = String(req.headers['x-dest-path'] || '').trim();
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const buf = Buffer.concat(chunks);
          if (buf.length < 64) {
            sendJson(res, 400, { error: 'empty body', bytes: buf.length });
            return;
          }
          let dest = destHint;
          if (!dest) {
            const dir = path.join(process.cwd(), 'public', 'video', '_sink');
            fs.mkdirSync(dir, { recursive: true });
            dest = path.join(dir, `recv_${Date.now()}.bin`);
          }
          try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, buf);
            console.log(
              `[FlowBridge] receive-binary ${buf.length}B → ${dest}`,
            );
            sendJson(res, 200, {
              ok: true,
              destPath: dest,
              bytes: buf.length,
            });
          } catch (e) {
            sendJson(res, 500, {
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        // Extension callback
        if (url.pathname === '/api/ext/callback' && req.method === 'POST') {
          const body = await readJson(req);
          if (body.type === 'sniffed_video_request') {
            // debug only — không log mỗi URL (spam CMD)
            if (process.env.FLOW_DEBUG_SNIFF === '1') {
              console.log('[FlowBridge] sniffed', body.url);
            }
            sendJson(res, 200, { ok: true });
            return;
          }
          if (typeof body.id === 'string') {
            resolvePending(body as unknown as ExtApiResponse);
            sendJson(res, 200, { ok: true });
            return;
          }
          handleExtMessage(JSON.stringify(body));
          sendJson(res, 200, { ok: true });
          return;
        }

        // Generic: do as this account, return full response (parity with Flow web)
        if (url.pathname === '/api/proxy-as-account' && req.method === 'POST') {
          try {
            const body = await readJson(req);
            const { proxyAsAccount } = await import('./accountProxy');
            const result = await proxyAsAccount({
              accountId: String(body.accountId || ''),
              url: String(body.url || ''),
              method: body.method ? String(body.method) : 'POST',
              headers: (body.headers || undefined) as
                | Record<string, string>
                | undefined,
              body: body.body,
              captchaAction: body.captchaAction
                ? String(body.captchaAction)
                : undefined,
              mode: body.mode === 'trpc' ? 'trpc' : 'api',
              timeoutMs:
                body.timeoutMs != null ? Number(body.timeoutMs) : undefined,
            });
            sendJson(res, result.ok ? 200 : 502, result);
          } catch (e) {
            sendJson(res, 500, {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (url.pathname === '/api/status' && req.method === 'GET') {
          sendJson(res, 200, getBridgeSnapshot());
          return;
        }

        if (url.pathname === '/api/accounts' && req.method === 'GET') {
          sendJson(res, 200, { accounts: getLiveAccounts() });
          return;
        }

        if (url.pathname === '/api/accounts' && req.method === 'POST') {
          const body = await readJson(req);
          const acc = createAccount({
            name: String(body.name || ''),
            email: body.email ? String(body.email) : '',
            engine: body.engine === 'mullvad' ? 'mullvad' : 'chromium',
            browserExe: body.browserExe ? String(body.browserExe) : '',
          });
          sendJson(res, 200, { account: acc });
          return;
        }

        if (url.pathname.startsWith('/api/accounts/') && req.method === 'DELETE') {
          const id = url.pathname.split('/').pop() || '';
          sendJson(res, 200, { ok: deleteAccount(id) });
          return;
        }

        if (url.pathname.startsWith('/api/accounts/') && url.pathname.endsWith('/patch') && req.method === 'POST') {
          const parts = url.pathname.split('/');
          const id = parts[3];
          const body = await readJson(req);
          sendJson(res, 200, { account: updateAccount(id, body as Partial<FlowAccount>) });
          return;
        }

        if (url.pathname === '/api/open-flow-tab' && req.method === 'POST') {
          try {
            await commandExtension('open_flow_tab', {});
            sendJson(res, 200, { ok: true });
          } catch (e) {
            sendJson(res, 503, {
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (url.pathname === '/api/refresh-token' && req.method === 'POST') {
          try {
            await commandExtension('refresh_flow_tab', {});
            sendJson(res, 200, { ok: true, flowKeyPresent: Boolean(s.flowKey) });
          } catch (e) {
            sendJson(res, 503, {
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        // Daemon RPC: Next (adopted) proxies extension commands here
        if (url.pathname === '/api/command' && req.method === 'POST') {
          try {
            const body = await readJson(req);
            const method = String(body.method || '');
            const params = (body.params || {}) as Record<string, unknown>;
            const timeoutMs =
              body.timeoutMs != null ? Number(body.timeoutMs) : 60_000;
            if (!method) {
              sendJson(res, 400, { error: 'method required' });
              return;
            }
            const result = await commandExtension(method, params, timeoutMs);
            sendJson(res, 200, { ok: !result.error, ...result });
          } catch (e) {
            sendJson(res, 503, {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (url.pathname === '/api/sync-account' && req.method === 'POST') {
          try {
            const body = await readJson(req);
            const accountId = body.accountId
              ? String(body.accountId)
              : undefined;
            const result = await syncAccountIdentity(accountId);
            sendJson(res, result.ok ? 200 : 502, {
              ...result,
              snapshot: getBridgeSnapshot(),
              flowKeyPresent: Boolean(state().flowKey),
            });
          } catch (e) {
            sendJson(res, 500, {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        // Accept token already in memory — mark account ready without re-login
        if (url.pathname === '/api/claim-session' && req.method === 'POST') {
          try {
            const body = await readJson(req);
            const accountId = String(
              body.accountId || state().activeAccountId || '',
            ).trim();
            if (!accountId) {
              sendJson(res, 400, { error: 'accountId required' });
              return;
            }
            if (!s.flowKey) {
              sendJson(res, 409, {
                ok: false,
                error: 'No token on bridge — open Flow tab / login first',
                snapshot: getBridgeSnapshot(),
              });
              return;
            }
            setActiveAccountId(accountId);
            updateAccount(accountId, {
              status: 'active',
              flowKeyPresent: true,
              sessionVerified: true,
              lastError: null,
              lastSyncedAt: Date.now(),
            });
            // Best-effort email/credits
            const sync = await syncAccountIdentity(accountId).catch((e) => ({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }));
            sendJson(res, 200, {
              ok: true,
              message: 'Session claimed from live bridge token',
              accountId,
              flowKeyPresent: true,
              sync,
              snapshot: getBridgeSnapshot(),
            });
          } catch (e) {
            sendJson(res, 500, {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (url.pathname === '/api/queue' && req.method === 'GET') {
          sendJson(res, 200, s.queue.snapshot());
          return;
        }

        if (url.pathname === '/api/queue' && req.method === 'POST') {
          const body = await readJson(req);
          const tasks = s.queue.enqueueMany(body);
          sendJson(res, 200, { tasks, queue: s.queue.snapshot() });
          return;
        }

        if (url.pathname === '/api/queue/start' && req.method === 'POST') {
          const body = (await readJson(req).catch(() => ({}))) as Record<
            string,
            unknown
          >;
          if (body.mode === 'parallel' || body.mode === 'sequential') {
            s.queue.setMode(body.mode as FlowExecutionMode);
          }
          s.queue.start();
          sendJson(res, 200, s.queue.snapshot());
          return;
        }

        if (url.pathname === '/api/queue/stop' && req.method === 'POST') {
          s.queue.stop();
          sendJson(res, 200, s.queue.snapshot());
          return;
        }

        if (url.pathname === '/api/queue/clear' && req.method === 'POST') {
          s.queue.clearPending();
          sendJson(res, 200, s.queue.snapshot());
          return;
        }

        if (url.pathname === '/api/generate-one' && req.method === 'POST') {
          const body = await readJson(req);
          const result = await s.queue.runOne(body);
          sendJson(res, result.ok ? 200 : 500, result);
          return;
        }

        sendJson(res, 404, { error: 'not_found' });
      } catch (e) {
        sendJson(res, 500, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(
          `[FlowBridge] HTTP ${FLOW_HTTP_PORT} busy — probing existing bridge…`,
        );
        void probeExistingBridge().then((ok) => {
          if (ok) {
            s.adoptedExternal = true;
            console.warn(`[FlowBridge] Adopted existing :${FLOW_HTTP_PORT}`);
          } else {
            // Still mark adopted so UI does not hard-fail; generate may need restart app
            s.adoptedExternal = true;
            console.warn(
              `[FlowBridge] Port busy but probe failed — mark running; restart app if gen fails`,
            );
          }
          resolve();
        });
        return;
      }
      reject(err);
    });

    server.listen(FLOW_HTTP_PORT, FLOW_HOST, () => {
      s.httpServer = server;
      const wss = new WebSocketServer({ port: FLOW_WS_PORT, host: FLOW_HOST });
      s.wss = wss;
      wss.on('connection', (socket, req) => {
        const url = new URL(req.url || '', `http://${FLOW_HOST}`);
        const accountId = url.searchParams.get('accountId') || 'default';
        console.log(`[FlowBridge] Extension connected accountId=${accountId}`);
        s.sockets.set(accountId, socket);
        s.extSocket = socket; // fallback
        // Bind active profile to this extension socket (1 profile = 1 login session)
        if (accountId && accountId !== 'default') {
          s.activeAccountId = accountId;
        }

        socket.send(JSON.stringify({ type: 'callback_secret', secret: s.callbackSecret }));

        socket.on('message', (data) => {
          // Pass accountId to handleExtMessage so it knows which account sent it
          handleExtMessage(String(data), accountId);
        });
        socket.on('close', () => {
          if (s.sockets.get(accountId) === socket) {
            s.sockets.delete(accountId);
          }
          if (s.extSocket === socket) s.extSocket = null;
          console.log(`[FlowBridge] Extension disconnected accountId=${accountId}`);
        });
      });
      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[FlowBridge] WS ${FLOW_WS_PORT} busy`);
        } else {
          console.error('[FlowBridge] WSS error', err);
        }
      });
      console.log(
        `[FlowBridge] listening HTTP :${FLOW_HTTP_PORT} WS :${FLOW_WS_PORT}`,
      );
      resolve();
    });
  });

  return getBridgeSnapshot();
}

export type { FlowTask };
