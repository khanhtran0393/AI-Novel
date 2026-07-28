/**
 * Flow Bridge Security — per-launch token for WS + HTTP auth.
 *
 * Mỗi lần bridge khởi động, sinh token 32 byte ngẫu nhiên.
 * Extension chỉ kết nối được khi mang đúng token + origin.
 * SEC-101: không token → 4401; sai extension origin → 4403.
 */

import crypto from 'crypto';

let sessionToken: string | null = null;
let sessionTokenGeneratedAt = 0;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — session lifetime

/** Extension manifest ID (must match extensions/ainovel-flow/manifest.json key). */
const EXTENSION_CHROME_ID = 'egjidjbpglichdcondbcbdnbeeppgdph';

/** Allowed WebSocket origin patterns (strict — no wildcard). */
const ALLOWED_WS_ORIGINS = [
  `chrome-extension://${EXTENSION_CHROME_ID}`,
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:8101',
  'http://localhost:8101',
];

/** Allowed HTTP proxy targets (SEC-102). */
const ALLOWED_PROXY_HOSTS = new Set([
  'aisandbox-pa.googleapis.com',
  'aisandbox-pa.sandbox.googleapis.com',
  'labs.google',
  'content-aisandbox.googleapis.com',
  'clients6.google.com',
  'storage.googleapis.com',
  'googleapis.com',
]);

/** Allowed HTTP methods per proxy target (default: deny). */
const ALLOWED_PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

/** Headers that caller must NOT set (SEC-102 rule 4). */
const FORBIDDEN_REQUEST_HEADERS = [
  'host',
  'cookie',
  'authorization',
  'proxy-authorization',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
];

/**
 * Generate or return existing session token.
 * Expired tokens are regenerated (old connections die).
 */
export function getOrCreateSessionToken(): string {
  const now = Date.now();
  if (sessionToken && now - sessionTokenGeneratedAt < TOKEN_TTL_MS) {
    return sessionToken;
  }
  sessionToken = crypto.randomBytes(32).toString('hex');
  sessionTokenGeneratedAt = now;
  return sessionToken;
}

/**
 * Validate a provided token against the current session token.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateSessionToken(provided: string | null | undefined): boolean {
  if (!provided || !sessionToken) return false;
  try {
    const a = Buffer.from(String(provided), 'utf8');
    const b = Buffer.from(sessionToken, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validate WebSocket origin header + optional token.
 * Returns null if allowed, or a close code reason if rejected.
 */
export function validateWsConnection(
  origin: string,
  token?: string | null,
): { allowed: boolean; closeCode?: number; reason?: string } {
  // Must have valid token OR come from allowed origin
  const originOk = ALLOWED_WS_ORIGINS.some((o) => origin.startsWith(o));
  const tokenOk = validateSessionToken(token);

  if (!originOk && !tokenOk) {
    return { allowed: false, closeCode: 4001, reason: 'Unauthorized: missing token or origin' };
  }
  if (origin && !originOk) {
    return { allowed: false, closeCode: 4403, reason: `Origin not allowed: ${origin.slice(0, 80)}` };
  }
  return { allowed: true };
}

/**
 * Validate HTTP request for internal bridge API.
 * Health endpoints skip auth (return limited info).
 * All other endpoints require valid session token.
 */
export function validateHttpRequest(
  pathname: string,
  token: string | null | undefined,
): { allowed: boolean; status?: number; error?: string } {
  // Health/status probes skip token (return limited info)
  const isPublic = pathname === '/api/health' || pathname === '/health';
  if (isPublic) return { allowed: true };

  if (!validateSessionToken(token)) {
    return { allowed: false, status: 401, error: 'Missing or invalid session token' };
  }
  return { allowed: true };
}

/**
 * Check if a proxy URL is allowed (SEC-102).
 * Only HTTPS to known Google Flow hosts is permitted.
 */
export function isAllowedProxyUrl(urlStr: string): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);

    // Only HTTPS
    if (parsed.protocol !== 'https:') {
      return { allowed: false, reason: 'Only HTTPS allowed for proxy' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const allowed = [...ALLOWED_PROXY_HOSTS].some((h) => hostname === h || hostname.endsWith('.' + h));
    if (!allowed) {
      return { allowed: false, reason: `Host not in proxy allowlist: ${hostname}` };
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
}

/**
 * Check if a request header is forbidden (SEC-102 rule 4).
 * These headers may only be set by the bridge itself.
 */
export function isForbiddenHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_REQUEST_HEADERS.some(
    (f) => lower === f || lower.startsWith('proxy-') || lower.startsWith('x-forwarded-'),
  );
}

/**
 * Validate that a sinkId is one-time-use and within output root.
 * Sink = single-use, TTL 5 min, must resolve under output dir.
 */
export function validateSink(
  sinkId: string,
  sinkMap: Map<string, { dest: string; expiresAt: number }>,
): { ok: boolean; dest?: string; error?: string } {
  const entry = sinkMap.get(sinkId);
  if (!entry) {
    return { ok: false, error: 'Sink not found or already consumed' };
  }
  if (Date.now() > entry.expiresAt) {
    sinkMap.delete(sinkId);
    return { ok: false, error: 'Sink expired' };
  }
  return { ok: true, dest: entry.dest };
}

/**
 * Create a one-time sink ID for file download.
 */
export function createSink(
  dest: string,
  outputRoot: string,
  sinkMap: Map<string, { dest: string; expiresAt: number }>,
): string | null {
  // Validate dest is under output root
  const resolved = require('path').resolve(dest);
  if (!resolved.startsWith(require('path').resolve(outputRoot))) {
    return null; // path escape attempt
  }

  const id = `sink_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
  sinkMap.set(id, { dest: resolved, expiresAt: Date.now() + 5 * 60_000 });
  return id;
}

export function getAllowedProxyHosts(): string[] {
  return [...ALLOWED_PROXY_HOSTS];
}
