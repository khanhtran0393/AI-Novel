/**
 * Shared HTTP helpers for workspace modules.
 * Always use API paths from @/contracts — do not hardcode '/api/...' in new code.
 *
 * Owner: all modules that need LLM/image/tts HTTP.
 * Does not own business payloads — callers build payload + requestType.
 */
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { newCorrelationId } from '@/lib/requestContext';

export { API };

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

/** Client entitlement token (enforce mode) + correlation id for hot APIs. */
export function buildClientApiHeaders(
  extra?: HeadersInit,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-correlation-id': newCorrelationId('ui'),
  };
  if (typeof window !== 'undefined') {
    try {
      const t =
        window.localStorage.getItem(ENTITLEMENT_LS_KEY) ||
        window.sessionStorage.getItem(ENTITLEMENT_LS_KEY) ||
        '';
      if (t.trim()) headers['x-ainovel-entitlement'] = t.trim();
    } catch {
      /* ignore */
    }
  }
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }
  return headers;
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal; headers?: HeadersInit },
): Promise<T> {
  // Off-GUI: LLM/media POST wait in Worker/utilityProcess (signal ignored off-thread)
  void init?.signal;
  const { offThreadFetchResponse } = await import(
    '@/lib/appWork/offThreadFetchCompat'
  );
  const res = await offThreadFetchResponse(url, {
    method: 'POST',
    headers: buildClientApiHeaders(init?.headers),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
    correlationId?: string;
  };
  if (!res.ok) {
    const err =
      typeof data === 'object' && data && 'error' in data && data.error
        ? String(data.error)
        : `HTTP ${res.status}`;
    const e = new Error(err) as Error & {
      code?: string;
      status?: number;
      correlationId?: string;
    };
    if (typeof data === 'object' && data?.code) e.code = String(data.code);
    if (typeof data === 'object' && data?.correlationId) {
      e.correlationId = String(data.correlationId);
    }
    e.status = res.status;
    throw e;
  }
  return data;
}

/**
 * Resolve API keys for the active master model (Gemini / OpenAI / Grok).
 * Shared so write/scene/image/setup/character do not each re-implement.
 */
export function resolveMasterModelKeys(): {
  keysToUse: string[];
  model: string;
} {
  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse =
      storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0
        ? storeState.openaiApiKeys
        : storeState.openaiApiKey
          ? [storeState.openaiApiKey]
          : [];
  } else if (model === 'llama') {
    keysToUse =
      storeState.grokApiKeys && storeState.grokApiKeys.length > 0
        ? storeState.grokApiKeys
        : storeState.grokApiKey
          ? [storeState.grokApiKey]
          : [];
  } else {
    keysToUse =
      storeState.apiKeys && storeState.apiKeys.length > 0
        ? storeState.apiKeys
        : storeState.apiKey
          ? [storeState.apiKey]
          : [];
  }
  return { keysToUse, model };
}

export function requireMasterModelKeys(): {
  keysToUse: string[];
  model: string;
} {
  const resolved = resolveMasterModelKeys();
  if (resolved.keysToUse.length === 0 && resolved.model !== 'aistudio') {
    throw new Error(
      'Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.',
    );
  }
  return resolved;
}

/** POST /api/generate with requestType ownership */
export async function postGenerate(
  requestType: string,
  payload: Record<string, unknown>,
  opts?: {
    apiKeys?: string[];
    model?: string;
    signal?: AbortSignal;
    /** default true — resolve keys from store when not passed */
    autoKeys?: boolean;
  },
): Promise<Record<string, unknown>> {
  let apiKeys = opts?.apiKeys;
  let model = opts?.model;
  if (opts?.autoKeys !== false && (!apiKeys || !model)) {
    const resolved = requireMasterModelKeys();
    apiKeys = apiKeys ?? resolved.keysToUse;
    model = model ?? resolved.model;
  }
  return postJson(
    API.generate,
    {
      requestType,
      apiKeys: apiKeys || [],
      model,
      payload,
    },
    { signal: opts?.signal },
  );
}
