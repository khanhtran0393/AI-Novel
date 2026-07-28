/**
 * Local Flow Bridge: WebSocket (extension) + HTTP (Next API / callbacks).
 * Singleton per Node process.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
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
import {
  getOrCreateSessionToken,
  validateWsConnection,
  validateHttpRequest,
  isAllowedProxyUrl as secIsAllowedProxyUrl,
} from './bridgeSecurity';

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
  /**
   * Large JSON bodies for uploadImage — extension fetches via HTTP so WS
   * does not carry multi-MB base64 (was: Extension API timeout ~66s).
   */
  bodyStash: Map<string, { json: string; expiresAt: number }>;
};

const BODY_STASH_TTL_MS = 5 * 60_000;
const BODY_STASH_THRESHOLD = 48_000; // ~48KB JSON → stash over HTTP

const g = globalThis as unknown as { __ainovelFlowBridge?: BridgeState };
// Durable bundles retain identity/project diagnostics, never live auth.
const ALLOW_DURABLE_BEARER_REHYDRATION = false;

function purgeExpiredBodyStash(s: BridgeState): void {
  const now = Date.now();
  for (const [id, row] of s.bodyStash) {
    if (row.expiresAt <= now) s.bodyStash.delete(id);
  }
}

function stashLargeBody(body: unknown): string | null {
  if (body == null) return null;
  let json: string;
  try {
    json = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    return null;
  }
  if (json.length < BODY_STASH_THRESHOLD) return null;
  const s = state();
  purgeExpiredBodyStash(s);
  const id = `bs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  s.bodyStash.set(id, { json, expiresAt: Date.now() + BODY_STASH_TTL_MS });
  console.log(
    `[FlowBridge] body-stash ${id} ${json.length}B (upload/WS offload)`,
  );
  return id;
}

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
      callbackSecret: crypto.randomBytes(32).toString('hex'),
      extApiChain: Promise.resolve(),
      bodyStash: new Map(),
    };
  }
  // Hot-upgrade older process state (HMR / long-lived Node)
  const st = g.__ainovelFlowBridge;
  if (!st.flowKeysByAccount) st.flowKeysByAccount = new Map();
  if (!st.inheritTimers) st.inheritTimers = new Map();
  if (!st.extApiChain) st.extApiChain = Promise.resolve();
  if (!st.bodyStash) st.bodyStash = new Map();
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
  // Token capture ≠ full Google login. sessionVerified only when email already known.
  const prev = loadAccounts().find((a) => a.id === id);
  const hasEmail = Boolean(prev?.email && String(prev.email).includes('@'));
  updateAccount(id, {
    flowKeyPresent: true,
    status: hasEmail ? 'active' : prev?.status === 'connecting' ? 'connecting' : 'idle',
    sessionVerified: hasEmail,
    lastError: hasEmail
      ? null
      : prev?.lastError || 'Có token nhưng chưa đăng nhập Google (thiếu email)',
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
    return null;
  }
  return s.flowKey && s.flowKey.length >= 20 ? s.flowKey : null;
}

/** A rejected bearer must never be resurrected from disk or another callback. */
function clearAccountFlowKey(accountId: string, reason: string): void {
  const id = String(accountId || '').trim();
  if (!id) return;
  const s = state();
  const rejected = s.flowKeysByAccount.get(id) || null;
  s.flowKeysByAccount.delete(id);
  if (s.flowKeyAccountId === id || (rejected && s.flowKey === rejected)) {
    s.flowKey = null;
    s.flowKeyAccountId = null;
    s.tokenCapturedAt = null;
  }
  try {
    const { writeSessionBundle } = require('./sessionInherit') as typeof import('./sessionInherit');
    writeSessionBundle(id, {
      flowKey: null,
      flowKeyPresent: false,
      tokenCapturedAt: null,
      note: `Live bearer rejected: ${reason}`,
    });
  } catch {
    /* ignore */
  }
  const prev = loadAccounts().find((account) => account.id === id);
  updateAccount(id, {
    status: 'connecting',
    flowKeyPresent: false,
    sessionVerified: false,
    lastError: 'Phiên Flow hết hạn hoặc token bị từ chối — đang lấy token mới từ browser',
    email: prev?.email || '',
  });
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

/**
 * Async path: enqueue + start workers, return immediately with taskId.
 * Client polls getQueueTask / /api/flow/task until done|failed.
 */
export async function enqueueGenerateOne(
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  taskId?: string;
  task?: unknown;
  queueAhead?: number;
}> {
  if (isAdoptedExternalBridge()) {
    const { remoteEnqueueGenerateOne } = await import('./remoteBridge');
    if (typeof remoteEnqueueGenerateOne === 'function') {
      return remoteEnqueueGenerateOne(body);
    }
    // Daemon without enqueue RPC — fall back to sync would hang; hard-fail clear
    return {
      ok: false,
      error:
        'Bridge remote (daemon) chưa hỗ trợ enqueue async — restart app để bridge in-process.',
    };
  }
  const q = getQueue() as FlowQueueEngine & {
    enqueueAndStart?: (b: Record<string, unknown>) => {
      ok: boolean;
      error?: string;
      task?: { id: string; queueAhead?: number };
      tasks?: unknown[];
    };
    resumeFromStop?: () => void;
  };
  // Hot-reload safe: old singleton may lack enqueueAndStart
  if (typeof q.enqueueAndStart === 'function') {
    const r = q.enqueueAndStart(body);
    if (!r.ok || !r.task) {
      return { ok: false, error: r.error || 'enqueue failed' };
    }
    return {
      ok: true,
      taskId: r.task.id,
      task: r.task,
      queueAhead: r.task.queueAhead ?? 0,
    };
  }
  try {
    q.resumeFromStop?.();
    const ahead = q.snapshot().pending;
    const created = q.enqueueMany(body);
    const task = created[0] as
      | (import('./types').FlowTask & { queueAhead?: number; appSavePath?: string })
      | undefined;
    if (!task) return { ok: false, error: 'Thiếu prompt' };
    task.queueAhead = ahead;
    if (typeof body.appSavePath === 'string') {
      task.appSavePath = String(body.appSavePath);
    }
    if (typeof body.correlationId === 'string') {
      (task as { correlationId?: string }).correlationId = String(
        body.correlationId,
      );
    }
    q.start();
    return {
      ok: true,
      taskId: task.id,
      task,
      queueAhead: ahead,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function getQueueTask(id: string) {
  const q = getQueue() as FlowQueueEngine & {
    getTask?: (id: string) => import('./types').FlowTask | undefined;
  };
  if (typeof q.getTask === 'function') return q.getTask(id);
  // Hot-reload: read from snapshot.tasks
  return q.snapshot().tasks.find((t) => t.id === id);
}

export function findQueueTaskByCoords(opts: {
  kind?: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex?: number;
}) {
  const q = getQueue() as FlowQueueEngine & {
    findTaskByCoords?: (o: typeof opts) => import('./types').FlowTask | undefined;
  };
  if (typeof q.findTaskByCoords === 'function') {
    return q.findTaskByCoords(opts);
  }
  const kind = opts.kind || 'video';
  const pi =
    opts.promptIndex != null && Number.isFinite(Number(opts.promptIndex))
      ? Number(opts.promptIndex)
      : undefined;
  return [...q.snapshot().tasks].reverse().find((t) => {
    if (kind === 'video') {
      if (t.kind !== 'video' && t.kind !== 'extend') return false;
    } else if (t.kind !== kind) {
      return false;
    }
    if (Number(t.chapterNum) !== Number(opts.chapterNum)) return false;
    if (Number(t.sceneIndex) !== Number(opts.sceneIndex)) return false;
    if (pi != null && Number(t.promptIndex) !== pi) return false;
    return true;
  });
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
        flowKeyPresent: Boolean(getAccountFlowKey(r.accountId)),
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

  const accounts = loadAccounts().map((a) => {
    const perChrome = getChromeSessionInfo(a.id);
    const isBound =
      s.activeAccountId === a.id ||
      chromeInfo.accountId === a.id ||
      perChrome.accountId === a.id;

    // Extension socket bound to THIS accountId (or active bind while login)
    const sock = s.sockets.get(a.id);
    const sockLive = Boolean(sock && sock.readyState === 1);
    const extForProfile = sockLive;

    // Token: persisted on account OR live key owned by THIS account only
    // (cấm s.flowKey của profile A sơn xanh profile B)
    const liveToken = Boolean(s.flowKey && s.flowKeyAccountId === a.id);
    // Real Google login = email from labs session. NEVER paint verified from token alone
    // (stale SESSION_BUNDLE Bearer was making "Trình duyệt 1 · sẵn sàng" without login).
    const hasEmail = Boolean(a.email && String(a.email).includes('@'));
    const verified = Boolean(hasEmail && a.sessionVerified);

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
    const tokenOk = ownKey;

    let status = a.status;
    // Token alone ≠ logged-in ready. Keep active only when email verified.
    if (verified && tokenOk && status !== 'cooldown' && status !== 'error') {
      status = 'active';
    } else if ((!verified || !tokenOk) && status === 'active' && !loginOpen) {
      // Stale "active" from old token paint — idle until real Google login
      status = 'idle';
    } else if (status === 'connecting' && !loginOpen && !browserAlive) {
      status = 'idle';
    }

    const generationReady = verified && tokenOk && projectReady;
    const previousCapabilities = a.capabilities;

    return {
      ...a,
      status,
      flowKeyPresent: tokenOk,
      // Contract: sessionVerified only with real email — never tokenOk alone
      sessionVerified: verified,
      email: a.email || '',
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
      capabilities: {
        canGenerateImage: generationReady,
        canGenerateVideo: generationReady,
        canUpload: generationReady,
        canListProjects: verified && tokenOk,
        paygateTier: a.paygateTier ?? null,
        credits: a.credits ?? null,
        projectCount: a.projects?.length || 0,
        flowKeyPresent: tokenOk,
        browserCookies: previousCapabilities?.browserCookies ?? false,
        proxyParity: generationReady,
        updatedAt: previousCapabilities?.updatedAt || Date.now(),
      },
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

  // Global ready: live Bearer bound to a profile that has real Google email
  const anyVerified = accounts.some(
    (a) =>
      a.sessionVerified &&
      a.email &&
      String(a.email).includes('@') &&
      a.flowKeyPresent,
  );
  const liveKeyOk =
    Boolean(s.flowKey && String(s.flowKey).length >= 20) && anyVerified;

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
  // Always drop THIS profile's bearer from memory (disk wipe is prepareBlankLoginProfile).
  // Never leave a stale ya29 for the wiped profile.
  s.flowKeysByAccount.delete(id);
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

/**
 * Full runtime + disk purge when user deletes a Flow profile card.
 * Clears bearer map, active bind, and browser profile folders.
 */
export function purgeDeletedAccountRuntime(accountId: string): {
  accountId: string;
  killed: number;
  removed: string[];
  errors: string[];
} {
  const id = String(accountId || '').trim();
  const s = state();
  s.flowKeysByAccount.delete(id);
  if (s.flowKeyAccountId === id) {
    s.flowKey = null;
    s.flowKeyAccountId = null;
    s.tokenCapturedAt = null;
  }
  if (s.activeAccountId === id) {
    s.activeAccountId = null;
  }
  try {
    const { purgeAccountProfile } = require('./chromeSession') as typeof import('./chromeSession');
    return purgeAccountProfile(id);
  } catch (e) {
    return {
      accountId: id,
      killed: 0,
      removed: [],
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
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
  const challengeRequired = payload.challengeRequired === true;
  const payloadSessionReady = payload.ok !== false && !challengeRequired;

  const targetId =
    String(accountIdHint || payload.accountId || s.activeAccountId || '').trim() ||
    loadAccounts().find((a) => a.status === 'connecting')?.id ||
    loadAccounts()[0]?.id ||
    '';
  const storedAccount = targetId
    ? loadAccounts().find((account) => account.id === targetId)
    : undefined;
  // A service-worker session fetch can transiently return an empty payload
  // while the authenticated Flow tab still has a verified email/session.
  // NEVER wipe a known email with empty transient fields — that demoted
  // sessionVerified and painted "thiếu email" while Bearer still existed
  // (blocked all Flow gen until re-login).
  const trustedEmail =
    (storedAccount?.email && String(storedAccount.email).includes('@')
      ? String(storedAccount.email)
      : '') ||
    (s.identity?.email && String(s.identity.email).includes('@')
      ? String(s.identity.email)
      : '');
  const effectiveEmail = email || trustedEmail;
  const effectiveName =
    name ||
    storedAccount?.displayName ||
    storedAccount?.name ||
    s.identity?.name ||
    '';
  const effectiveCredits =
    credits ?? storedAccount?.credits ?? s.identity?.credits ?? null;
  const effectivePaygateTier =
    paygateTier ?? storedAccount?.paygateTier ?? s.identity?.paygateTier ?? null;
  const effectiveSessionExpires =
    sessionExpires ??
    storedAccount?.sessionExpires ??
    s.identity?.sessionExpires ??
    null;

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
    email: effectiveEmail,
    name: effectiveName,
    image: payload.image ? String(payload.image) : undefined,
    credits: effectiveCredits,
    paygateTier: effectivePaygateTier,
    sessionExpires: effectiveSessionExpires,
    lastSyncedAt: syncedAt,
    projectCount: harvested.length || loadProjects().length,
  };

  // Verified = real email on profile. Challenge may block gen but must not
  // erase identity; payload ok=false alone must not demote a known login.
  const verified = Boolean(
    effectiveEmail &&
      effectiveEmail.includes('@') &&
      !challengeRequired &&
      (payloadSessionReady ||
        Boolean(storedAccount?.sessionVerified) ||
        Boolean(email)),
  );

  if (targetId) {
    const acc = storedAccount;
    const targetFlowKey = getAccountFlowKey(targetId);
    const generationReady = verified && Boolean(targetFlowKey);
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
      email: effectiveEmail,
      displayName: effectiveName || acc?.displayName,
      name: effectiveName || effectiveEmail || acc?.name || 'Tài khoản',
      credits: effectiveCredits,
      paygateTier: effectivePaygateTier,
      sessionExpires: effectiveSessionExpires,
      lastSyncedAt: syncedAt,
      sessionVerified: verified,
      flowKeyPresent: Boolean(targetFlowKey),
      status: generationReady ? 'active' : verified ? 'connecting' : 'idle',
      projectId: nextProjectId,
      projects: mergedProjects,
      lastError: generationReady
        ? null
        : challengeRequired
          ? 'GOOGLE_CHALLENGE_REQUIRED — hoàn tất xác minh Google trên cửa sổ Chromium'
        : verified
          ? 'Session có email nhưng chưa có Bearer token của đúng profile'
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
      flowKeyPresent: false,
      status: 'connecting',
      projectId: payloadProjectId || harvested[0]?.id || '',
      projects: harvested.map((p) => ({
        id: p.id,
        title: p.title,
        source: 'capture' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      lastError: 'Session có email nhưng chưa bind Bearer token vào profile mới',
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
    `[FlowBridge] identity synced account=${s.activeAccountId || '—'} email=${effectiveEmail || '—'} credits=${effectiveCredits ?? 'n/a'} projects=${harvested.length} projectId=${finalPid || '—'} verified=${verified}`,
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

  // SESSION_BUNDLE is diagnostic metadata only. A rejected generation bearer
  // must be reacquired from this live browser, never resurrected from disk.
  let key = getAccountFlowKey(id);
  if (ALLOW_DURABLE_BEARER_REHYDRATION && !key) {
    const b = loadSessionBundle(id);
    if (b?.flowKey && b.flowKey.length >= 20) {
      setAccountFlowKey(id, b.flowKey);
      key = b.flowKey;
      steps.push('Rehydrate Bearer từ SESSION_BUNDLE (disk)');
    }
  }

  // Harvest live session from browser of THIS profile
  try {
    // Explicit user Check/Sync may open tab; still refuse open when Google login tab exists (extension-side)
    await commandExtension(
      'force_token_harvest',
      { allowOpenTab: false, reloadIfMissing: false },
      35_000,
      id,
    );
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

  const inheritEmail = Boolean(
    accNow?.email && String(accNow.email).includes('@'),
  );
  const projectCount = accNow?.projects?.length || 0;
  // sessionVerified = real Google email (login). Do NOT require prior
  // sessionVerified flag — that created a permanent demotion loop when a
  // transient poll cleared verified while email/key still lived on disk.
  const loginVerified = inheritEmail;
  const authenticated = Boolean(loginVerified && finalKey);
  const projectReady = Boolean(
    (accNow?.projectId && isPlausibleProjectId(accNow.projectId)) ||
      (accNow?.projects || []).some((project) =>
        isPlausibleProjectId(project.id),
      ),
  );
  const generationReady = authenticated && projectReady;
  // Gen readiness requires the authenticated profile AND a real Flow project.
  // A Bearer plus email is login-ready, not proof that Google permits creation.
  const capabilities = {
    canGenerateImage: generationReady,
    canGenerateVideo: generationReady,
    canUpload: generationReady,
    canListProjects: authenticated,
    paygateTier: accNow?.paygateTier ?? null,
    credits: accNow?.credits ?? null,
    projectCount,
    flowKeyPresent: Boolean(finalKey),
    browserCookies: disk.hasCookies,
    /** App can invoke any Flow API as this account and receive full results */
    proxyParity: generationReady,
    updatedAt: Date.now(),
  };

  updateAccount(id, {
    status: authenticated
      ? 'active'
      : loginVerified
        ? 'connecting'
        : accNow?.status === 'connecting'
          ? 'connecting'
          : 'idle',
    flowKeyPresent: Boolean(finalKey),
    sessionVerified: loginVerified,
    sessionInheritedAt: Date.now(),
    profileDir,
    browserExe: browserExe || accNow?.browserExe || '',
    capabilities,
    lastError: generationReady
      ? null
      : loginVerified && !finalKey
        ? 'Đã có email Google nhưng chưa có Bearer token của đúng profile'
        : finalKey && !loginVerified
          ? 'Có token nhưng chưa đăng nhập Google (thiếu email) — giữ browser, hoàn tất login Google trên tab Flow'
          : accNow?.lastError ||
            'Chưa inherit được token/email — mở browser login',
  });

  // ready = real Google session + Bearer of this profile.
  const ready = generationReady;
  console.log(
    `[FlowBridge] inherit account=${id} email=${accNow?.email || '—'} key=${Boolean(finalKey)} projects=${accNow?.projects?.length || 0} ready=${ready}`,
  );

  return {
    ok: ready,
    error: ready
      ? undefined
      : sync.error ||
        'Chưa có email Google trên profile — đăng nhập xong trên browser rồi Sync lại (không đóng tab sớm)',
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
      accountId || state().activeAccountId || undefined,
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
async function explainCreateProjectFailure(
  baseError: string,
  accountId?: string,
): Promise<string> {
  try {
    const inspected = await commandExtension(
      'inspect_flow_page',
      {},
      20_000,
      accountId || state().activeAccountId || undefined,
    );
    const page = inspected.result as Record<string, unknown> | undefined;
    const controls = Array.isArray(page?.controls)
      ? page.controls
          .map((row) =>
            row && typeof row === 'object'
              ? String((row as Record<string, unknown>).text || '')
              : '',
          )
          .join(' ')
      : '';
    const pageText = `${String(page?.bodyText || '')} ${controls}`;
    if (/upgrade to create/i.test(pageText)) {
      return [
        'FLOW_ACCOUNT_UPGRADE_REQUIRED',
        'Google Flow đang hiển thị "Upgrade to create" cho tài khoản này và chưa có dự án khả dụng.',
        `Upstream: ${baseError}`,
      ].join(': ');
    }
  } catch {
    /* Preserve the upstream error when the live page cannot be inspected. */
  }
  return baseError;
}

async function recoverCreatedProjectFromLivePage(
  expectedTitle: string,
  accountId?: string,
): Promise<FlowProject | null> {
  try {
    const listed = await commandExtension(
      'list_projects',
      {},
      20_000,
      accountId || state().activeAccountId || undefined,
    );
    const result = listed.result as Record<string, unknown> | undefined;
    const projects = Array.isArray(result?.projects) ? result.projects : [];
    const normalizedExpected = expectedTitle.normalize('NFC').trim();
    const observed = projects.find((row) => {
      if (!row || typeof row !== 'object') return false;
      const title = String((row as Record<string, unknown>).title || '')
        .normalize('NFC')
        .trim();
      return title === normalizedExpected;
    }) as Record<string, unknown> | undefined;
    const id = String(observed?.id || '').trim();
    if (!id || !isPlausibleProjectId(id)) return null;
    const title = String(observed?.title || expectedTitle).trim();
    const row = upsertProject({ id, title, source: 'capture' });
    setProjectId(
      id,
      title,
      accountId || state().activeAccountId || undefined,
    );
    return row;
  } catch {
    return null;
  }
}

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
        preferPageContext: true,
      },
      60_000,
      accountId || state().activeAccountId || undefined,
    );
    if (res.error) {
      const recovered = await recoverCreatedProjectFromLivePage(
        name,
        accountId,
      );
      if (recovered) {
        return { ok: true, project: recovered };
      }
      return {
        ok: false,
        error: await explainCreateProjectFailure(
          String(res.error),
          accountId,
        ),
      };
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
    const baseError = e instanceof Error ? e.message : String(e);
    const recovered = await recoverCreatedProjectFromLivePage(
      name,
      accountId,
    );
    if (recovered) {
      return { ok: true, project: recovered };
    }
    return {
      ok: false,
      error: await explainCreateProjectFailure(baseError, accountId),
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
        } = await import('./chromeSession');
        if (bindId) {
          s.activeAccountId = bindId;
          const prev = loadAccounts().find((a) => a.id === bindId);
          const hasEmail = Boolean(prev?.email?.includes('@'));
          updateAccount(bindId, {
            status: hasEmail ? 'active' : 'idle',
            flowKeyPresent: true,
            // sessionVerified only with real Google email (not token alone)
            sessionVerified: hasEmail,
            projectId: prev?.projectId || s.projectId || '',
            profileDir: prev?.profileDir || undefined,
            lastError: hasEmail
              ? null
              : prev?.lastError ||
                'Có token nhưng chưa đăng nhập Google (thiếu email) — bấm Đăng nhập',
          });
          // Full inherit: email/credits/projects + SESSION_BUNDLE
          scheduleInheritAccountSession(bindId, isNewToken ? 800 : 2500);
        }

        const activeSess = bindId ? getSession(bindId) : null;
        // CRITICAL: do NOT close login window on bare token.
        // Closing early killed Google login mid-flow → email never harvested
        // ("Có token nhưng thiếu email"). Only close when session has @email.
        if (isNewToken && bindId) {
          const idr = await syncAccountIdentity(bindId);
          const emailNow =
            idr.identity?.email ||
            loadAccounts().find((a) => a.id === bindId)?.email ||
            '';
          console.log(
            '[FlowBridge] identity after token:',
            emailNow || 'no-email',
            idr.error || '',
          );
          if (emailNow && String(emailNow).includes('@')) {
            const chromeInfo = getChromeSessionInfo(bindId);
            const shouldClose =
              activeSess?.loginOpen ||
              s.loginSessionOpen ||
              Boolean(chromeInfo.loginPidAlive);
            if (shouldClose) {
              // Single owner: minimize + kill login + background relaunch (no 2nd spawn elsewhere)
              const r = await closeLoginSessionAfterCapture({
                delayMs: 600,
                accountId: bindId || undefined,
                keepBackground: true,
                force: Boolean(
                  !activeSess?.loginOpen &&
                    !s.loginSessionOpen &&
                    chromeInfo.loginPidAlive,
                ),
              });
              console.log(
                '[FlowBridge] auto-close after email session:',
                r.message,
              );
            }
          } else {
            console.log(
              '[FlowBridge] keep login open — token without Google email (finish login on Chromium)',
            );
            updateAccount(bindId, {
              status: 'connecting',
              flowKeyPresent: true,
              sessionVerified: false,
              lastError:
                'Token tạm có — hoàn tất đăng nhập Google trên browser profile (chờ email hiện trên Flow)',
            });
          }
        }
      } catch (e) {
        console.warn('[FlowBridge] token_captured handler failed', e);
      }
    })();
    return;
  }

  if (msg.type === 'token_rejected') {
    const bindId =
      socketAccountId && socketAccountId !== 'default'
        ? socketAccountId
        : s.activeAccountId || '';
    if (bindId) {
      clearAccountFlowKey(bindId, String(msg.reason || 'upstream_401'));
      console.warn(
        `[FlowBridge] rejected bearer cleared account=${bindId} reason=${String(msg.reason || 'upstream_401')}`,
      );
    }
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
          const existing = loadAccounts().find((account) => account.id === bind);
          const hasStoredEmail = Boolean(
            existing?.email && String(existing.email).includes('@'),
          );
          const alreadyVerified = Boolean(
            hasStoredEmail &&
              (existing?.sessionVerified || hasStoredEmail),
          );
          // A partial SW poll must not erase a verified tab session / email.
          // Token-only is incomplete only when this profile never had email.
          updateAccount(bind, {
            status: alreadyVerified ? 'active' : 'idle',
            flowKeyPresent: true,
            // Keep sessionVerified when email already on disk
            sessionVerified: alreadyVerified,
            lastError: alreadyVerified
              ? null
              : 'Có token nhưng chưa đăng nhập Google (thiếu email) — bấm Đăng nhập',
          });
        }

        // Chỉ đóng LOGIN khi đã có email Google — token-only phải giữ cửa sổ để user login xong
        if (email && email.includes('@')) {
          const { closeLoginSessionAfterCapture, getChromeSessionInfo } =
            await import('./chromeSession');
          const chrome = getChromeSessionInfo(bind);
          // loginOpen flag OR loginPid still alive (stuck visible login after flag flip)
          // Do NOT kill intentional background (bgPid only) on every poll.
          const shouldClose =
            chrome.loginOpen ||
            s.loginSessionOpen ||
            Boolean(chrome.loginPidAlive);
          if (shouldClose) {
            const forceStuck =
              !chrome.loginOpen &&
              !s.loginSessionOpen &&
              Boolean(chrome.loginPidAlive);
            const r = await closeLoginSessionAfterCapture({
              delayMs: 400,
              accountId: bind || undefined,
              keepBackground: true,
              force: forceStuck,
            });
            console.log(
              '[FlowBridge] session_poll → closed login (email verified)',
              r.message,
            );
          } else if (
            // Soft recovery: flags already closed but Chrome still visible
            // (legacy retain-without-kill path). Minimize only — no kill spam on bg.
            chrome.profileBrowserAlive &&
            hasToken
          ) {
            const gHide = globalThis as unknown as {
              __ainovelFlowSoftHideAt?: Record<string, number>;
            };
            gHide.__ainovelFlowSoftHideAt = gHide.__ainovelFlowSoftHideAt || {};
            const key = bind || 'default';
            const last = gHide.__ainovelFlowSoftHideAt[key] || 0;
            if (Date.now() - last > 90_000) {
              gHide.__ainovelFlowSoftHideAt[key] = Date.now();
              try {
                await commandExtension(
                  'close_login_session',
                  {},
                  3_000,
                  bind || undefined,
                );
                console.log(
                  '[FlowBridge] session_poll → soft-hide browser (email+token ready, login flag off)',
                );
              } catch {
                /* ignore */
              }
            }
          }
          const acc = bind
            ? loadAccounts().find((a) => a.id === bind)
            : null;
          if (!acc?.credits || !acc?.lastSyncedAt) {
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

  if (msg.type === 'challenge_status') {
    const required = msg.challengeRequired === true;
    const detail = String(msg.message || '').slice(0, 240);
    console.log(
      `[FlowBridge] challenge_status required=${required} account=${socketAccountId || '—'} ${detail}`,
    );
    // Surface lastError only — do not force cooldown (gen is actively waiting)
    const bind =
      socketAccountId ||
      s.activeAccountId ||
      loadAccounts().find((a) => a.status === 'active' || a.status === 'connecting')
        ?.id ||
      '';
    if (bind && required) {
      updateAccount(bind, {
        lastError:
          detail ||
          'Google /sorry/ — tick reCAPTCHA trên cửa sổ Chromium',
      });
    } else if (bind && !required) {
      updateAccount(bind, { lastError: null });
    }
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
      // Google Flow standard: serialize ALL extension api_request (captcha-safe).
      // Extra gap when captchaAction present — avoids parallel grecaptcha race.
      const baseGap = Number(FLOW_DEFAULTS.extensionMinGapMs) || 0;
      const captchaGap = params.captchaAction
        ? Number(FLOW_DEFAULTS.captchaExtraGapMs) || 0
        : 0;
      const gap = baseGap + captchaGap;
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
      const cap = params.captchaAction
        ? ` (reCAPTCHA ${params.captchaAction})`
        : '';
      reject(
        new Error(
          `Extension API timeout sau ${Math.round(timeoutMs / 1000)}s${cap}. ` +
            `Mở tab Flow trên profile đang gen, F5 nếu treo, rồi gen lại — không đổi provider.`,
        ),
      );
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });

    // Offload large uploadImage JSON off WebSocket (base64 stills)
    const stashId = stashLargeBody(params.body);
    const wsParams: Record<string, unknown> = {
      url: params.url,
      method: params.method || 'POST',
      headers: headersOut,
      captchaAction: params.captchaAction,
      flowKey,
      accessToken: flowKey,
    };
    if (stashId) {
      wsParams.bodyStashId = stashId;
      wsParams.body = null;
    } else {
      wsParams.body = params.body;
    }

    const ok = sendWs(
      {
        id,
        method: 'api_request',
        params: wsParams,
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

function isSecretValid(providedSecret: string, expectedSecret: string): boolean {
  if (!providedSecret || !expectedSecret) return false;
  try {
    const a = Buffer.from(providedSecret, 'utf8');
    const b = Buffer.from(expectedSecret, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/localhost:\d+$/,
  /^chrome-extension:\/\/[a-z]{32}$/,
  /^app:\/\//,
];

function resolveAllowedOrigin(req: http.IncomingMessage): string | null {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return null;
  if (ALLOWED_ORIGIN_PATTERNS.some((pat) => pat.test(origin))) {
    return origin;
  }
  return null;
}

const ALLOWED_PROXY_HOSTS = new Set([
  'aisandbox-pa.googleapis.com',
  'labs.google',
  'notebooklm.google',
  'content-aisandbox.googleapis.com',
  'clients6.google.com',
]);

export function isAllowedProxyUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_PROXY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  req?: http.IncomingMessage,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (req) {
    const origin = resolveAllowedOrigin(req);
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

let sanitizedOnce = false;

export async function ensureBridgeStarted(): Promise<BridgeSnapshot> {
  const s = state();
  try {
    const { registerFlowBrowserShutdownHooks } = await import('./chromeSession');
    registerFlowBrowserShutdownHooks();
  } catch {
    /* ignore */
  }
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
      const { loadSessionBundle } = await import('./sessionInherit');
      let rehydrated = 0;
      for (const a of ALLOW_DURABLE_BEARER_REHYDRATION ? loadAccounts() : []) {
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
  if (s.httpServer) return getBridgeSnapshot();

  if (s.adoptedExternal) {
    if (await probeExistingBridge()) {
      return getBridgeSnapshotAsync();
    }
    console.warn(
      '[FlowBridge] Adopted daemon gone — starting local bridge in this process',
    );
    s.adoptedExternal = false;
  }

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
          const origin = resolveAllowedOrigin(req);
          const headers: Record<string, string> = {
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,x-callback-secret,x-dest-path',
          };
          if (origin) {
            headers['Access-Control-Allow-Origin'] = origin;
            headers['Vary'] = 'Origin';
          }
          res.writeHead(204, headers);
          res.end();
          return;
        }

        // Large api_request body offload (uploadImage) — extension SW fetches then posts to Labs
        if (
          url.pathname.startsWith('/internal/body-stash/') &&
          req.method === 'GET'
        ) {
          const secret = String(req.headers['x-callback-secret'] || '');
          if (!isSecretValid(secret, s.callbackSecret)) {
            sendJson(res, 403, { error: 'bad secret' }, req);
            return;
          }
          const stashId = decodeURIComponent(
            url.pathname.slice('/internal/body-stash/'.length),
          );
          purgeExpiredBodyStash(s);
          const row = s.bodyStash.get(stashId);
          if (!row) {
            sendJson(res, 404, { error: 'stash not found or expired' }, req);
            return;
          }
          s.bodyStash.delete(stashId);
          const origin = resolveAllowedOrigin(req);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(row.json)),
          };
          if (origin) {
            headers['Access-Control-Allow-Origin'] = origin;
            headers['Vary'] = 'Origin';
          }
          res.writeHead(200, headers);
          res.end(row.json);
          return;
        }

        // Extension streams large media here (account cookies already applied)
        if (
          url.pathname === '/internal/receive-binary' &&
          req.method === 'POST'
        ) {
          const secret = String(req.headers['x-callback-secret'] || '');
          if (!isSecretValid(secret, s.callbackSecret)) {
            sendJson(res, 403, { error: 'bad secret' }, req);
            return;
          }
          const destHint = String(req.headers['x-dest-path'] || '').trim();
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const buf = Buffer.concat(chunks);
          if (buf.length < 64) {
            sendJson(res, 400, { error: 'empty body', bytes: buf.length }, req);
            return;
          }
          if (buf.length > 500 * 1024 * 1024) {
            sendJson(res, 413, { error: 'payload too large', bytes: buf.length }, req);
            return;
          }
          const projectRoot = path.resolve(process.cwd());
          let dest = '';
          if (destHint) {
            const resolved = path.resolve(destHint);
            if (resolved.startsWith(projectRoot) && !path.relative(projectRoot, resolved).startsWith('..')) {
              dest = resolved;
            }
          }
          if (!dest) {
            const dir = path.join(projectRoot, 'public', 'video', '_sink');
            fs.mkdirSync(dir, { recursive: true });
            dest = path.join(dir, `recv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.bin`);
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
            }, req);
          } catch (e) {
            sendJson(res, 500, {
              error: e instanceof Error ? e.message : String(e),
            }, req);
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

        // Health: always answer immediately (hang detector / UI probe)
        if (
          (url.pathname === '/api/health' || url.pathname === '/health') &&
          req.method === 'GET'
        ) {
          sendJson(res, 200, {
            ok: true,
            ts: Date.now(),
            extensionConnected: Boolean(s.extSocket),
            flowKeyPresent: Boolean(s.flowKey),
            queuePending: s.queue.snapshot().pending,
            queueRunning: s.queue.snapshot().running,
          });
          return;
        }

        if (url.pathname === '/api/status' && req.method === 'GET') {
          // Snapshot only — never await extension (prevents CLOSE_WAIT pile-up)
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
          const { deleteAccountHard } = await import('./accountStore');
          const disk = deleteAccountHard(id);
          try {
            purgeDeletedAccountRuntime(id);
          } catch {
            /* ignore */
          }
          sendJson(res, 200, {
            ok: disk.ok,
            accountId: id,
            killed: disk.killed,
            removed: disk.removed,
            errors: disk.errors,
          });
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
            const prevClaim = loadAccounts().find((a) => a.id === accountId);
            const claimEmail = Boolean(
              prevClaim?.email && String(prevClaim.email).includes('@'),
            );
            updateAccount(accountId, {
              status: claimEmail ? 'active' : 'idle',
              flowKeyPresent: true,
              // Token claim without email is partial — not sessionVerified
              sessionVerified: claimEmail,
              lastError: claimEmail
                ? null
                : 'Có token — đang sync email; nếu trống hãy Đăng nhập Google',
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

        // Async: enqueue + start, return taskId immediately (no multi-minute hold)
        if (url.pathname === '/api/enqueue-one' && req.method === 'POST') {
          const body = await readJson(req);
          const r = s.queue.enqueueAndStart(body);
          if (!r.ok || !r.task) {
            sendJson(res, 400, { ok: false, error: r.error || 'enqueue failed' });
            return;
          }
          sendJson(res, 202, {
            ok: true,
            taskId: r.task.id,
            task: r.task,
            queueAhead: r.task.queueAhead ?? 0,
            queue: s.queue.snapshot(),
          });
          return;
        }

        if (url.pathname === '/api/task' && req.method === 'GET') {
          const id = String(url.searchParams.get('id') || '').trim();
          if (!id) {
            sendJson(res, 400, { ok: false, error: 'missing id' });
            return;
          }
          const task = s.queue.getTask(id);
          if (!task) {
            sendJson(res, 404, { ok: false, error: 'task_not_found' });
            return;
          }
          sendJson(res, 200, { ok: true, task, queue: s.queue.snapshot() });
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

    // Bound long-held connections; status/health still answer fast.
    // (generate-one may hold longer — prefer /api/enqueue-one for app path)
    try {
      server.requestTimeout = 0; // disable hard kill of long generate-one
      server.headersTimeout = 120_000;
      server.keepAliveTimeout = 30_000;
    } catch {
      /* older Node */
    }

    server.listen(FLOW_HTTP_PORT, FLOW_HOST, () => {
      s.httpServer = server;
      const wss = new WebSocketServer({ port: FLOW_WS_PORT, host: FLOW_HOST });
      s.wss = wss;
      wss.on('connection', (socket, req) => {
        const url = new URL(req.url || '', `http://${FLOW_HOST}`);
        const providedSecret = url.searchParams.get('secret') || String(req.headers['x-callback-secret'] || '');
        const origin = String(req.headers.origin || '').trim();
        const wsToken = url.searchParams.get('token') || '';

        // SEC-101: validate WS via bridgeSecurity (session token + origin)
        const sessionToken = getOrCreateSessionToken();
        const secCheck = validateWsConnection(origin, providedSecret || wsToken || sessionToken);
        if (!secCheck.allowed) {
          console.warn(`[FlowBridge] WS rejected: ${secCheck.reason}`);
          socket.close(secCheck.closeCode || 4001, secCheck.reason);
          return;
        }

        // Legacy check: also accept callback secret from known origins
        const hasSecret = isSecretValid(providedSecret, s.callbackSecret);
        const isAllowedOrigin = !origin || ALLOWED_ORIGIN_PATTERNS.some((pat) => pat.test(origin));

        if (!hasSecret && !isAllowedOrigin && !secCheck.allowed) {
          console.warn(`[FlowBridge] Unauthorized WS connection attempt rejected: origin="${origin}"`);
          socket.close(4001, 'Unauthorized');
          return;
        }

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
