/**
 * TLS-impersonated HTTP client (Chrome 131 PSK profile) for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Wraps `node-tls-client` (bogdanfinn/tls-client Go binary).
 * JA3 / JA4 / HTTP/2 frame ordering match real Chrome — required because
 * Google reCAPTCHA Enterprise scoring penalises default Node fingerprints with
 * 403 PUBLIC_ERROR_UNUSUAL_ACTIVITY.
 *
 * JA3: a19ab9f02aacf42deddc1f2acb3d3f63
 * JA4: t13d1516h2_8daaf6152771_02713d6af862
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type TlsClientLib = typeof import('node-tls-client');

const sessionByProfile = new Map<string, any>();
const requestCountByProfile = new Map<string, number>();

let initTLSPromise: Promise<void> | null = null;
let TlsLib: TlsClientLib | null = null;

function getPreventiveRecycleThreshold(): number {
  const raw = process.env.VEO3_PREVENTIVE_TLS_RECYCLE_THRESHOLD;
  if (raw == null || raw === '') return 15;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15;
  return Math.floor(n);
}

export async function ensureTlsReady(): Promise<TlsClientLib> {
  if (!TlsLib) {
    TlsLib = require('node-tls-client');
  }
  if (!initTLSPromise) {
    initTLSPromise = (async () => {
      await TlsLib!.initTLS();
      console.log('[TlsClient] Initialised node-tls-client (chrome_131_psk)');
    })().catch((err) => {
      initTLSPromise = null;
      throw err;
    });
  }
  await initTLSPromise;
  return TlsLib!;
}

export function warmUpTlsClient(): void {
  ensureTlsReady().catch((err) => {
    console.warn(`[TlsClient] Warm-up failed (will retry lazily): ${err?.message || err}`);
  });
}

function patchCookieJar(session: any): void {
  const jar = session?.jar;
  if (!jar || typeof jar.syncCookies !== 'function' || jar.__veo3Patched) return;
  jar.__veo3Patched = true;
  const orig = jar.setCookie.bind(jar);
  jar.syncCookies = async (cookies: Record<string, string>, url: string) => {
    if (!cookies) return {};
    const result: Record<string, string> = {};
    await Promise.all(
      Object.entries(cookies).map(async ([key, value]) => {
        try {
          const cookie = await orig(`${key}=${value}`, url);
          if (cookie && typeof cookie === 'object' && 'key' in cookie) {
            result[cookie.key] = cookie.value;
          }
        } catch {
          /* skip unparseable cookie */
        }
      }),
    );
    return result;
  };
}

async function getSession(profileId: string, proxyUrl?: string): Promise<any> {
  const lib = await ensureTlsReady();
  let s = sessionByProfile.get(profileId);
  if (!s) {
    s = new lib.Session({
      sessionId: `ainovel-${profileId.slice(0, 12)}`,
      clientIdentifier: lib.ClientIdentifier.chrome_131_psk,
      timeout: 180000,
      randomTlsExtensionOrder: false,
      proxy: proxyUrl,
    });
    patchCookieJar(s);
    sessionByProfile.set(profileId, s);
  } else if (proxyUrl !== undefined) {
    try {
      s.config = { ...(s.config ?? {}), proxy: proxyUrl };
    } catch {
      /* ignore */
    }
  }
  return s;
}

export interface TlsFetchOptions {
  profileId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cookies?: string;
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface TlsFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  setCookies: string[];
  durationMs: number;
}

export async function tlsFetch(opts: TlsFetchOptions): Promise<TlsFetchResponse> {
  const t0 = Date.now();
  const session = await getSession(opts.profileId, opts.proxyUrl);
  const method = (opts.method ?? 'POST').toUpperCase();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  if (opts.cookies && opts.cookies.length > 0) {
    headers['Cookie'] = opts.cookies;
  }

  const reqOpts: any = {
    headers,
    followRedirects: true,
  };
  if (opts.proxyUrl) reqOpts.proxy = opts.proxyUrl;
  if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    reqOpts.body = opts.body;
  }

  let resp: any;
  switch (method) {
    case 'GET':
      resp = await session.get(opts.url, reqOpts);
      break;
    case 'POST':
      resp = await session.post(opts.url, reqOpts);
      break;
    case 'PUT':
      resp = await session.put(opts.url, reqOpts);
      break;
    case 'PATCH':
      resp = await session.patch(opts.url, reqOpts);
      break;
    case 'DELETE':
      resp = await session.delete(opts.url, reqOpts);
      break;
    case 'HEAD':
      resp = await session.head(opts.url, reqOpts);
      break;
    case 'OPTIONS':
      resp = await session.options(opts.url, reqOpts);
      break;
    default:
      throw new Error(`tlsFetch: unsupported method ${method}`);
  }

  const status = Number(resp?.status ?? 0);
  const body = typeof resp?.text === 'function' ? await resp.text() : String(resp?.body ?? '');
  const rawHeaders = resp?.headers ?? {};
  const flatHeaders: Record<string, string> = {};
  const setCookies: string[] = [];

  for (const [k, v] of Object.entries(rawHeaders)) {
    const key = k.toLowerCase();
    if (key === 'set-cookie') {
      if (Array.isArray(v)) setCookies.push(...(v as string[]));
      else if (typeof v === 'string') setCookies.push(v);
      flatHeaders[key] = Array.isArray(v) ? (v as string[]).join('; ') : String(v);
    } else {
      flatHeaders[key] = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
    }
  }

  // Preventive session recycle — break HTTP/2 connection every N successful requests
  if (status >= 200 && status < 400) {
    const threshold = getPreventiveRecycleThreshold();
    if (threshold > 0) {
      const n = (requestCountByProfile.get(opts.profileId) ?? 0) + 1;
      if (n >= threshold) {
        requestCountByProfile.set(opts.profileId, 0);
        setImmediate(() => recycleTlsSession(opts.profileId, 'preventive-cycle'));
      } else {
        requestCountByProfile.set(opts.profileId, n);
      }
    }
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    body,
    headers: flatHeaders,
    setCookies,
    durationMs: Date.now() - t0,
  };
}

export async function disposeTlsSession(profileId: string): Promise<void> {
  requestCountByProfile.delete(profileId);
  const s = sessionByProfile.get(profileId);
  if (!s) return;
  sessionByProfile.delete(profileId);
  try {
    await s.close?.();
  } catch (e: any) {
    console.warn(`[TlsClient] session.close failed for ${profileId.slice(0, 8)}: ${e?.message || e}`);
  }
}

export function recycleTlsSession(profileId: string, reason: string): void {
  requestCountByProfile.delete(profileId);
  const s = sessionByProfile.get(profileId);
  if (!s) return;
  sessionByProfile.delete(profileId);
  console.warn(`[TlsClient] recycling TLS session for ${profileId.slice(0, 8)} (${reason})`);
  setImmediate(() => {
    s.close?.().catch(() => {});
  });
}

export async function shutdownTlsClient(): Promise<void> {
  const ids = Array.from(sessionByProfile.keys());
  await Promise.allSettled(ids.map((id) => disposeTlsSession(id)));
  try {
    if (TlsLib?.destroyTLS) await TlsLib.destroyTLS();
  } catch {
    /* best-effort */
  }
}
