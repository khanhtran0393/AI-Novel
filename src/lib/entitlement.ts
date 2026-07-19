/**
 * Server-side Pro/VIP entitlement (HMAC token) — commercial ready.
 *
 * Modes:
 * - AINOVEL_ENTITLEMENT_MODE=open (dev only): Pro routes open
 * - AINOVEL_ENTITLEMENT_MODE=enforce (publish): valid HMAC token required
 *
 * Publish rules:
 * - enforce WITHOUT a strong secret → fail-closed (no Pro access, no issue)
 * - Forbidden default secrets in enforce
 * - Optional HWID bind: token.hwid must match this machine
 */

import crypto from 'crypto';
import os from 'os';
import { AppError } from '@/lib/errors';
import { getTrialStatus, trialGrantsPro } from '@/lib/commercial/trial';

export type EntitlementClaims = {
  is_pro: boolean;
  is_vip: boolean;
  exp: number; // unix seconds
  hwid?: string;
};

export type EntitlementMode = 'open' | 'enforce';

/** Known-insecure placeholders — never allowed in enforce */
const FORBIDDEN_SECRETS = new Set([
  '',
  'ainovel-local-dev-secret-change-me',
  'ainovel-enterprise-commercial-secret-key-2026',
  'change-me',
  'secret',
  'password',
  'dev',
  'test',
]);

const MIN_SECRET_LEN = 24;

export function getEntitlementMode(): EntitlementMode {
  const m = (process.env.AINOVEL_ENTITLEMENT_MODE || 'open').toLowerCase();
  return m === 'enforce' ? 'enforce' : 'open';
}

export function isPackagedPublishHint(): boolean {
  return (
    process.env.AINOVEL_PUBLISH === '1' ||
    process.env.AI_NOVEL_PACKAGED === '1' ||
    process.env.NODE_ENV === 'production'
  );
}

function rawSecretEnv(): string {
  return (
    process.env.AINOVEL_ENTITLEMENT_SECRET ||
    process.env.ENTITLEMENT_SECRET ||
    ''
  ).trim();
}

export function isInsecureEntitlementSecret(secret: string): boolean {
  const s = (secret || '').trim();
  if (!s) return true;
  if (FORBIDDEN_SECRETS.has(s)) return true;
  if (s.length < MIN_SECRET_LEN) return true;
  if (/^(.)\1{8,}$/.test(s)) return true; // aaaaaaaaa
  return false;
}

/**
 * Resolve HMAC secret.
 * - open: allow weak dev default (never used for real licenses)
 * - enforce: must be strong env secret
 */
export function resolveEntitlementSecret(): {
  secret: string;
  ok: boolean;
  reason?: string;
} {
  const mode = getEntitlementMode();
  const fromEnv = rawSecretEnv();

  if (mode === 'enforce') {
    if (!fromEnv) {
      return {
        secret: '',
        ok: false,
        reason:
          'AINOVEL_ENTITLEMENT_MODE=enforce nhưng thiếu AINOVEL_ENTITLEMENT_SECRET.',
      };
    }
    if (isInsecureEntitlementSecret(fromEnv)) {
      return {
        secret: '',
        ok: false,
        reason:
          'AINOVEL_ENTITLEMENT_SECRET quá yếu hoặc là secret mặc định. Dùng chuỗi ≥24 ký tự ngẫu nhiên.',
      };
    }
    return { secret: fromEnv, ok: true };
  }

  // open / dev
  if (fromEnv && !isInsecureEntitlementSecret(fromEnv)) {
    return { secret: fromEnv, ok: true };
  }
  return {
    secret: 'ainovel-local-dev-secret-change-me',
    ok: true,
    reason: 'dev-default-secret (open mode only)',
  };
}

