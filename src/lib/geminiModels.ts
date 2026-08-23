export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.6-flash';
export const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

export const GEMINI_TEXT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
] as const;

export type GeminiTextModel = (typeof GEMINI_TEXT_MODELS)[number];

export const GEMINI_TEXT_MODEL_OPTIONS: ReadonlyArray<{
  value: GeminiTextModel;
  label: string;
  note: string;
  recommended?: boolean;
}> = [
  {
    value: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash — khuyên dùng',
    note: 'Stable mới nhất, nên dùng mặc định cho write/prompt.',
    recommended: true,
  },
  {
    value: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash — stable',
    note: 'Stable nhưng quyền truy cập/rate limit phụ thuộc project.',
  },
  {
    value: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite — stable nhẹ',
    note: 'Stable, rẻ/nhanh hơn nhưng vẫn cần kiểm tra key.',
  },
  {
    value: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite — stable nhẹ',
    note: 'Stable; một số project có thể bị giới hạn model.',
  },
  {
    value: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash — legacy stable',
    note: 'Còn được Google liệt kê nhưng nên health-check trước khi dùng.',
  },
  {
    value: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite — legacy stable',
    note: 'Còn được Google liệt kê nhưng nên health-check trước khi dùng.',
  },
  {
    value: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro — nặng/quota cao',
    note: 'Phù hợp tác vụ khó; dễ chạm quota hơn Flash.',
  },
  {
    value: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash — fallback 2.0',
    note: 'Model 2.0 fallback khi 3.x/2.5 bị chạm quota.',
  },
  {
    value: 'gemini-2.0-flash-lite',
    label: 'Gemini 2.0 Flash-Lite — fallback 2.0 nhẹ',
    note: 'Model 2.0 Lite fallback khi 3.x/2.5 bị chạm quota.',
  },
];

export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_IMAGE_REQUIRES_BILLING = true;

export const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

export const GEMINI_VEO_MODELS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-lite-generate-preview',
] as const;

export const DEFAULT_GEMINI_VEO_MODEL = GEMINI_VEO_MODELS[0];
export const GEMINI_VEO_REQUIRES_BILLING = true;

export const RETIRED_GOOGLE_MODELS = [
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-pro-preview',
  'imagen-3.0-generate-002',
  'imagen-3.0-fast-generate-002',
  'veo-3.0-generate-preview',
  'veo-2.0-generate-001',
  'gemini-2.5-flash-preview-video',
] as const;

export function normalizeGeminiTextModel(model?: string): string {
  const raw = String(model || '').trim();
  if (!raw || raw === 'gemini' || raw === 'aistudio') {
    return DEFAULT_GEMINI_TEXT_MODEL;
  }
  return raw;
}

export function isRetiredGoogleModel(model?: string): boolean {
  const raw = String(model || '').trim();
  return (RETIRED_GOOGLE_MODELS as readonly string[]).includes(raw);
}

export function isSupportedGeminiTextModel(
  model?: string,
): model is GeminiTextModel {
  const raw = String(model || '').trim();
  return (GEMINI_TEXT_MODELS as readonly string[]).includes(raw);
}

export function normalizePersistedGeminiTextModel(model?: string): string {
  const normalized = normalizeGeminiTextModel(model);
  return isSupportedGeminiTextModel(normalized)
    ? normalized
    : DEFAULT_GEMINI_TEXT_MODEL;
}

export function assertSupportedGeminiTextModel(model: string): void {
  const normalized = normalizeGeminiTextModel(model);
  if (isRetiredGoogleModel(normalized)) {
    throw new Error(
      `[Gemini] Model "${normalized}" đã ngừng/preview cũ. Chọn ${DEFAULT_GEMINI_TEXT_MODEL} hoặc một model stable trong Settings.`,
    );
  }
  if (!isSupportedGeminiTextModel(normalized)) {
    throw new Error(
      `[Gemini] Model "${normalized}" không nằm trong danh sách text stable mà app hỗ trợ. Dùng ${DEFAULT_GEMINI_TEXT_MODEL}, hoặc chọn Custom provider nếu đang dùng proxy riêng.`,
    );
  }
}

export function assertCurrentGoogleModel(model: string, capability: string): void {
  if (isRetiredGoogleModel(model)) {
    throw new Error(
      `[Google ${capability}] Model "${model}" đã ngừng hoạt động. Chọn model hiện hành trong Settings; app không tự đổi model ngầm.`,
    );
  }
}
