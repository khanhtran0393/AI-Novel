/**
 * Local Flow Bridge: WebSocket (extension) + HTTP (Next API / callbacks).
 * Singleton per Node process.
 */
import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { FLOW_DEFAULTS, FLOW_HOST, FLOW_HTTP_PORT, FLOW_WS_PORT } from './config';
import {
  createAccount,
  deleteAccount,
  loadAccounts,
  saveAccounts,
  updateAccount,
} from './accountStore';
import type {
  BridgeSnapshot,
  ExtApiResponse,
  FlowAccount,
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
  extSocket: WebSocket | null;
  /** Port already held by another Node in this machine (prior smoke/dev) */
  adoptedExternal: boolean;
  flowKey: string | null;
  projectId: string | null;
  tokenCapturedAt: number | null;
  tokenWatchdog: ReturnType<typeof setInterval> | null;
  loginSessionOpen: boolean;
  metrics: {
    requestCount: number;
    successCount: number;
    failedCount: number;
    lastError: string | null;
  };
  pending: Map<string, Pending>;
  queue: FlowQueueEngine;
  callbackSecret: string;
};

const g = globalThis as unknown as { __ainovelFlowBridge?: BridgeState };

function state(): BridgeState {
  if (!g.__ainovelFlowBridge) {
    g.__ainovelFlowBridge = {
      httpServer: null,
      wss: null,
      extSocket: null,
      adoptedExternal: false,
      flowKey: null,
      projectId: null,
      tokenCapturedAt: null,
      tokenWatchdog: null,
      loginSessionOpen: false,
      metrics: {
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        lastError: null,
      },
      pending: new Map(),
      queue: new FlowQueueEngine(),
      callbackSecret: `ainovel_${Date.now().toString(36)}`,
    };
  }
  return g.__ainovelFlowBridge;
}

