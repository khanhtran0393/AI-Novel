/**
 * SSRF guards for source-ingest web fetch.
 * Only public http(s) URLs; block private / link-local / metadata hosts.
 */

export type SsrfCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
  if (h.startsWith('fe80')) return true; // link-local
  return false;
}

/**
 * Normalize user input to absolute URL and reject unsafe targets.
 */
export function assertSafePublicHttpUrl(raw: string): SsrfCheckResult {
  const input = String(raw || '').trim();
  if (!input) {
    return { ok: false, reason: 'URL trống' };
  }

  let normalized = input;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { ok: false, reason: 'URL không parse được' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Chỉ hỗ trợ http/https (nhận: ${url.protocol})` };
  }

  const host = (url.hostname || '').toLowerCase();
  if (!host) {
    return { ok: false, reason: 'Thiếu hostname' };
  }
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `Host bị chặn: ${host}` };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: `Host nội bộ bị chặn: ${host}` };
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { ok: false, reason: `IP nội bộ/private bị chặn: ${host}` };
  }

  return { ok: true, url };
}

/** True if hostname looks like YouTube (for router ordering). */
export function isYoutubeHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/^www\./, '');
  return (
    h === 'youtube.com' ||
    h === 'm.youtube.com' ||
    h === 'music.youtube.com' ||
    h === 'youtu.be' ||
    h.endsWith('.youtube.com')
  );
}
