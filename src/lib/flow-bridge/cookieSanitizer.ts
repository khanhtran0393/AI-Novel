/**
 * Essential Cookie Filter & Deduplicator for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Prevents HTTP 431 Request Header Fields Too Large crashes on Workspace (@company.com)
 * and 2FA accounts where Google assigns 40-80 duplicate cookies across subdomains (8-12KB).
 * Filters down to essential auth cookies and keeps total length strictly under 4KB.
 */

const ESSENTIAL_COOKIE_PATTERNS = [
  // Google.com auth cookies (consumer)
  '__Secure-1PSID',
  '__Secure-1PAPISID',
  '__Secure-1PSIDTS',
  '__Secure-1PSIDCC',
  '__Secure-3PSID',
  '__Secure-3PAPISID',
  '__Secure-3PSIDTS',
  '__Secure-3PSIDCC',
  'SAPISID',
  'APISID',
  'SSID',
  'SID',
  'HSID',
  // Workspace SSO essentials — needed for @company.com accounts
  'LSID',
  'LSOSID',
  'OSID',
  'S',
  'SIDCC',
  '__Secure-OSID',
  'OGPC',
  'OGP',
  'ACCOUNT_CHOOSER',
  // Tracking / continuity (used by both flows for session score)
  'NID',
  '1P_JAR',
  '3P_JAR',
  'AEC',
  '__Secure-ENID',
  'CONSENT',
  'SOCS',
  // Labs.google auth cookies (NextAuth)
  '__Secure-next-auth.session-token',
  '__Secure-next-auth.callback-url',
  '__Host-next-auth.csrf-token',
  'email',
  'EMAIL',
];

export interface ParsedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export function parseCookies(cookieInput: string | ParsedCookie[]): ParsedCookie[] {
  if (Array.isArray(cookieInput)) return cookieInput;
  if (!cookieInput || typeof cookieInput !== 'string') return [];

  // Handle JSON array string
  const trimmed = cookieInput.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((c: any) => ({
          name: c.name || c.key || '',
          value: c.value || '',
          domain: c.domain || '',
          path: c.path || '/',
        })).filter((c) => c.name);
      }
    } catch {
      /* fall back to header parsing */
    }
  }

  // Handle header string "name1=val1; name2=val2"
  const pairs = trimmed.split(';');
  const result: ParsedCookie[] = [];
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) {
      result.push({ name, value, domain: 'labs.google', path: '/' });
    }
  }
  return result;
}

export function isEssentialCookie(cookieName: string): boolean {
  if (ESSENTIAL_COOKIE_PATTERNS.includes(cookieName)) return true;
  if (cookieName.startsWith('__Secure-') || cookieName.startsWith('__Host-')) return true;
  return false;
}

/**
 * Deduplicate and filter cookies into a clean header string strictly under maxBytes (default 4000).
 */
export function sanitizeCookieHeader(rawInput: string | ParsedCookie[], maxBytes = 4000): string {
  const cookies = parseCookies(rawInput);
  if (cookies.length === 0) return typeof rawInput === 'string' ? rawInput : '';

  // Filter essential
  const essential = cookies.filter((c) => isEssentialCookie(c.name));
  const pool = essential.length > 0 ? essential : cookies;

  // Score domain relevance (labs.google > accounts.google.com > .google.com)
  const scored = pool.map((c) => {
    let score = 0;
    const dom = (c.domain || '').toLowerCase();
    if (dom.includes('labs.google')) score = 30;
    else if (dom.includes('accounts.google')) score = 20;
    else if (dom.includes('google.com')) score = 10;
    return { ...c, score };
  });

  // Sort by score desc, then dedup by name
  scored.sort((a, b) => b.score - a.score);
  const dedupedMap = new Map<string, string>();
  for (const c of scored) {
    if (!dedupedMap.has(c.name)) {
      dedupedMap.set(c.name, c.value);
    }
  }

  // Construct header string while respecting maxBytes limit
  const parts: string[] = [];
  let currentBytes = 0;

  for (const [name, val] of dedupedMap.entries()) {
    const entry = `${name}=${val}`;
    const addedLen = (parts.length > 0 ? 2 : 0) + entry.length;
    if (currentBytes + addedLen > maxBytes) {
      break; // Cap to avoid 431 Header Overflow
    }
    parts.push(entry);
    currentBytes += addedLen;
  }

  return parts.join('; ');
}
