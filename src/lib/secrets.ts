/**
 * Secret redaction for logs, toasts, and error surfaces.
 * Never log raw API keys / cookies / session ids.
 */

const SECRET_KEY_RE =
  /^(api[_-]?key|apikey|authorization|cookie|session|token|password|secret|entitlement|tiktok.*session|x-ainovel-entitlement)$/i;

/** Long hex / base64-ish tokens often used as keys */
const LOOKS_LIKE_SECRET_RE =
  /(?:^|[\s"'=])(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|ya29\.[0-9A-Za-z._-]{20,}|[0-9a-f]{32,})/gi;

export function maskSecret(value: string | null | undefined, visible = 4): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (s.length <= visible * 2) return '••••';
  return `${s.slice(0, visible)}…${s.slice(-visible)}`;
}

export function isSecretFieldName(name: string): boolean {
  return SECRET_KEY_RE.test(name.replace(/\s+/g, ''));
}

/** Redact free-form text (toast messages, error strings). */
export function maskSecretsInText(text: string): string {
  if (!text) return text;
  let out = text;
  // key=value / "apiKey": "..."
  out = out.replace(
    /(["']?)(api[_-]?key|apiKey|cookie|session[_-]?id|tiktokSessionId|authorization|token|secret|entitlementToken)\1\s*[:=]\s*["']?([^\s"',}]+)/gi,
    (_m, _q, key, val) => `${key}=${maskSecret(val)}`,
  );
  out = out.replace(LOOKS_LIKE_SECRET_RE, (m) => {
    const lead = m.match(/^[\s"'=]+/)?.[0] || '';
    const body = m.slice(lead.length);
    return lead + maskSecret(body);
  });
  return out;
}

/** Deep-clone-ish redact for structured logs (plain objects/arrays only). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 48 && LOOKS_LIKE_SECRET_RE.test(value)
      ? maskSecret(value)
      : maskSecretsInText(value);
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, depth + 1));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSecretFieldName(k) && typeof v === 'string') {
      out[k] = maskSecret(v);
    } else if (isSecretFieldName(k) && Array.isArray(v)) {
      out[k] = v.map((x) => (typeof x === 'string' ? maskSecret(x) : redactDeep(x, depth + 1)));
    } else {
      out[k] = redactDeep(v, depth + 1);
    }
  }
  return out;
}
