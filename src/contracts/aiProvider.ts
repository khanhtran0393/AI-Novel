export const AI_MASTER_PROVIDERS = [
  'gemini',
  'openai',
  'grok',
  'claude',
  'custom',
] as const;

export type AiMasterProvider = (typeof AI_MASTER_PROVIDERS)[number];
export type CustomApiProtocol = 'openai' | 'gemini';

export type ResolvedAiProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'grok'
  | 'groq'
  | 'custom-openai'
  | 'custom-gemini';

export type AiProviderSelection = {
  model: string;
  explicitProvider?: AiMasterProvider;
  customApiBaseUrl?: string;
  customApiProtocol?: CustomApiProtocol;
  firstKey?: string;
};

function normalizedModel(model: string): string {
  return String(model || '').trim().toLowerCase();
}

/**
 * Provider routing is an explicit contract. Model-name inference is retained
 * only for migrated snapshots that predate aiMasterProvider.
 */
export function resolveAiProvider(
  selection: AiProviderSelection,
): ResolvedAiProvider {
  const model = normalizedModel(selection.model);
  const explicit = selection.explicitProvider;

  if (explicit === 'custom') {
    if (!selection.customApiBaseUrl?.trim()) {
      throw new Error(
        'Custom provider cần Custom Base URL hợp lệ; app không gửi model custom sang Gemini/OpenAI chính chủ.',
      );
    }
    return selection.customApiProtocol === 'gemini'
      ? 'custom-gemini'
      : 'custom-openai';
  }
  if (explicit === 'gemini') return 'gemini';
  if (explicit === 'openai') return 'openai';
  if (explicit === 'claude') return 'anthropic';
  if (explicit === 'grok') {
    return (model === 'llama' || model.startsWith('llama-')) &&
      selection.firstKey?.trim().startsWith('gsk_')
      ? 'groq'
      : 'grok';
  }

  if (selection.customApiBaseUrl?.trim()) {
    return selection.customApiProtocol === 'gemini'
      ? 'custom-gemini'
      : 'custom-openai';
  }
  if (
    model === 'gemini' ||
    model === 'aistudio' ||
    model.startsWith('gemini-')
  ) {
    return 'gemini';
  }
  if (
    model === 'gpt4o' ||
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3')
  ) {
    return 'openai';
  }
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('grok')) return 'grok';
  if (model === 'llama' || model.startsWith('llama-')) {
    return selection.firstKey?.trim().startsWith('gsk_') ? 'groq' : 'grok';
  }
  if (model.startsWith('deepseek') || model.startsWith('qwen')) {
    throw new Error(
      `Model "${selection.model}" cần chọn provider Custom và nhập Custom Base URL; app không đoán endpoint.`,
    );
  }

  throw new Error(
    `Không xác định được provider cho model "${selection.model}". Chọn provider rõ ràng trong Settings.`,
  );
}
