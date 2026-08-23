const SECRET_QUERY_KEYS = new Set([
  'key',
  'api_key',
  'apikey',
  'token',
  'access_token',
  'authorization',
]);

/** Redact query-string secrets before logging provider endpoints. */
export function redactUrlSecrets(input: string): string {
  try {
    const url = new URL(input);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, 'REDACTED');
      }
    }
    return url.toString();
  } catch {
    return String(input || '').replace(
      /([?&](?:key|api_key|apikey|token|access_token)=)[^&#\s]+/giu,
      '$1REDACTED',
    );
  }
}

export function normalizeOpenAiCompatibleEndpoint(baseUrl?: string): string {
  const raw = String(baseUrl || 'https://api.openai.com').trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Custom Base URL không hợp lệ: "${raw}".`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Custom Base URL chỉ hỗ trợ http:// hoặc https://.');
  }
  const path = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = /\/chat\/completions$/u.test(path)
    ? path
    : /\/v1$/u.test(path)
      ? `${path}/chat/completions`
      : `${path}/v1/chat/completions`;
  return parsed.toString();
}

export function normalizeGeminiCompatibleEndpoint(
  baseUrl: string | undefined,
  model: string,
): string {
  if (!baseUrl?.trim()) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  }
  const raw = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Custom Gemini Base URL không hợp lệ: "${raw}".`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Custom Gemini Base URL chỉ hỗ trợ http:// hoặc https://.');
  }
  const path = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = path.includes(':generateContent')
    ? path
    : `${path}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return parsed.toString();
}
