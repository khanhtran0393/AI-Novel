/**
 * Server-side Pro/VIP entitlement (HMAC token).
 *
 * Modes:
 * - AINOVEL_ENTITLEMENT_MODE=open (default desktop/dev): allow all Pro features
 * - AINOVEL_ENTITLEMENT_MODE=enforce: require valid signed token
 *
 * Client issues token via Electron/main or Settings using AINOVEL_ENTITLEMENT_SECRET
 * (same secret on server). Token payload: { is_pro, is_vip, exp }
 */

import crypto from 'crypto';
import { AppError } from '@/lib/errors';

export type EntitlementClaims = {
  is_pro: boolean;
  is_vip: boolean;
  exp: number; // unix seconds
};

export type EntitlementMode = 'open' | 'enforce';

export function getEntitlementMode(): EntitlementMode {
  const m = (process.env.AINOVEL_ENTITLEMENT_MODE || 'open').toLowerCase();
  return m === 'enforce' ? 'enforce' : 'open';
}

function secret(): string {
  return (
    process.env.AINOVEL_ENTITLEMENT_SECRET ||
    process.env.ENTITLEMENT_SECRET ||
    'ainovel-local-dev-secret-change-me'
  );
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/** Issue token for client (Electron preload / admin tool). */
export function issueEntitlementToken(
  claims: Omit<EntitlementClaims, 'exp'> & { expSeconds?: number },
): string {
  const exp =
    Math.floor(Date.now() / 1000) + (claims.expSeconds ?? 60 * 60 * 24 * 30);
  const payload: EntitlementClaims = {
    is_pro: !!claims.is_pro,
    is_vip: !!claims.is_vip,
    exp,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', secret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyEntitlementToken(
  token: string | null | undefined,
): EntitlementClaims | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = b64url(
    crypto.createHmac('sha256', secret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(fromB64url(body).toString('utf8')) as EntitlementClaims;
    if (!claims || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      is_pro: !!claims.is_pro,
      is_vip: !!claims.is_vip,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}

export function extractEntitlementToken(req: Request, body?: unknown): string | null {
  const h =
    req.headers.get('x-ainovel-entitlement') ||
    req.headers.get('x-entitlement-token');
  if (h && h.trim()) return h.trim();
  if (body && typeof body === 'object' && body !== null) {
    const t = (body as { entitlementToken?: string }).entitlementToken;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

/**
 * Assert Pro/VIP for premium routes.
 * open mode: always pass (desktop default).
 * enforce mode: valid token with is_pro || is_vip.
 */
export function assertProAccess(req: Request, body?: unknown): EntitlementClaims {
  if (getEntitlementMode() === 'open') {
    return {
      is_pro: true,
      is_vip: true,
      exp: Math.floor(Date.now() / 1000) + 86400,
    };
  }
  const token = extractEntitlementToken(req, body);
  const claims = verifyEntitlementToken(token);
  if (!claims || (!claims.is_pro && !claims.is_vip)) {
    throw new AppError(
      'Tính năng Pro/VIP: thiếu hoặc hết hạn entitlement token. Bật AINOVEL_ENTITLEMENT_MODE=open (dev) hoặc cấp token hợp lệ.',
      { code: 'AUTH', status: 403 },
    );
  }
  return claims;
}
