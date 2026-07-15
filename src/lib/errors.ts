/**
 * App error taxonomy — one shape for API + modules + toast.
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'AUTH'
  | 'QUOTA'
  | 'NOT_FOUND'
  | 'PROVIDER'
  | 'INFRA'
  | 'USER'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    opts?: { code?: ErrorCode; status?: number; details?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = opts?.code || 'UNKNOWN';
    this.status = opts?.status ?? statusForCode(this.code);
    this.details = opts?.details;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION':
      return 400;
    case 'AUTH':
      return 401;
    case 'QUOTA':
      return 429;
    case 'NOT_FOUND':
      return 404;
    case 'USER':
      return 400;
    case 'PROVIDER':
      return 502;
    case 'INFRA':
      return 503;
    default:
      return 500;
  }
}

export type ErrorJson = {
  error: string;
  code: ErrorCode;
  details?: unknown;
  correlationId?: string;
};

export function toErrorJson(err: unknown, correlationId?: string): ErrorJson {
  const base =
    err instanceof AppError
      ? {
          error: err.message,
          code: err.code,
          ...(err.details !== undefined ? { details: err.details } : {}),
        }
      : err instanceof Error
        ? { error: err.message, code: 'UNKNOWN' as ErrorCode }
        : { error: String(err || 'Unknown error'), code: 'UNKNOWN' as ErrorCode };
  return correlationId ? { ...base, correlationId } : base;
}

export function httpStatusFromError(err: unknown): number {
  if (err instanceof AppError) return err.status;
  return 500;
}

/** Map common provider messages → taxonomy */
export function classifyProviderMessage(message: string): ErrorCode {
  const m = (message || '').toLowerCase();
  if (/quota|rate limit|429|resource exhausted/.test(m)) return 'QUOTA';
  if (/api key|unauthorized|401|403|invalid key|cookie/.test(m)) return 'AUTH';
  if (/not found|404/.test(m)) return 'NOT_FOUND';
  if (/timeout|econnrefused|enotfound|network|fetch failed/.test(m)) return 'INFRA';
  if (/validation|invalid|missing|required/.test(m)) return 'VALIDATION';
  return 'PROVIDER';
}
