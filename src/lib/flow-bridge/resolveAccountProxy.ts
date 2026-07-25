/**
 * Resolve Chromium --proxy-server for a Flow profile.
 * Priority: explicit arg → account.proxy → ops.globalProxy.
 * User-managed only (no free VPN / Urban auto).
 */
import { loadAccounts } from './accountStore';
import { loadFlowOps } from './opsStore';

/**
 * Normalize user input to a value Chromium accepts for --proxy-server=
 * Examples:
 *   1.2.3.4:8080
 *   http://1.2.3.4:8080
 *   http://user:pass@1.2.3.4:8080
 *   socks5://1.2.3.4:1080
 */
export function normalizeProxyServer(raw: string | null | undefined): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Full URL already
  if (/^(https?|socks5?):\/\//i.test(s)) return s;
  // user:pass@host:port
  if (/^[^@\s]+@[^:\s]+:\d+$/.test(s)) return `http://${s}`;
  // host:port
  if (/^[^:\s\/]+:\d{2,5}$/.test(s)) return s;
  return s;
}

export function resolveAccountProxyServer(
  accountId?: string | null,
  explicit?: string | null,
): string {
  const fromArg = normalizeProxyServer(explicit);
  if (fromArg) return fromArg;
  const id = String(accountId || '').trim();
  if (id) {
    try {
      const acc = loadAccounts().find((a) => a.id === id);
      const fromAcc = normalizeProxyServer(acc?.proxy);
      if (fromAcc) return fromAcc;
    } catch {
      /* ignore */
    }
  }
  try {
    const ops = loadFlowOps();
    return normalizeProxyServer(ops.globalProxy);
  } catch {
    return '';
  }
}
