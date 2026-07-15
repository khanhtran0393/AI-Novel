/**
 * When Next adopts an external bridge daemon (port already bound),
 * all gen/bootstrap/status go over HTTP to that daemon — never local empty queue.
 */
import { FLOW_HOST, FLOW_HTTP_PORT } from './config';
import type { BridgeSnapshot } from './types';

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

export async function remoteBootstrap(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Bootstrap is heavy; run on the process that owns the bridge.
  // If Next owns it, caller should use local bootstrapFlow.
  // This is for completeness when daemon exposes bootstrap later.
  const res = await fetch(`${base()}/api/status`, { cache: 'no-store' });
  return { ok: res.ok, note: 'use Next /api/flow/bootstrap for spawn browser' };
}

export function isRemoteBridgeMode(
  adoptedExternal: boolean,
  hasLocalServer: boolean,
): boolean {
  return adoptedExternal && !hasLocalServer;
}
