import type { AiMasterProvider } from '@/contracts';
import { keyFingerprint } from '@/lib/apiKeyRotate';
import {
  assertSupportedGeminiTextModel,
  DEFAULT_GEMINI_TEXT_MODEL,
  GEMINI_TEXT_MODELS,
  normalizeGeminiTextModel,
  type GeminiTextModel,
} from '@/lib/geminiModels';

export type KeyHealthState =
  | 'active'
  | 'rate_limited'
  | 'invalid'
  | 'billing_required'
  | 'configuration_required'
  | 'model_unavailable'
  | 'provider_error';

export interface KeyHealthStatus {
  maskedKey: string;
  fingerprint: string;
  provider: AiMasterProvider;
  model?: string;
  status: KeyHealthState;
  latencyMs: number;
  errorNote?: string;
}

export interface ModelHealthStatus {
  model: string;
  status: KeyHealthState;
  latencyMs: number;
  checkedKeys: number;
  activeKeyFingerprint?: string;
  errorNote?: string;
}

export type KeyHealthCheckConfig = {
  provider: AiMasterProvider;
  model?: string;
  customApiBaseUrl?: string;
};

export function maskApiKey(key: string): string {
  const value = String(key || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function selectedHealthModel(config: KeyHealthCheckConfig): string {
  const model = String(config.model || '').trim();
  if (config.provider === 'gemini') return normalizeGeminiTextModel(model);
  return model;
}

function healthEndpoint(config: KeyHealthCheckConfig): {
  url: string;
  headers: Record<string, string>;
  method: 'GET' | 'POST';
  body?: string;
} | null {
  const model = selectedHealthModel(config);
  if (config.provider === 'gemini') {
    const selected = model || DEFAULT_GEMINI_TEXT_MODEL;
    assertSupportedGeminiTextModel(selected);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selected)}:generateContent`,
      headers: {},
      method: 'POST',
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with exactly: OK' }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8,
        },
      }),
    };
  }
  if (config.provider === 'openai') {
    return {
      url: model
        ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}`
        : 'https://api.openai.com/v1/models',
      headers: {},
      method: 'GET',
    };
  }
  if (config.provider === 'claude') {
    return {
      url: model
        ? `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`
        : 'https://api.anthropic.com/v1/models',
      headers: { 'anthropic-version': '2023-06-01' },
      method: 'GET',
    };
  }
  if (config.provider === 'grok') {
    return {
      url: model
        ? `https://api.x.ai/v1/models/${encodeURIComponent(model)}`
        : 'https://api.x.ai/v1/models',
      headers: {},
      method: 'GET',
    };
  }
  return null;
}

function responseNote(raw: string, status: number): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    return (
      parsed.error?.message ||
      parsed.message ||
      raw.slice(0, 300) ||
      `HTTP ${status}`
    );
  } catch {
    return raw.slice(0, 300) || `HTTP ${status}`;
  }
}

function classifyHealth(status: number, note: string): KeyHealthState {
  if (
    status === 404 ||
    /model.*(?:not found|not available|unsupported)|not supported.*generateContent|not found for API version/iu.test(
      note,
    )
  ) {
    return 'model_unavailable';
  }
  if (status === 429 || /quota|rate.?limit|resource.?exhausted/iu.test(note)) {
    return 'rate_limited';
  }
  if (
    status === 401 ||
    /invalid.*api.*key|api.*key.*(?:invalid|not valid)|unauthenticated|revoked|reported as leaked|leaked.*api.*key/iu.test(
      note,
    )
  ) {
    return 'invalid';
  }
  if (/billing|paid tier|payment|required.*billing|limit[^0-9]*0/iu.test(note)) {
    return 'billing_required';
  }
  if (
    /service.*disabled|api.*not enabled|permission|forbidden/iu.test(note)
  ) {
    return 'configuration_required';
  }
  return 'provider_error';
}

export async function checkSingleKeyHealth(
  key: string,
  config: KeyHealthCheckConfig,
): Promise<KeyHealthStatus> {
  const value = String(key || '').trim();
  const selectedModel = selectedHealthModel(config);
  const base: Omit<KeyHealthStatus, 'status' | 'latencyMs'> = {
    maskedKey: maskApiKey(value),
    fingerprint: keyFingerprint(value),
    provider: config.provider,
    ...(selectedModel ? { model: selectedModel } : {}),
  };
  if (!value) {
    return {
      ...base,
      status: 'invalid',
      latencyMs: 0,
      errorNote: 'Key trống',
    };
  }

  let endpoint: ReturnType<typeof healthEndpoint>;
  try {
    endpoint = healthEndpoint(config);
  } catch (error) {
    return {
      ...base,
      status: 'model_unavailable',
      latencyMs: 0,
      errorNote: error instanceof Error ? error.message : String(error),
    };
  }
  if (!endpoint) {
    return {
      ...base,
      status: 'configuration_required',
      latencyMs: 0,
      errorNote:
        'Custom provider không có endpoint health chuẩn chung; kiểm tra bằng request Generate thật.',
    };
  }

  if (config.provider === 'gemini') {
    endpoint.headers['x-goog-api-key'] = value;
  } else if (config.provider === 'claude') {
    endpoint.headers['x-api-key'] = value;
  } else {
    endpoint.headers.Authorization = `Bearer ${value}`;
  }

  const startTime = Date.now();
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: endpoint.headers,
      ...(endpoint.body ? { body: endpoint.body } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - startTime;
    if (response.ok) {
      return { ...base, status: 'active', latencyMs };
    }
    const note = responseNote(await response.text(), response.status).replaceAll(
      value,
      '[REDACTED]',
    );
    return {
      ...base,
      status: classifyHealth(response.status, note),
      latencyMs,
      errorNote: `HTTP ${response.status}: ${note}`,
    };
  } catch (error) {
    return {
      ...base,
      status: 'provider_error',
      latencyMs: Date.now() - startTime,
      errorNote:
        error instanceof Error ? error.message : String(error || 'Network error'),
    };
  }
}

export async function checkAllKeysHealth(
  keys: string[],
  config: KeyHealthCheckConfig,
): Promise<KeyHealthStatus[]> {
  const unique = Array.from(
    new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)),
  );
  return Promise.all(unique.map((key) => checkSingleKeyHealth(key, config)));
}

function representativeStatus(
  statuses: KeyHealthStatus[],
): KeyHealthStatus | null {
  if (statuses.length === 0) return null;
  const priority: KeyHealthState[] = [
    'active',
    'rate_limited',
    'billing_required',
    'configuration_required',
    'model_unavailable',
    'invalid',
    'provider_error',
  ];
  return [...statuses].sort(
    (a, b) => priority.indexOf(a.status) - priority.indexOf(b.status),
  )[0];
}

export async function checkGeminiModelMatrix(
  keys: string[],
  models: readonly GeminiTextModel[] = GEMINI_TEXT_MODELS,
): Promise<ModelHealthStatus[]> {
  const unique = Array.from(
    new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)),
  );
  const matrix: ModelHealthStatus[] = [];

  for (const model of models) {
    const checked: KeyHealthStatus[] = [];
    for (const key of unique) {
      const result = await checkSingleKeyHealth(key, {
        provider: 'gemini',
        model,
      });
      checked.push(result);
      if (result.status === 'active') break;
    }
    const best = representativeStatus(checked);
    matrix.push({
      model,
      status: best?.status || 'invalid',
      latencyMs: best?.latencyMs || 0,
      checkedKeys: checked.length,
      activeKeyFingerprint:
        best?.status === 'active' ? best.fingerprint : undefined,
      errorNote: best?.errorNote,
    });
  }

  return matrix;
}
