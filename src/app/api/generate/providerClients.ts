import type {
  AiMasterProvider,
  CustomApiProtocol,
  ResolvedAiProvider,
} from '@/contracts';
import { resolveAiProvider } from '@/contracts';
import {
  assertPoolHasCapacity,
  filterAvailableKeys,
  keyFingerprint,
  markKeyAttempt,
  markKeyLimited,
  markKeySuccess,
  type KeyLimitKind,
} from '@/lib/apiKeyRotate';
import {
  normalizeGeminiCompatibleEndpoint,
  normalizeOpenAiCompatibleEndpoint,
  redactUrlSecrets,
} from '@/lib/apiSecurity';
import { AppError } from '@/lib/errors';
import {
  assertSupportedGeminiTextModel,
  DEFAULT_GEMINI_TEXT_MODEL,
  normalizeGeminiTextModel,
} from '@/lib/geminiModels';

export type ProviderClientConfig = {
  model?: string;
  provider?: AiMasterProvider;
  customApiBaseUrl?: string;
  customApiModel?: string;
  customApiProtocol?: CustomApiProtocol;
};

export type ProviderVisionInput = {
  name?: string;
  mimeType: string;
  data: string;
};

type OpenAiContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

function uniqueKeys(apiKeyOrKeys: string | string[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys])
        .map((key) => String(key || '').trim())
        .filter(Boolean),
    ),
  );
}

