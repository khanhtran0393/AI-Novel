/**
 * Request correlation + structured logging for hot APIs.
 */
import { redactDeep, maskSecretsInText } from '@/lib/secrets';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function newCorrelationId(prefix = 'req'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Prefer client-provided id; else mint one. */
export function correlationIdFromRequest(req: Request): string {
  const h =
    req.headers.get('x-correlation-id') ||
    req.headers.get('x-request-id') ||
    '';
  const trimmed = h.trim();
  if (trimmed && trimmed.length <= 128) return trimmed;
  return newCorrelationId();
}

export type StructuredLog = {
  level: LogLevel;
  msg: string;
  correlationId?: string;
  route?: string;
  chapter?: number | string;
  scene?: number | string;
  provider?: string;
  code?: string;
  durationMs?: number;
  [key: string]: unknown;
};

export function slog(entry: StructuredLog): void {
  const safe = redactDeep(entry) as StructuredLog;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...safe,
    msg: maskSecretsInText(String(safe.msg || '')),
  });
  if (safe.level === 'error') console.error(line);
  else if (safe.level === 'warn') console.warn(line);
  else console.log(line);
}

export function withCorrelationHeaders(
  init: ResponseInit | undefined,
  correlationId: string,
): ResponseInit {
  const headers = new Headers(init?.headers);
  headers.set('x-correlation-id', correlationId);
  return { ...init, headers };
}
