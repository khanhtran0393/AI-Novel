/**
 * When Next adopts an external bridge daemon (port already bound),
 * all gen/bootstrap/status/commands go over HTTP to that daemon —
 * never local empty socket.
 */
import { FLOW_HOST, FLOW_HTTP_PORT } from './config';
import type { BridgeSnapshot, ExtApiResponse } from './types';

const base = () => `http://${FLOW_HOST}:${FLOW_HTTP_PORT}`;

export async function remoteStatus(): Promise<BridgeSnapshot | null> {
  try {
    const res = await fetch(`${base()}/api/status`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as BridgeSnapshot;
  } catch {
    return null;
  }
}

/** Proxy extension command to the process that owns the WS socket. */
export async function remoteCommand(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<ExtApiResponse> {
  const res = await fetch(`${base()}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, timeoutMs }),
    signal: AbortSignal.timeout(Math.max(timeoutMs + 5000, 15_000)),
  });
  const json = (await res.json().catch(() => ({}))) as ExtApiResponse & {
    error?: string;
    ok?: boolean;
  };
  if (!res.ok) {
    return {
      id: 'remote',
      error: json.error || `remote command HTTP ${res.status}`,
    };
  }
  return json;
}

export async function remoteSyncAccount(accountId?: string): Promise<{
  ok: boolean;
  error?: string;
  identity?: unknown;
  snapshot?: BridgeSnapshot;
  steps?: string[];
  [k: string]: unknown;
}> {
  const res = await fetch(`${base()}/api/sync-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
    signal: AbortSignal.timeout(120_000),
  });
  return (await res.json().catch(() => ({
    ok: false,
    error: `HTTP ${res.status}`,
  }))) as {
    ok: boolean;
    error?: string;
    identity?: unknown;
    snapshot?: BridgeSnapshot;
    steps?: string[];
  };
}

export async function remoteClaimSession(accountId: string): Promise<{
  ok: boolean;
  error?: string;
  snapshot?: BridgeSnapshot;
  message?: string;
  [k: string]: unknown;
}> {
  const res = await fetch(`${base()}/api/claim-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
    signal: AbortSignal.timeout(120_000),
  });
  return (await res.json().catch(() => ({
    ok: false,
    error: `HTTP ${res.status}`,
  }))) as {
    ok: boolean;
    error?: string;
    snapshot?: BridgeSnapshot;
    message?: string;
  };
}

export async function remoteGenerateOne(
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  resultPaths?: string[];
  mediaIds?: string[];
  task?: unknown;
}> {
  const res = await fetch(`${base()}/api/generate-one`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    resultPaths?: string[];
    mediaIds?: string[];
    task?: unknown;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || `remote generate-one HTTP ${res.status}`,
    };
  }
  return {
    ok: Boolean(json.ok),
    error: json.error,
    resultPaths: json.resultPaths,
    mediaIds: json.mediaIds,
    task: json.task,
  };
}

/** Async enqueue on remote daemon (returns immediately with taskId). */
export async function remoteEnqueueGenerateOne(
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  error?: string;
  taskId?: string;
  task?: unknown;
  queueAhead?: number;
}> {
  const res = await fetch(`${base()}/api/enqueue-one`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    taskId?: string;
    task?: unknown;
    queueAhead?: number;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: json.error || `remote enqueue-one HTTP ${res.status}`,
    };
  }
  return {
    ok: Boolean(json.ok),
    error: json.error,
    taskId: json.taskId,
    task: json.task,
    queueAhead: json.queueAhead,
  };
}

export async function remoteGetTask(id: string): Promise<{
  ok: boolean;
  task?: unknown;
  error?: string;
}> {
  const res = await fetch(
    `${base()}/api/task?id=${encodeURIComponent(id)}`,
    { signal: AbortSignal.timeout(8_000), cache: 'no-store' },
  );
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    task?: unknown;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.error || `HTTP ${res.status}` };
  }
  return { ok: true, task: json.task };
}

export async function remoteBootstrap(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${base()}/api/status`, { cache: 'no-store' });
  return {
    ok: res.ok,
    note: 'use Next /api/flow/bootstrap for spawn browser',
    body,
  };
}

export function isRemoteBridgeMode(
  adoptedExternal: boolean,
  hasLocalServer: boolean,
): boolean {
  return adoptedExternal && !hasLocalServer;
}
