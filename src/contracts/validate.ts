/**
 * Zod request validation for hot APIs.
 * Boundary only — handlers still own business logic.
 */
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { GENERATE_REQUEST_OWNERS } from './apiMap';

const requestTypeEnum = z.enum(
  Object.keys(GENERATE_REQUEST_OWNERS) as [
    keyof typeof GENERATE_REQUEST_OWNERS,
    ...(keyof typeof GENERATE_REQUEST_OWNERS)[],
  ],
);

/** Core-loop payload shapes (soft: passthrough extras allowed). */
export const writeChapterPayloadSchema = z
  .object({
    chapterNum: z.union([z.number(), z.string()]).optional(),
    so_chuong: z.union([z.number(), z.string()]).optional(),
    outline: z.string().optional(),
    dan_y: z.string().optional(),
    title: z.string().optional(),
    tieu_de: z.string().optional(),
    previousContent: z.string().optional(),
    genre: z.string().optional(),
    context: z.string().optional(),
  })
  .passthrough();

export const expandScenePayloadSchema = z
  .object({
    sceneText: z.string().optional(),
    text: z.string().optional(),
    chapterNum: z.union([z.number(), z.string()]).optional(),
    sceneIndex: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const imagePromptPayloadSchema = z
  .object({
    sceneText: z.string().optional(),
    text: z.string().optional(),
    chapterNum: z.union([z.number(), z.string()]).optional(),
    sceneIndex: z.union([z.number(), z.string()]).optional(),
    characterPrompt: z.string().optional(),
    voiceDuration: z.union([z.number(), z.string()]).optional(),
    wpm: z.union([z.number(), z.string()]).optional(),
    /** Beat length (sec) — drives shot cap: maxShots ≈ duration / secondsPerBeat */
    secondsPerBeat: z.union([z.number(), z.string()]).optional(),
    /** Optional hard override for max prompt shots (else derived from beat + duration) */
    maxPromptShots: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const outlinePayloadSchema = z
  .object({
    idea: z.string().optional(),
    genre: z.string().optional(),
    chapterCount: z.union([z.number(), z.string()]).optional(),
    so_chuong: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const ideasPayloadSchema = z
  .object({
    theme: z.string().optional(),
    chu_de: z.string().optional(),
    genre: z.string().optional(),
    count: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const characterPayloadSchema = z
  .object({
    name: z.string().optional(),
    ten: z.string().optional(),
    text: z.string().optional(),
    sceneText: z.string().optional(),
    chapterNum: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export const foundationPayloadSchema = z
  .object({
    text: z.string().optional(),
    content: z.string().optional(),
    foundation: z.string().optional(),
    lorebook: z.string().optional(),
  })
  .passthrough();

export const visualDnaPayloadSchema = z
  .object({
    text: z.string().optional(),
    style: z.string().optional(),
    reference: z.string().optional(),
    /** `thumb_competitor` = 1-3 competitor YouTube thumbs; default = 4-6 style refs */
    mode: z.string().optional(),
    images: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const evaluateChapterPayloadSchema = z
  .object({
    chapterNum: z.union([z.number(), z.string()]).optional(),
    so_chuong: z.union([z.number(), z.string()]).optional(),
    content: z.string().optional(),
    noi_dung: z.string().optional(),
  })
  .passthrough();

export const openRecordPayloadSchema = z.record(z.string(), z.unknown()).optional().nullable();

/**
 * requestType → payload schema.
 * Soft validation (passthrough) — rejects only clearly invalid shapes.
 * Every GENERATE_REQUEST_OWNERS key has an entry.
 */
export const CORE_PAYLOAD_SCHEMAS: Record<
  keyof typeof GENERATE_REQUEST_OWNERS,
  z.ZodType
> = {
  ANALYZE_VISUAL_DNA: visualDnaPayloadSchema,
  GENERATE_IDEAS: ideasPayloadSchema,
  GENERATE_IDEA: ideasPayloadSchema,
  ANALYZE_YOUTUBE_PLOT: z
    .object({
      source_text: z.string().optional(),
      transcript: z.string().optional(),
      title: z.string().optional(),
      similarity_target: z.number().optional(),
      /** captions | metadata — when YouTube blocks captions */
      source_kind: z.string().optional(),
      sourceKind: z.string().optional(),
    })
    .passthrough(),
  GENERATE_IMAGE_PROMPT: imagePromptPayloadSchema,
  REGENERATE_PROMPT: imagePromptPayloadSchema,
  GENERATE_OUTLINE: outlinePayloadSchema,
  GENERATE_CHAPTER_OUTLINE: outlinePayloadSchema,
  PLAN_ARC: outlinePayloadSchema,
  WRITE_CHAPTER: writeChapterPayloadSchema,
  REVISE_CHAPTER: writeChapterPayloadSchema,
  EVALUATE_CHAPTER: evaluateChapterPayloadSchema,
  COMMIT_MEMORY: evaluateChapterPayloadSchema,
  EXPAND_SCENE: expandScenePayloadSchema,
  REWRITE_SCENE: expandScenePayloadSchema,
  EXTRACT_CHARACTERS: characterPayloadSchema,
  GENERATE_CHARACTER_PROMPT: characterPayloadSchema,
  GENERATE_CHARACTER_PROMPT_ONLY: characterPayloadSchema,
  COMPRESS_CONTEXT: foundationPayloadSchema,
  IMPORT_FOUNDATION: foundationPayloadSchema,
  SUMMARIZE_SCRIPT_OUTLINE: foundationPayloadSchema,
};

export const generateBodySchema = z
  .object({
    requestType: requestTypeEnum,
    apiKey: z.string().optional(),
    apiKeys: z.array(z.string()).optional(),
    model: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    const schema = CORE_PAYLOAD_SCHEMAS[val.requestType];
    if (!schema || val.payload == null) return;
    const r = schema.safeParse(val.payload);
    if (!r.success) {
      for (const issue of r.error.issues) {
        ctx.addIssue({
          code: 'custom',
          message: issue.message,
          path: ['payload', ...issue.path],
        });
      }
    }
  });

export type GenerateBody = z.infer<typeof generateBodySchema>;

export const generateTtsBodySchema = z
  .object({
    sceneText: z.string().optional(),
    chapterNum: z.union([z.number(), z.string()]).optional(),
    chuong_dang_chon: z.union([z.number(), z.string()]).optional(),
    chapter: z.union([z.number(), z.string()]).optional(),
    sceneIndex: z.union([z.number(), z.string()]).optional(),
    scene_index: z.union([z.number(), z.string()]).optional(),
    drivePath: z.string().optional(),
    voiceName: z.string().optional(),
    voice: z.string().optional(),
    apiKeys: z.array(z.string()).optional(),
    ten_tac_pham: z.string().optional(),
    ttsConfig: z
      .object({
        platform: z.string().min(1),
        voice: z.string().optional(),
        speed: z.union([z.number(), z.string()]).optional(),
        pitch: z.union([z.number(), z.string()]).optional(),
        tiktokSessionId: z.string().optional(),
        api_url_vieneu: z.string().optional(),
      })
      .passthrough()
      .optional(),
    isPreview: z.boolean().optional(),
    targetDuration: z.number().optional(),
    syncMode: z.string().optional(),
    applyLoudnorm: z.boolean().optional(),
    injectBreathPauses: z.boolean().optional(),
    roomTone: z.boolean().optional(),
    bgmMix: z.boolean().optional(),
    bgmPath: z.string().optional(),
    emotion: z.string().optional(),
    emotionTts: z.boolean().optional(),
    voiceSegments: z
      .array(
        z.object({
          text: z.string(),
          voice: z.string().optional(),
          speaker: z.string().optional(),
        }).passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const hasText = !!(val.sceneText || '').trim();
    const hasSegs =
      Array.isArray(val.voiceSegments) && val.voiceSegments.length > 0;
    if (!hasText && !hasSegs) {
      ctx.addIssue({
        code: 'custom',
        message: 'Nội dung phân cảnh rỗng (sceneText hoặc voiceSegments).',
        path: ['sceneText'],
      });
    }
    if (!val.ttsConfig?.platform) {
      ctx.addIssue({
        code: 'custom',
        message: 'Missing TTS platform (ttsConfig.platform).',
        path: ['ttsConfig', 'platform'],
      });
    }
  });

export type GenerateTtsBody = z.infer<typeof generateTtsBodySchema>;

export const generateImageBodySchema = z
  .object({
    prompt: z.string().min(1, 'Thiếu prompt ảnh.'),
    chapterNum: z.coerce.number(),
    sceneIndex: z.coerce.number(),
    promptIndex: z.coerce.number(),
    drivePath: z.string().optional(),
    ten_tac_pham: z.string().optional(),
    cookie: z.string().optional(),
    characterPrompt: z.string().optional(),
    model: z.string().optional(),
    imageProvider: z.enum(['flow', 'openai', 'gemini', 'grok']),
    imageApiKey: z.string().optional(),
    imageAspectRatio: z.string().optional(),
    imageCount: z.coerce.number().optional(),
    apiKey: z.string().optional(),
    apiKeys: z.array(z.string()).optional(),
    grokApiKey: z.string().optional(),
    grokApiKeys: z.array(z.string()).optional(),
    aiMasterApiKey: z.string().optional(),
    referenceImagePath: z.string().optional(),
  })
  .passthrough();

export type GenerateImageBody = z.infer<typeof generateImageBodySchema>;

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label = 'Request',
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    const first = details[0]?.message || 'Invalid request';
    throw new AppError(`${label}: ${first}`, {
      code: 'VALIDATION',
      status: 400,
      details,
    });
  }
  return result.data;
}
