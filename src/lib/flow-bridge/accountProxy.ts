/**
 * Account capability parity: anything the Google Flow account can do in the
 * browser, the app can invoke through the same session (cookies + Bearer +
 * captcha) and receive the full result (JSON or binary media).
 */
import fs from 'fs';
import path from 'path';
import type { ExtApiResponse } from './types';

export type ProxyAsAccountOpts = {
  accountId: string;
  /** HTTP API on aisandbox / labs (captcha-aware when body has recaptchaContext) */
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  captchaAction?: string;
  timeoutMs?: number;
  /** trpc = labs.google tRPC; api = default aisandbox/media */
  mode?: 'api' | 'trpc';
};

export type ProxyAsAccountResult = {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  accountId: string;
};

/** Call any Flow/labs API as this account — same session the browser uses. */
export async function proxyAsAccount(
  opts: ProxyAsAccountOpts,
): Promise<ProxyAsAccountResult> {
  const accountId = String(opts.accountId || '').trim();
  if (!accountId) {
    return { ok: false, error: 'accountId required', accountId: '' };
  }
  const bridge = await import('./bridgeServer');
  const mode = opts.mode || 'api';
  try {
    if (mode === 'trpc') {
      const res = await bridge.commandExtension(
        'trpc_request',
        {
          url: opts.url,
          method: opts.method || 'POST',
          headers: opts.headers || { 'Content-Type': 'application/json' },
          body: opts.body,
          flowKey: bridge.getAccountFlowKey(accountId) || undefined,
          accessToken: bridge.getAccountFlowKey(accountId) || undefined,
        },
        opts.timeoutMs ?? 120_000,
        accountId,
      );
      return normalizeExt(res, accountId);
    }
    const res = await bridge.requestViaExtension({
      url: opts.url,
      method: opts.method || 'POST',
      headers: opts.headers,
      body: opts.body,
      captchaAction: opts.captchaAction,
      timeoutMs: opts.timeoutMs ?? 180_000,
      accountId,
    });
    return normalizeExt(res, accountId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      accountId,
    };
  }
}

function normalizeExt(
  res: ExtApiResponse,
  accountId: string,
): ProxyAsAccountResult {
  const status = res.status;
  const err = res.error ? String(res.error) : undefined;
  const ok = !err && !(status && status >= 400);
  return {
    ok,
    status,
    data: res.data !== undefined ? res.data : res.result,
    error: err,
    accountId,
  };
}

/**
 * Download media bytes the account can open — try Node+Bearer first, then
 * extension cookies (download_binary). Writes file to destPath.
 */
export async function downloadAsAccount(
  accountId: string,
  url: string,
  destPath: string,
): Promise<{ ok: boolean; bytes: number; via: string; error?: string }> {
  const aid = String(accountId || '').trim();
  const u = String(url || '').trim();
  if (!u) return { ok: false, bytes: 0, via: 'none', error: 'url required' };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const bridge = await import('./bridgeServer');
  const key = bridge.getAccountFlowKey(aid);

  // 1) Node fetch with account Bearer (signed fife URLs + auth media)
  try {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(u, { headers });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 64) {
        fs.writeFileSync(destPath, buf);
        return { ok: true, bytes: buf.length, via: 'node+bearer' };
      }
    }
  } catch {
    /* fall through */
  }

  // 2) Extension: same cookies + Bearer as browser tab
  try {
    const res = await bridge.commandExtension(
      'download_binary',
      {
        url: u,
        flowKey: key || undefined,
        accessToken: key || undefined,
        destPath,
        sinkUrl: 'http://127.0.0.1:8101/internal/receive-binary',
      },
      180_000,
      aid,
    );
    if (res.error) {
      return {
        ok: false,
        bytes: 0,
        via: 'extension',
        error: String(res.error),
      };
    }
    const result = (res.result || res.data || {}) as Record<string, unknown>;
    if (typeof result.base64 === 'string' && result.base64.length > 8) {
      const buf = Buffer.from(result.base64, 'base64');
      fs.writeFileSync(destPath, buf);
      return {
        ok: true,
        bytes: buf.length,
        via: 'extension-base64',
      };
    }
    // Large file may have been written by HTTP sink
    const sinkDest = String(result.destPath || '').trim();
    if (sinkDest && fs.existsSync(sinkDest) && fs.statSync(sinkDest).size > 64) {
      if (path.resolve(sinkDest) !== path.resolve(destPath)) {
        fs.copyFileSync(sinkDest, destPath);
      }
      return {
        ok: true,
        bytes: fs.statSync(destPath).size,
        via: 'extension-sink',
      };
    }
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 64) {
      return {
        ok: true,
        bytes: fs.statSync(destPath).size,
        via: 'extension-dest',
      };
    }
    return {
      ok: false,
      bytes: 0,
      via: 'extension',
      error: `empty download result: ${JSON.stringify(result).slice(0, 200)}`,
    };
  } catch (e) {
    return {
      ok: false,
      bytes: 0,
      via: 'extension',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Refresh credits/projects after gen so app mirrors live account state. */
export async function refreshAccountAfterTask(accountId?: string): Promise<void> {
  const aid = String(accountId || '').trim();
  if (!aid) return;
  try {
    const { syncAccountIdentity } = await import('./bridgeServer');
    await syncAccountIdentity(aid);
  } catch (e) {
    console.warn(
      '[AccountProxy] post-task refresh',
      aid,
      e instanceof Error ? e.message : e,
    );
  }
}