function newMsgId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function sendWs(obj: unknown): boolean {
  const s = state();
  if (!s.extSocket || s.extSocket.readyState !== 1) return false;
  try {
    s.extSocket.send(JSON.stringify(obj));
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

export function getBridgeSnapshot(): BridgeSnapshot {
  const s = state();
  // When adopted, local socket is empty — caller should prefer remoteStatus for truth.
  // Sync best-effort snapshot from local state (daemon owner has full truth).
  const accounts = loadAccounts().map((a) => {
    // Reflect live token on first active-ish account
    if (s.flowKey && !a.flowKeyPresent) {
      return {
        ...a,
        flowKeyPresent: true,
        status: a.status === 'idle' || a.status === 'connecting' ? 'active' : a.status,
        tokenAgeMs: s.tokenCapturedAt ? Date.now() - s.tokenCapturedAt : null,
        projectId: a.projectId || s.projectId || '',
      } as FlowAccount;
    }
    return {
      ...a,
      flowKeyPresent: a.flowKeyPresent || Boolean(s.flowKey),
      tokenAgeMs: s.tokenCapturedAt ? Date.now() - s.tokenCapturedAt : a.tokenAgeMs,
      projectId: a.projectId || s.projectId || a.projectId,
    } as FlowAccount;
  });

  return {
    running: isBridgeRunning(),
    wsPort: FLOW_WS_PORT,
    httpPort: FLOW_HTTP_PORT,
    extensionConnected: Boolean(s.extSocket && s.extSocket.readyState === 1),
    flowKeyPresent: Boolean(s.flowKey),
    projectId: s.projectId,
    tokenAgeMs: s.tokenCapturedAt ? Date.now() - s.tokenCapturedAt : null,
    loginSessionOpen: s.loginSessionOpen,
    metrics: { ...s.metrics },
    accounts,
    queue: s.queue.snapshot(),
  };
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

export function handleExtMessage(raw: string): void {
  const s = state();
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === 'token_captured' && typeof msg.flowKey === 'string') {
    // Only auto-close when we explicitly opened a login window (tracked session)
    const shouldCloseLogin = Boolean(s.loginSessionOpen);
    s.flowKey = msg.flowKey;
    s.tokenCapturedAt = Date.now();
    console.log('[FlowBridge] Bearer token / session cookie captured');
    ensureTokenWatchdog();
    // Mark accounts active if any
    const accounts = loadAccounts();
    if (accounts.length) {
      for (const a of accounts) {
        if (a.status === 'connecting' || a.status === 'idle' || a.status === 'active') {
          updateAccount(a.id, {
            status: 'active',
            flowKeyPresent: true,
            projectId: a.projectId || s.projectId || '',
          });
        }
      }
    }
    // UX: user đăng nhập xong → tự đóng cửa sổ đăng nhập (giữ Chrome nền cho gen)
    if (shouldCloseLogin) {
      void (async () => {
        try {
          sendWs({
            id: newMsgId(),
            method: 'close_login_session',
            params: {},
          });
        } catch {
          /* ignore */
        }
        try {
          const { closeLoginSessionAfterCapture } = await import('./chromeSession');
          const r = await closeLoginSessionAfterCapture({ delayMs: 1800 });
          console.log('[FlowBridge] auto-close login:', r.message);
        } catch (e) {
          console.warn('[FlowBridge] auto-close login failed', e);
        }
      })();
    }
    return;
  }

  if (msg.type === 'project_id_captured' && typeof msg.projectId === 'string') {
    s.projectId = msg.projectId;
    console.log('[FlowBridge] projectId captured:', msg.projectId);
    const accounts = loadAccounts();
    for (const a of accounts) {
      if (!a.projectId) updateAccount(a.id, { projectId: msg.projectId as string });
    }
    return;
  }

  if (msg.type === 'extension_ready') {
    console.log('[FlowBridge] Extension ready', {
      flowKeyPresent: msg.flowKeyPresent,
      tokenAge: msg.tokenAge,
    });
    sendWs({ type: 'callback_secret', secret: s.callbackSecret });
    // Immediately ask extension to reload Flow tab → emit Bearer ya29
    if (!s.flowKey) {
      void commandExtension('force_token_harvest', {}, 45_000).catch((e) =>
        console.warn('[FlowBridge] force_token_harvest:', e),
      );
    }
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
}): Promise<ExtApiResponse> {
  const s = state();
  if (!s.extSocket || s.extSocket.readyState !== 1) {
    return Promise.reject(
      new Error(
        'Extension chưa kết nối bridge. Load extension AI Novel Flow Bridge + mở labs.google/fx/tools/flow.',
      ),
    );
  }
  if (!s.flowKey) {
    return Promise.reject(
      new Error(
        'Chưa có Flow token. Đăng nhập Google trên tab Flow và đợi extension capture Bearer.',
      ),
    );
  }

  const id = newMsgId();
  const timeoutMs = params.timeoutMs ?? 120_000;

  return new Promise<ExtApiResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error('Extension API timeout'));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });

    const ok = sendWs({
      id,
      method: 'api_request',
      params: {
        url: params.url,
        method: params.method || 'POST',
        headers: params.headers || {},
        body: params.body,
        captchaAction: params.captchaAction,
      },
    });
    if (!ok) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(new Error('Không gửi được message tới extension'));
    }
  });
}

export function commandExtension(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<ExtApiResponse> {
  const s = state();
  if (!s.extSocket || s.extSocket.readyState !== 1) {
    return Promise.reject(new Error('Extension offline'));
  }
  const id = newMsgId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`Extension ${method} timeout`));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });
    if (!sendWs({ id, method, params })) {
      clearTimeout(timer);
      s.pending.delete(id);
      reject(new Error('WS send failed'));
    }
  });
}

export function getProjectId(): string {
  return state().projectId || '';
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

export async function ensureBridgeStarted(): Promise<BridgeSnapshot> {
  const s = state();
  if (s.httpServer || s.adoptedExternal) return getBridgeSnapshot();

  // If something already listens (previous process), adopt instead of failing
  if (await probeExistingBridge()) {
    s.adoptedExternal = true;
    console.warn(
      `[FlowBridge] Adopted existing bridge on :${FLOW_HTTP_PORT} (another process holds the port)`,
    );
    return getBridgeSnapshot();
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

        // Extension callback
        if (url.pathname === '/api/ext/callback' && req.method === 'POST') {
          const body = await readJson(req);
          if (body.type === 'sniffed_video_request') {
            // store last sniff for debugging
            console.log('[FlowBridge] sniffed', body.url);
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
      wss.on('connection', (socket) => {
        console.log('[FlowBridge] Extension connected');
        s.extSocket = socket;
        sendWs({ type: 'callback_secret', secret: s.callbackSecret });
        socket.on('message', (data) => {
          handleExtMessage(String(data));
        });
        socket.on('close', () => {
          if (s.extSocket === socket) s.extSocket = null;
          console.log('[FlowBridge] Extension disconnected');
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
