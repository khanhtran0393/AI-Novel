/**
 * API Key Health & Latency Monitor.
 * Tests active status, quota limits, and ping response times for Gemini / OpenAI keys.
 */

export interface KeyHealthStatus {
  key: string;
  maskedKey: string;
  provider: 'gemini' | 'openai' | 'grok' | 'unknown';
  status: 'active' | 'rate_limited' | 'invalid';
  latencyMs: number;
  errorNote?: string;
}

export function maskApiKey(key: string): string {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

export function detectKeyProvider(key: string): 'gemini' | 'openai' | 'grok' | 'unknown' {
  const k = String(key || '').trim();
  if (k.startsWith('AIzaSy')) return 'gemini';
  if (k.startsWith('sk-proj-') || k.startsWith('sk-')) return 'openai';
  if (k.startsWith('xai-')) return 'grok';
  return 'gemini'; // default
}

export async function checkSingleKeyHealth(key: string): Promise<KeyHealthStatus> {
  const k = String(key || '').trim();
  const masked = maskApiKey(k);
  const provider = detectKeyProvider(k);

  if (!k) {
    return {
      key: k,
      maskedKey: masked,
      provider: 'unknown',
      status: 'invalid',
      latencyMs: 0,
      errorNote: 'Key trống',
    };
  }

  const startTime = Date.now();
  try {
    let testUrl = '';
    if (provider === 'gemini') {
      testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`;
    } else if (provider === 'openai') {
      testUrl = 'https://api.openai.com/v1/models';
    } else {
      testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const headers: Record<string, string> = {};
    if (provider === 'openai') {
      headers['Authorization'] = `Bearer ${k}`;
    }

    const res = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      return {
        key: k,
        maskedKey: masked,
        provider,
        status: 'active',
        latencyMs,
      };
    }

    if (res.status === 429) {
      return {
        key: k,
        maskedKey: masked,
        provider,
        status: 'rate_limited',
        latencyMs,
        errorNote: 'Rate limited / Hết quota tạm thời (429)',
      };
    }

    return {
      key: k,
      maskedKey: masked,
      provider,
      status: 'invalid',
      latencyMs,
      errorNote: `HTTP ${res.status} Invalid API Key`,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return {
      key: k,
      maskedKey: masked,
      provider,
      status: 'rate_limited',
      latencyMs,
      errorNote: String((err as Error)?.message || err),
    };
  }
}

export async function checkAllKeysHealth(keys: string[]): Promise<KeyHealthStatus[]> {
  const validKeys = Array.from(new Set(keys.map((k) => String(k || '').trim()).filter(Boolean)));
  return Promise.all(validKeys.map((k) => checkSingleKeyHealth(k)));
}
