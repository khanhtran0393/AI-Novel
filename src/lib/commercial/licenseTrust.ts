/**
 * License API trust: host pin + optional TLS SPKI pin + packaged fail-closed helpers.
 *
 * - Ed25519 still owns token authenticity (server fake cannot mint Pro).
 * - This layer stops the client from talking to untrusted license endpoints
 *   and fails closed when the public keyring is missing on packaged builds.
 */
import crypto from 'crypto';
import https from 'https';
import tls from 'tls';
import type { PeerCertificate } from 'tls';
import { AppError } from '@/lib/errors';

/** Hard-coded production hosts — cannot be expanded from customer .env.commercial. */
export const BUILTIN_LICENSE_API_HOSTS = [
  'ai-novel-flax.vercel.app',
] as const;

/** Update feed hosts allowed for desktop auto-update (HTTPS only). */
export const BUILTIN_UPDATE_FEED_HOSTS = [
  'azlizrbjkqcyqnsmuccv.supabase.co',
] as const;

export function isCustomerPackagedRuntime(): boolean {
  return (
    process.env.AI_NOVEL_PACKAGED === '1' || process.env.AINOVEL_PUBLISH === '1'
  );
}

function parseHostList(raw: string | undefined | null): string[] {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((h) => h.replace(/^https?:\/\//, '').split('/')[0] || '')
    .filter(Boolean);
}

/**
 * Hosts the app may call for license API.
 * Allowlist only — never auto-add AINOVEL_LICENSE_API_URL host (customer cannot
 * expand pin by pointing URL at a rogue domain).
 * Packaged: builtin ∪ AINOVEL_LICENSE_API_HOSTS (bundled public.env only).
 * Dev: + localhost for smoke.
 */
export function getPinnedLicenseHosts(): string[] {
  const set = new Set<string>([
    ...BUILTIN_LICENSE_API_HOSTS.map((h) => h.toLowerCase()),
    ...parseHostList(process.env.AINOVEL_LICENSE_API_HOSTS),
  ]);
  if (!isCustomerPackagedRuntime()) {
    set.add('localhost');
    set.add('127.0.0.1');
  }
  return [...set];
}

export function getPinnedUpdateFeedHosts(): string[] {
  const set = new Set<string>([
    ...BUILTIN_UPDATE_FEED_HOSTS.map((h) => h.toLowerCase()),
    ...parseHostList(process.env.AINOVEL_UPDATE_FEED_HOSTS),
  ]);
  return [...set];
}

/**
 * Optional TLS SPKI pins (SHA-256 of SubjectPublicKeyInfo).
 * Formats accepted (comma-separated):
 *   BASE64
 *   sha256/BASE64
 *   hex (64 chars)
 * Empty = standard WebPKI only (still HTTPS + host pin).
 */
export function getLicenseTlsPins(): string[] {
  return normalizePinList(process.env.AINOVEL_LICENSE_TLS_PINS);
}

function normalizePinList(raw: string | undefined | null): string[] {
  const out = new Set<string>();
  for (const part of String(raw || '').split(/[,\s]+/)) {
    let p = part.trim();
    if (!p) continue;
    if (p.toLowerCase().startsWith('sha256/')) p = p.slice('sha256/'.length);
    if (/^[0-9a-f]{64}$/i.test(p)) {
      out.add(Buffer.from(p, 'hex').toString('base64'));
    } else {
      out.add(p);
    }
  }
  return [...out];
}

export function spkiSha256Base64FromCert(cert: PeerCertificate): string {
  const raw = (cert as PeerCertificate & { raw?: Buffer }).raw;
  if (!raw || !Buffer.isBuffer(raw)) {
    throw new Error('Peer certificate raw DER unavailable for TLS pin');
  }
  // Prefer X509Certificate when available (Node 15.6+)
  try {
    const x509 = new crypto.X509Certificate(raw);
    const spki = x509.publicKey.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(spki).digest('base64');
  } catch {
    const key = crypto.createPublicKey(raw);
    const spki = key.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(spki).digest('base64');
  }
}

export function assertHostPinned(
  hostname: string,
  allowed: string[],
  label = 'License API',
): void {
  const host = hostname.toLowerCase();
  if (!allowed.includes(host)) {
    throw new AppError(
      `${label} host «${host}» không nằm trong allowlist đã pin ` +
        `[${allowed.join(', ') || 'empty'}]. ` +
        'Chỉ dùng endpoint chính thức (public.env / seller).',
      { code: 'AUTH', status: 403 },
    );
  }
}

/** Validate and return license API base URL (HTTPS + host pin). */
export function resolvePinnedLicenseApiUrl(): URL {
  const raw = String(process.env.AINOVEL_LICENSE_API_URL || '').trim();
  if (!raw) {
    throw new AppError(
      'Thiếu AINOVEL_LICENSE_API_URL (pin license API).',
      { code: 'INFRA', status: 503 },
    );
  }
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new AppError('AINOVEL_LICENSE_API_URL không hợp lệ.', {
      code: 'INFRA',
      status: 503,
    });
  }
  if (base.protocol !== 'https:') {
    // Dev exception: localhost http only when not packaged
    const local =
      !isCustomerPackagedRuntime() &&
      (base.hostname === 'localhost' || base.hostname === '127.0.0.1') &&
      base.protocol === 'http:';
    if (!local) {
      throw new AppError('License API phải là HTTPS (pin).', {
        code: 'INFRA',
        status: 503,
      });
    }
  }
  if (base.username || base.password) {
    throw new AppError('License API URL không được chứa userinfo.', {
      code: 'AUTH',
      status: 403,
    });
  }
  if (
    base.hostname === 'example.com' ||
    base.hostname.endsWith('.example.com')
  ) {
    throw new AppError('License API production phải là HTTPS host thật.', {
      code: 'INFRA',
      status: 503,
    });
  }
  assertHostPinned(base.hostname, getPinnedLicenseHosts(), 'License API');
  return base;
}

export function assertUpdateFeedUrlPinned(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  try {
    assertHostPinned(u.hostname, getPinnedUpdateFeedHosts(), 'Update feed');
  } catch {
    return null;
  }
  return u.toString().replace(/\/$/, '');
}

export type LicenseTrustStatus = {
  packaged: boolean;
  licenseApiUrl: string | null;
  licenseApiHostPinned: boolean;
  pinnedHosts: string[];
  tlsPinsConfigured: number;
  tlsPinningActive: boolean;
};

export function getLicenseTrustStatus(): LicenseTrustStatus {
  const raw = String(process.env.AINOVEL_LICENSE_API_URL || '').trim();
  let hostPinned = false;
  let url: string | null = raw || null;
  try {
    const u = resolvePinnedLicenseApiUrl();
    url = u.origin;
    hostPinned = true;
  } catch {
    hostPinned = false;
  }
  const pins = getLicenseTlsPins();
  return {
    packaged: isCustomerPackagedRuntime(),
    licenseApiUrl: url,
    licenseApiHostPinned: hostPinned,
    pinnedHosts: getPinnedLicenseHosts(),
    tlsPinsConfigured: pins.length,
    tlsPinningActive: pins.length > 0,
  };
}

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/**
 * HTTPS request to license API with host pin + optional SPKI pin.
 * When no TLS pins: uses global fetch (WebPKI). When pins set: https + pin check.
 */
export async function fetchPinnedLicenseApi(
  absoluteUrl: string,
  init: FetchInit = {},
): Promise<{ status: number; bodyText: string }> {
  const target = new URL(absoluteUrl);
  assertHostPinned(target.hostname, getPinnedLicenseHosts(), 'License API');
  if (
    target.protocol !== 'https:' &&
    !(
      !isCustomerPackagedRuntime() &&
      target.protocol === 'http:' &&
      (target.hostname === 'localhost' || target.hostname === '127.0.0.1')
    )
  ) {
    throw new AppError('License API chỉ HTTPS.', { code: 'INFRA', status: 503 });
  }

  const pins = getLicenseTlsPins();
  const timeoutMs = init.timeoutMs ?? 15_000;
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };

  // Local http dev
  if (target.protocol === 'http:') {
    const res = await fetch(absoluteUrl, {
      method,
      headers,
      body: init.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  }

  if (pins.length === 0) {
    const res = await fetch(absoluteUrl, {
      method,
      headers,
      body: init.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        servername: target.hostname,
        timeout: timeoutMs,
        checkServerIdentity: (host, cert) => {
          const baseErr = tls.checkServerIdentity(host, cert);
          if (baseErr) return baseErr;
          try {
            const hash = spkiSha256Base64FromCert(cert);
            if (!pins.includes(hash)) {
              return new Error(
                `TLS SPKI pin mismatch for ${host} (got sha256/${hash})`,
              );
            }
          } catch (e) {
            return e instanceof Error ? e : new Error(String(e));
          }
          return undefined;
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`License API timeout ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