function secret(): string {
  const r = resolveEntitlementSecret();
  if (!r.ok || !r.secret) {
    throw new AppError(
      r.reason ||
        'Entitlement secret chưa cấu hình. Đặt AINOVEL_ENTITLEMENT_SECRET trước khi enforce.',
      { code: 'INFRA', status: 503 },
    );
  }
  return r.secret;
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

/** Stable device fingerprint for license binding (not a hardware TPM id). */
export function getHwid(): string {
  const node = os.hostname();
  const processor = os.arch();
  const system = os.type();
  const release = os.release();
  const hwidBase = `${node}|${processor}|${system}|${release}|ainovel-v1`;
  return crypto.createHash('sha256').update(hwidBase, 'utf8').digest('hex').slice(0, 16);
}

/** Public status for UI / health (no secret leak). */
export function getEntitlementPublicStatus(): {
  mode: EntitlementMode;
  open: boolean;
  secretConfigured: boolean;
  secretInsecure: boolean;
  adminKeyConfigured: boolean;
  publishHint: boolean;
  hwid: string;
  readyForCommercial: boolean;
  blockers: string[];
} {
  const mode = getEntitlementMode();
  const fromEnv = rawSecretEnv();
  const secretConfigured = Boolean(fromEnv);
  const secretInsecure = isInsecureEntitlementSecret(fromEnv || 'ainovel-local-dev-secret-change-me');
  const adminKeyConfigured = Boolean(
    (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim(),
  );
  const blockers: string[] = [];
  if (mode !== 'enforce') {
    blockers.push('MODE chưa enforce (dev open — Pro mở tự do)');
  }
  if (!secretConfigured || secretInsecure) {
    blockers.push('Secret yếu/thiếu — không publish');
  }
  if (mode === 'enforce' && !adminKeyConfigured) {
    blockers.push('Thiếu AINOVEL_ENTITLEMENT_ADMIN_KEY (issue license)');
  }
  return {
    mode,
    open: mode === 'open',
    secretConfigured,
    secretInsecure: mode === 'enforce' ? secretInsecure || !secretConfigured : secretInsecure,
    adminKeyConfigured,
    publishHint: isPackagedPublishHint(),
    hwid: getHwid(),
    readyForCommercial: blockers.length === 0,
    blockers,
  };
}

/** Issue token for admin / seller (never call from untrusted client without admin key). */
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
  if (claims.hwid && String(claims.hwid).trim()) {
    payload.hwid = String(claims.hwid).trim().toLowerCase();
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(
    crypto.createHmac('sha256', secret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyEntitlementToken(
  token: string | null | undefined,
  options?: { requireHwidMatch?: boolean },
): EntitlementClaims | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  let sec: string;
  try {
    sec = secret();
  } catch {
    return null;
  }
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = b64url(
    crypto.createHmac('sha256', sec).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(fromB64url(body).toString('utf8')) as EntitlementClaims;
    if (!claims || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    const hwid = claims.hwid ? String(claims.hwid).trim().toLowerCase() : undefined;
    if (hwid && (options?.requireHwidMatch !== false)) {
      if (hwid !== getHwid().toLowerCase()) return null;
    }
    return {
      is_pro: !!claims.is_pro,
      is_vip: !!claims.is_vip,
      exp: claims.exp,
      ...(hwid ? { hwid } : {}),
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
 * open: always pass (desktop/dev).
 * enforce: valid token with is_pro || is_vip (+ optional HWID), or active trial.
 */
export function assertProAccess(req: Request, body?: unknown): EntitlementClaims {
  if (getEntitlementMode() === 'open') {
    return {
      is_pro: true,
      is_vip: true,
      exp: Math.floor(Date.now() / 1000) + 86400,
    };
  }

  // Owner unlimited (CISO) — never in packaged enforce without open
  try {
    // Lazy require avoided — inline env check to keep circular deps low
    const owner = (process.env.AINOVEL_OWNER_UNLIMITED || '').trim().toLowerCase();
    if (owner === '1' || owner === 'true' || owner === 'yes') {
      if (!isPackagedPublishHint()) {
        return {
          is_pro: true,
          is_vip: true,
          exp: Math.floor(Date.now() / 1000) + 86400,
        };
      }
    }
  } catch {
    /* ignore */
  }

  // Fail-closed if secret misconfigured
  const sec = resolveEntitlementSecret();
  if (!sec.ok) {
    throw new AppError(
      `License server misconfigured: ${sec.reason} Không cấp Pro cho đến khi cấu hình secret.`,
      { code: 'INFRA', status: 503 },
    );
  }

  const token = extractEntitlementToken(req, body);
  const claims = verifyEntitlementToken(token, { requireHwidMatch: true });
  if (claims && (claims.is_pro || claims.is_vip)) {
    return claims;
  }

  // Trial fallback (one HWID, time-boxed)
  if (trialGrantsPro()) {
    const st = getTrialStatus();
    return {
      is_pro: true,
      is_vip: false,
      exp: st.record?.endsAt ?? Math.floor(Date.now() / 1000) + 86400,
    };
  }

  throw new AppError(
    'Tính năng Pro/VIP: thiếu, hết hạn, hoặc token không khớp máy (HWID). Nhấp logo app → Bản quyền để dán key hoặc bật Trial 3 ngày.',
    { code: 'AUTH', status: 403 },
  );
}
