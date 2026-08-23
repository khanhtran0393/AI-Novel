/**
 * Single dispatch point for outbound requests to labs.google / aisandbox-pa.googleapis.com
 * Exact reference implementation from SuperAutoTools.
 *
 * All requests go through `tlsFetch` (chrome_131_PSK JA3 + HTTP/2) so the
 * JA3/JA4 fingerprint matches real Chrome — required because Google
 * reCAPTCHA Enterprise scoring penalises default Node fingerprints.
 */

import { tlsFetch, recycleTlsSession } from './tlsClient';

function deriveChromeMajor(userAgent: string): number {
  const match = /Chrome\/(\d+)/.exec(userAgent);
  if (!match) return 148;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) && major > 0 ? major : 148;
}

function rewriteUaChromeMajor(userAgent: string, major: number): string {
  return userAgent.replace(/Chrome\/\d+(?:\.\d+)*/, `Chrome/${major}.0.0.0`);
}

function envChromeMajor(): number | null {
  const n = Number.parseInt(process.env.VEO3_CHROME_MAJOR ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function deriveSecChUa(chromeMajor: number): string {
  const notABrand = chromeMajor >= 129 ? '"Not(A:Brand";v="99"' : '"Not_A Brand";v="8"';
  return `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", ${notABrand}`;
}

function deriveSecChUaPlatform(userAgent: string): string {
  if (/Windows/i.test(userAgent)) return '"Windows"';
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return '"Linux"';
  if (/Android/i.test(userAgent)) return '"Android"';
  return '"macOS"';
}

const FALLBACK_UA =
  process.platform === 'win32'
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    : process.platform === 'linux'
      ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export interface GoogleFetchOptions {
  profileId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cookies?: string;
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface GoogleFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  text: () => Promise<string>;
  json: <T = any>() => Promise<T>;
}

export async function googleFetch(opts: GoogleFetchOptions): Promise<GoogleFetchResponse> {
  if (!opts.profileId) throw new Error('googleFetch requires profileId');
  if (!opts.url) throw new Error('googleFetch requires url');

  const isCrossOriginApi = /^https:\/\/[^/]*googleapis\.com\b/i.test(opts.url);
  const proxyUrl = opts.proxyUrl;
  const isLabsGoogle = /^https:\/\/labs\.google\b/.test(opts.url);

  const callerUA = opts.headers?.['User-Agent'] ?? opts.headers?.['user-agent'];
  const derivedUA = callerUA || FALLBACK_UA;

  const forcedMajor = envChromeMajor();
  const effectiveUA = forcedMajor ? rewriteUaChromeMajor(derivedUA, forcedMajor) : derivedUA;
  const chromeMajor = forcedMajor ?? deriveChromeMajor(effectiveUA);

  const baseHeaders: Record<string, string> = {
    'User-Agent': effectiveUA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    Origin: 'https://labs.google',
    Referer: 'https://labs.google/',
    'sec-ch-ua': deriveSecChUa(chromeMajor),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': deriveSecChUaPlatform(effectiveUA),
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': isLabsGoogle ? 'same-origin' : 'cross-site',
    Priority: 'u=1, i',
  };

  const finalHeaders: Record<string, string> = { ...baseHeaders };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    const kl = k.toLowerCase();
    for (const bk of Object.keys(finalHeaders)) {
      if (bk.toLowerCase() === kl) delete finalHeaders[bk];
    }
    finalHeaders[k] = v;
  }

  if (forcedMajor) {
    for (const k of Object.keys(finalHeaders)) {
      const kl = k.toLowerCase();
      if (kl === 'user-agent') {
        finalHeaders[k] = rewriteUaChromeMajor(finalHeaders[k], forcedMajor);
      } else if (kl === 'sec-ch-ua') {
        finalHeaders[k] = deriveSecChUa(forcedMajor);
      }
    }
  }

  const isGenSubmit = /flowMedia:batchGenerate|video:batch|video:upsample|flow\/upsampleImage/.test(opts.url);
  const defaultTimeoutMs = isGenSubmit ? 60000 : 30000;

  const resp = await tlsFetch({
    profileId: opts.profileId,
    url: opts.url,
    method: opts.method ?? 'POST',
    headers: finalHeaders,
    body: opts.body,
    cookies: opts.cookies ?? '',
    proxyUrl,
    timeoutMs: opts.timeoutMs ?? defaultTimeoutMs,
  });

  const isRecaptcha403 =
    resp.status === 403 &&
    /PUBLIC_ERROR_UNUSUAL_ACTIVITY|reCAPTCHA evaluation failed/i.test(resp.body);
  const isConnectionTimeout = resp.status === 0;

  if (isRecaptcha403 || isConnectionTimeout) {
    console.warn(
      `[googleFetch] 403 / Timeout detected for profile=${opts.profileId} (is403=${isRecaptcha403}, isTimeout=${isConnectionTimeout}) -> Recycling TLS Session`,
    );
    recycleTlsSession(opts.profileId, isRecaptcha403 ? '403-unusual-activity' : 'connection-timeout');
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    body: resp.body,
    headers: resp.headers,
    durationMs: resp.durationMs,
    text: async () => resp.body,
    json: async <T = any>() => {
      try {
        return JSON.parse(resp.body) as T;
      } catch (error: any) {
        throw new Error(
          `googleFetch.json() failed for ${opts.method ?? 'POST'} ${opts.url}: ${error?.message || error}`,
        );
      }
    },
  };
}
