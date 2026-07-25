/**
 * Drop-in fetch that routes through off-GUI host (utilityProcess / Worker).
 * Returns a Response-like object so existing call sites need minimal changes.
 */

import {
  offThreadFetch,
  resolveAbsoluteApiUrl,
  type OffThreadFetchResult,
} from './offThreadHost';

export type OffThreadResponse = {
  ok: boolean;
  status: number;
  headers: {
    get: (name: string) => string | null;
  };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  /** Diagnostic */
  _offThreadMode?: OffThreadFetchResult['mode'];
};

/**
 * fetch() replacement for media/API routes — network wait is off GUI thread.
 */
export async function offThreadFetchResponse(
  input: string,
  init?: RequestInit,
): Promise<OffThreadResponse> {
  const url = resolveAbsoluteApiUrl(String(input));
  const method = String(init?.method || 'GET');
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else {
      Object.assign(headers, init.headers as Record<string, string>);
    }
  }
  let body: string | undefined;
  if (init?.body != null) {
    body = typeof init.body === 'string' ? init.body : String(init.body);
  }

  const r = await offThreadFetch(url, { method, headers, body });
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers || {})) {
    lower[k.toLowerCase()] = v;
  }

  return {
    ok: r.ok,
    status: r.status,
    headers: {
      get: (name: string) => lower[String(name).toLowerCase()] ?? null,
    },
    json: async () => {
      try {
        return JSON.parse(r.bodyText || '{}');
      } catch {
        return {};
      }
    },
    text: async () => r.bodyText || '',
    _offThreadMode: r.mode,
  };
}