function resolvedModel(
  provider: ResolvedAiProvider,
  config: ProviderClientConfig,
): string {
  const requested = String(
    config.customApiModel || config.model || '',
  ).trim();
  if (provider === 'gemini') {
    const geminiModel = normalizeGeminiTextModel(requested);
    assertSupportedGeminiTextModel(geminiModel);
    return geminiModel;
  }
  if (provider === 'openai') {
    return !requested || requested === 'gpt4o' ? 'gpt-4o' : requested;
  }
  if (provider === 'groq') {
    return !requested || requested === 'llama'
      ? 'llama-3.3-70b-versatile'
      : requested;
  }
  if (provider === 'grok') {
    return !requested || requested === 'llama' ? 'grok-4.5' : requested;
  }
  if (provider === 'anthropic') {
    if (!requested) {
      throw new AppError('Chưa chọn model Claude.', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    return requested;
  }
  if (!requested) {
    throw new AppError('Custom provider cần Custom Model.', {
      code: 'VALIDATION',
      status: 400,
    });
  }
  return requested;
}

function shouldTryNextKey(kind: KeyLimitKind): boolean {
  return (
    kind === 'rpm' ||
    kind === 'rpd' ||
    kind === 'auth' ||
    kind === 'network'
  );
}

function providerError(
  provider: ResolvedAiProvider,
  model: string,
  status: number,
  message: string,
  kind: KeyLimitKind,
): AppError {
  const code =
    kind === 'rpm' || kind === 'rpd'
      ? 'QUOTA'
      : kind === 'auth'
        ? 'AUTH'
        : kind === 'model'
          ? 'NOT_FOUND'
          : kind === 'payload'
            ? 'VALIDATION'
            : 'PROVIDER';
  const publicStatus =
    kind === 'billing' || kind === 'permission' || kind === 'api_disabled'
      ? 403
      : status >= 400
        ? status
        : undefined;
  return new AppError(
    `[${provider}/${model}] ${message}`,
    {
      code,
      status: publicStatus,
      details: { provider, model, providerStatus: status, kind },
    },
  );
}

async function responseMessage(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return `HTTP ${response.status}`;
  try {
    const json = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof json.error === 'string') return json.error;
    return json.error?.message || json.message || raw.slice(0, 800);
  } catch {
    return raw.slice(0, 800);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const timeoutMs = Math.max(
    10_000,
    Number(process.env.AI_NOVEL_PROVIDER_TIMEOUT_MS || 120_000),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function openAiContent(
  prompt: string,
  images: ProviderVisionInput[],
): OpenAiContent {
  if (!images.length) return prompt;
  return [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${image.mimeType};base64,${image.data}`,
      },
    })),
  ];
}

async function callOpenAiCompatible(
  provider: ResolvedAiProvider,
  endpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
  images: ProviderVisionInput[],
): Promise<string> {
  console.log(
    `[AI Provider] ${provider} key=${keyFingerprint(apiKey)} model=${model} endpoint=${redactUrlSecrets(endpoint)}`,
  );
  const reasoningModel = /^(?:o[134](?:-|$)|gpt-5)/u.test(model);
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: openAiContent(prompt, images),
      },
    ],
    ...(reasoningModel
      ? { max_completion_tokens: images.length ? 4096 : 8192 }
      : {
          temperature: images.length ? 0.35 : 0.85,
          max_tokens: images.length ? 4096 : 8192,
        }),
  };
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    throw Object.assign(new Error(await responseMessage(response)), {
      providerStatus: response.status,
    });
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw Object.assign(new Error('Provider trả về nội dung rỗng.'), {
      providerStatus: 502,
    });
  }
  return text;
}

async function callAnthropic(
  model: string,
  apiKey: string,
  prompt: string,
  images: ProviderVisionInput[],
): Promise<string> {
  const endpoint = 'https://api.anthropic.com/v1/messages';
  console.log(
    `[AI Provider] anthropic key=${keyFingerprint(apiKey)} model=${model} endpoint=${endpoint}`,
  );
  const content = [
    ...images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mimeType,
        data: image.data,
      },
    })),
    { type: 'text' as const, text: prompt },
  ];
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: images.length ? 4096 : 8192,
      temperature: images.length ? 0.35 : 0.85,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(await responseMessage(response)), {
      providerStatus: response.status,
    });
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  if (!text) {
    throw Object.assign(new Error('Claude trả về nội dung rỗng.'), {
      providerStatus: 502,
    });
  }
  return text;
}

async function callGeminiCompatible(
  provider: ResolvedAiProvider,
  endpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
  images: ProviderVisionInput[],
): Promise<string> {
  console.log(
    `[AI Provider] ${provider} key=${keyFingerprint(apiKey)} model=${model} endpoint=${redactUrlSecrets(endpoint)}`,
  );
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            ...images.map((image) => ({
              inlineData: {
                mimeType: image.mimeType,
                data: image.data,
              },
            })),
          ],
        },
      ],
      generationConfig: {
        temperature: images.length ? 0.35 : 0.85,
        maxOutputTokens: images.length ? 4096 : 8192,
      },
    }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(await responseMessage(response)), {
      providerStatus: response.status,
    });
  }
  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  if (!text) {
    throw Object.assign(new Error('Gemini trả về nội dung rỗng.'), {
      providerStatus: 502,
    });
  }
  return text;
}

function resolveProviderAndModel(
  config: ProviderClientConfig,
  apiKeyOrKeys: string | string[],
): { provider: ResolvedAiProvider; model: string } {
  const firstKey = uniqueKeys(apiKeyOrKeys)[0];
  const provider = resolveAiProvider({
    model: config.customApiModel || config.model || 'gemini',
    explicitProvider: config.provider,
    customApiBaseUrl: config.customApiBaseUrl,
    customApiProtocol: config.customApiProtocol,
    firstKey,
  });
  return { provider, model: resolvedModel(provider, config) };
}

export async function callConfiguredProvider(
  prompt: string,
  images: ProviderVisionInput[] = [],
  apiKeyOrKeys: string | string[],
  config: ProviderClientConfig = {},
): Promise<string> {
  const rawKeys = uniqueKeys(apiKeyOrKeys);
  if (!rawKeys.length) {
    throw new AppError('Thiếu API key cho provider đã chọn.', {
      code: 'AUTH',
      status: 400,
    });
  }
  const { provider, model: primaryModel } = resolveProviderAndModel(config, rawKeys);
  if (
    provider === 'grok' &&
    rawKeys.some((key) => key.toLowerCase().startsWith('gsk_'))
  ) {
    throw new AppError(
      '[grok] Key bắt đầu bằng gsk_ là key Groq, không phải xAI. Chọn model Llama/Groq hoặc nhập xAI API key cho Grok.',
      {
        code: 'AUTH',
        status: 400,
        details: { provider, model: primaryModel, kind: 'auth' },
      },
    );
  }

  // User exception: rotate across supported Gemini models if quota exhausted on primary model
  const { GEMINI_TEXT_MODELS } = await import('@/lib/geminiModels');
  const modelsToTry: string[] = [primaryModel];
  if (provider === 'gemini') {
    for (const fallbackModel of GEMINI_TEXT_MODELS) {
      if (fallbackModel !== primaryModel) {
        modelsToTry.push(fallbackModel);
      }
    }
  }

  let finalError: AppError | null = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx += 1) {
    const currentModel = modelsToTry[mIdx];
    const currentConfig = { ...config, model: currentModel };
    let lastError: AppError | null = null;

    assertPoolHasCapacity(rawKeys);
    const keys = filterAvailableKeys(rawKeys);
    const keysToAttempt = keys.length ? keys : rawKeys;

    for (const apiKey of keysToAttempt) {
      if (!markKeyAttempt(apiKey)) continue;
      try {
        let text: string;
        if (
          provider === 'openai' ||
          provider === 'grok' ||
          provider === 'groq' ||
          provider === 'custom-openai'
        ) {
          const endpoint =
            provider === 'openai'
              ? 'https://api.openai.com/v1/chat/completions'
              : provider === 'grok'
                ? 'https://api.x.ai/v1/chat/completions'
                : provider === 'groq'
                  ? 'https://api.groq.com/openai/v1/chat/completions'
                  : normalizeOpenAiCompatibleEndpoint(
                      currentConfig.customApiBaseUrl,
                    );
          text = await callOpenAiCompatible(
            provider,
            endpoint,
            currentModel,
            apiKey,
            prompt,
            images,
          );
        } else if (provider === 'anthropic') {
          text = await callAnthropic(currentModel, apiKey, prompt, images);
        } else {
          const endpoint = normalizeGeminiCompatibleEndpoint(
            provider === 'custom-gemini'
              ? currentConfig.customApiBaseUrl
              : undefined,
            currentModel,
          );
          text = await callGeminiCompatible(
            provider,
            endpoint,
            currentModel,
            apiKey,
            prompt,
            images,
          );
        }
        markKeySuccess(apiKey);
        if (mIdx > 0) {
          console.log(
            `[Gemini Model Rotation] Primary ${primaryModel} quota exhausted -> Rotated to ${currentModel} successfully!`,
          );
        }
        return text;
      } catch (error) {
        const status =
          error &&
          typeof error === 'object' &&
          typeof (error as { providerStatus?: unknown }).providerStatus ===
            'number'
            ? (error as { providerStatus: number }).providerStatus
            : 0;
        const unsafeMessage =
          error instanceof Error ? error.message : String(error || 'Provider error');
        const message = unsafeMessage.replaceAll(apiKey, '[REDACTED]');
        const kind = markKeyLimited(apiKey, message, status || undefined);
        lastError = providerError(provider, currentModel, status, message, kind);
        if (!shouldTryNextKey(kind)) throw lastError;
      }
    }

    finalError = lastError || finalError;

    // Only attempt next Gemini model if error is QUOTA/RPM/RPD limit
    if (provider !== 'gemini' || !lastError || lastError.code !== 'QUOTA') {
      break;
    }
  }

  if (finalError) throw finalError;
  assertPoolHasCapacity(rawKeys);
  throw new AppError('Không có API key khả dụng.', { code: 'AUTH', status: 400 });
}
