/**
 * Google AI Studio (generativelanguage.googleapis.com) — sole cloud brain for
 * TTS Batch path: STT + translate. Warm keep-alive + key rotate.
 */
import { langEnName, type BatchLangCode } from './languages';

export const GOOGLE_STUDIO_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
] as const;

let lastWorkingKey = '';
let lastWorkingModel = '';
let warmupPromise: Promise<void> | null = null;

export function orderKeys(apiKeys: string[]): string[] {
  const keys = apiKeys.map(String).filter(Boolean);
  if (lastWorkingKey && keys.includes(lastWorkingKey)) {
    return [lastWorkingKey, ...keys.filter((k) => k !== lastWorkingKey)];
  }
  return keys;
}

export function orderModels(models: readonly string[] = GOOGLE_STUDIO_MODELS): string[] {
  const list = [...models];
  if (lastWorkingModel && list.includes(lastWorkingModel)) {
    return [lastWorkingModel, ...list.filter((m) => m !== lastWorkingModel)];
  }
  return list;
}

/**
 * Warm keep-alive to Google Studio (CapAssist auto_warmup). Fire-and-forget OK.
 */
export function warmupGoogleStudio(apiKeys: string[]): Promise<void> {
  if (warmupPromise) return warmupPromise;
  const key = orderKeys(apiKeys)[0];
  if (!key) return Promise.resolve();
  warmupPromise = (async () => {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(12_000) });
      console.log('[google-studio] warmup OK');
    } catch (e) {
      console.warn(
        '[google-studio] warmup soft-fail',
        e instanceof Error ? e.message : e,
      );
    }
  })();
  return warmupPromise;
}

export async function callGoogleStudioText(opts: {
  prompt: string;
  apiKeys: string[];
  temperature?: number;
  maxOutputTokens?: number;
  models?: readonly string[];
}): Promise<string> {
  const keys = orderKeys(opts.apiKeys);
  if (!keys.length) {
    throw new Error(
      'Google AI Studio: thiếu API key (Gemini). Cấu hình keys ở Cài đặt / header.',
    );
  }
  const models = orderModels(opts.models || GOOGLE_STUDIO_MODELS);
  let lastError: Error | null = null;
  const exhausted = new Set<string>();

  for (const apiKey of keys) {
    if (exhausted.has(apiKey)) continue;
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: opts.prompt }] }],
            generationConfig: {
              temperature: opts.temperature ?? 0.35,
              maxOutputTokens: opts.maxOutputTokens ?? 8192,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                threshold: 'BLOCK_NONE',
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_NONE',
              },
            ],
          }),
          signal: AbortSignal.timeout(120_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = String(data?.error?.message || `HTTP ${res.status}`);
          lastError = new Error(`[Studio ${model}] ${msg}`);
          if (
            res.status === 429 ||
            /quota|rate|limit/i.test(msg)
          ) {
            exhausted.add(apiKey);
            break;
          }
          continue;
        }
        const text = String(
          data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
        ).trim();
        if (!text) {
          lastError = new Error(`[Studio ${model}] empty response`);
          continue;
        }
        lastWorkingKey = apiKey;
        lastWorkingModel = model;
        return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  throw lastError || new Error('Google AI Studio call failed');
}

export function studioLangLabel(code: string): string {
  try {
    return langEnName(code as BatchLangCode) || code;
  } catch {
    return code;
  }
}
