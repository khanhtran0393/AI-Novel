import { FLOW_BASE, FLOW_DEFAULTS, FLOW_PUBLIC_API_KEY } from './config';
import {
  clampFlowVideoDuration,
  resolveFirstLastModel,
  resolveFlowImageModelName,
  resolvePortraitModel,
} from './modelCatalog';
import { injectFaceLockPrompt } from './promptInjector';

export function mapImageAspectRatio(ratio?: string): string {
  const r = (ratio || '16:9').trim();
  if (r === '9:16' || r === '2:3' || r === '3:4' || r === '4:5') {
    return 'IMAGE_ASPECT_RATIO_PORTRAIT';
  }
  if (r === '1:1') return 'IMAGE_ASPECT_RATIO_SQUARE';
  return 'IMAGE_ASPECT_RATIO_LANDSCAPE';
}

export function mapVideoAspectRatio(ratio?: string): string {
  const r = (ratio || '16:9').trim();
  if (r === '9:16' || r === '2:3' || r === '3:4' || r === '4:5') {
    return 'VIDEO_ASPECT_RATIO_PORTRAIT';
  }
  return 'VIDEO_ASPECT_RATIO_LANDSCAPE';
}

export function isPortraitRatio(ratio?: string): boolean {
  const r = (ratio || '16:9').trim();
  return r === '9:16' || r === '2:3' || r === '3:4' || r === '4:5';
}

function sessionId(): string {
  return `;${Date.now()}`;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

/**
 * Flow model keys must match the endpoint family (T2V / I2V / reference / extend).
 * IRON B10: KHÔNG auto-swap model ngầm. Sai model → throw rõ để CISO sửa UI/config.
 * Chỉ khi UI không gửi model: dùng default của đúng family (không phải fail-over).
 */
export type FlowVideoModelFamily = 't2v' | 'i2v' | 'reference' | 'extend';

export function detectVideoModelFamily(model?: string): FlowVideoModelFamily | 'unknown' {
  const m = String(model || '').toLowerCase();
  if (!m) return 'unknown';
  // Upsample is post-process; treat as extend family for endpoint gate only when building upsample body
  if (m.includes('upsampler')) return 'extend';
  if (m.includes('extend')) return 'extend';
  // R2V / ingredients (Flow keys: veo_*_r2v_*, legacy reference_*)
  if (
    m.includes('r2v') ||
    m.includes('reference') ||
    m.includes('ingredient')
  ) {
    return 'reference';
  }
  // I2V includes lite / low_priority / _fl (first+last)
  if (
    m.includes('i2v') ||
    m.includes('start_image') ||
    m.includes('img2vid') ||
    m.includes('frame_2_video')
  ) {
    return 'i2v';
  }
  if (m.includes('t2v') || m.includes('text')) return 't2v';
  return 'unknown';
}

export function defaultFlowVideoModelKey(
  family: FlowVideoModelFamily,
  aspectRatio?: string,
): string {
  const portrait = isPortraitRatio(aspectRatio);
  if (family === 't2v') {
    return portrait
      ? FLOW_DEFAULTS.videoModelT2vPortrait
      : FLOW_DEFAULTS.videoModelT2vLandscape;
  }
  if (family === 'i2v') {
    return portrait
      ? FLOW_DEFAULTS.videoModelI2vPortrait
      : FLOW_DEFAULTS.videoModelI2vLandscape;
  }
  if (family === 'reference') {
    return portrait
      ? FLOW_DEFAULTS.videoModelReferencePortrait
      : FLOW_DEFAULTS.videoModelReferenceLandscape;
  }
  return FLOW_DEFAULTS.videoModelExtend;
}

/**
 * Resolve videoModelKey for endpoint family.
 * - Empty UI model → default of that family only
 * - Wrong family (e.g. t2v on I2V) → throw MODEL_MISMATCH (no silent swap)
 */
export function resolveFlowVideoModelKey(
  family: FlowVideoModelFamily,
  opts: {
    videoModel?: string;
    aspectRatio?: string;
    /** When true and model has firstLastVariant, prefer *_fl key */
    hasEndFrame?: boolean;
  },
): string {
  const raw = String(opts.videoModel || '').trim();
  const detected = detectVideoModelFamily(raw);
  const expected = defaultFlowVideoModelKey(family, opts.aspectRatio);

  if (!raw) {
    return expected;
  }

  if (detected !== 'unknown' && detected !== family) {
    throw new Error(
      `MODEL_MISMATCH: Model UI "${raw}" thuộc nhánh ${detected.toUpperCase()} ` +
        `nhưng endpoint đang là ${family.toUpperCase()}. ` +
        `Chọn model ${family.toUpperCase()} trong Cấu hình Ảnh/Video (vd. ${expected}). ` +
        `App không auto-swap model (IRON B10 — sửa config, không fallback ngầm).`,
    );
  }

  // Order: first+last sibling first, then portrait (fl models have portraitVariant *_fl)
  let key = raw;
  if (opts.hasEndFrame) {
    key = resolveFirstLastModel(key, true) || key;
  }
  key = resolvePortraitModel(key, isPortraitRatio(opts.aspectRatio)) || key;
  return key;
}

export function buildClientContext(
  projectId: string,
  captchaToken = '',
): Record<string, unknown> {
  return {
    projectId,
    sessionId: sessionId(),
    tool: 'PINHOLE',
    userPaygateTier: 'PAYGATE_TIER_TWO',
    recaptchaContext: {
      applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      token: captchaToken,
    },
  };
}

export function buildImageGenerateBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  imageCount?: number;
  imageModel?: string;
  imageMediaIds?: string[];
  /** Apply FlowAgent face-lock injector when true / media present */
  faceLock?: boolean;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const count = Math.max(1, Math.min(4, Number(opts.imageCount) || 1));
  const model = resolveFlowImageModelName(opts.imageModel || FLOW_DEFAULTS.imageModel);
  const aspect = mapImageAspectRatio(opts.aspectRatio);
  // Empty captcha token — extension fills clientContext.recaptchaContext.token
  const clientContext = buildClientContext(opts.projectId, '');

  const hasRef = Boolean(opts.imageMediaIds?.length) || opts.faceLock;
  const finalPrompt = injectFaceLockPrompt(opts.prompt, {
    hasReference: hasRef,
    mediaId: opts.imageMediaIds?.[0],
  });

  const requests = Array.from({ length: count }, () => {
    const req: Record<string, unknown> = {
      seed: randomSeed(),
      prompt: finalPrompt,
      imageAspectRatio: aspect,
      imageModelName: model,
      clientContext: { ...clientContext },
    };
    if (opts.imageMediaIds?.length) {
      req.imageInputs = opts.imageMediaIds.map((name) => ({
        name,
        imageInputType: 'IMAGE_INPUT_TYPE_BASE_IMAGE',
      }));
    }
    return req;
  });

  const projectPath = opts.projectId
    ? `/v1/projects/${opts.projectId}/flowMedia:batchGenerateImages`
    : `/v1/flowMedia:batchGenerateImages`;

  return {
    url: `${FLOW_BASE}${projectPath}?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests,
    },
    captchaAction: 'IMAGE_GENERATION',
  };
}

/** Upscale image (FlowAgent stage 6) — 2K / 4K */
export function buildUpsampleImageBody(opts: {
  projectId: string;
  mediaId: string;
  resolution?: '2k' | '4k' | '1k';
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const res =
    opts.resolution === '4k'
      ? 'IMAGE_RESOLUTION_4K'
      : opts.resolution === '2k'
        ? 'IMAGE_RESOLUTION_2K'
        : 'IMAGE_RESOLUTION_1K';
  const clientContext = buildClientContext(opts.projectId, '');
  return {
    url: `${FLOW_BASE}/v1/flow/upsampleImage?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [
        {
          mediaId: opts.mediaId,
          targetResolution: res,
          clientContext: { ...clientContext },
        },
      ],
    },
    captchaAction: 'IMAGE_GENERATION',
  };
}

/** Upscale video FHD/4K — FlowAgent batchAsyncGenerateVideoUpsampleVideo */
export function buildUpsampleVideoBody(opts: {
  projectId: string;
  mediaId: string;
  aspectRatio?: string;
  resolution?: 'fhd' | '4k' | 'hd';
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const portrait = isPortraitRatio(opts.aspectRatio);
  const is4k = opts.resolution === '4k';
  const clientContext = buildClientContext(opts.projectId, '');
  return {
    url: `${FLOW_BASE}/v1/video:batchAsyncGenerateVideoUpsampleVideo?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [
        {
          aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
          resolution: is4k ? 'VIDEO_RESOLUTION_4K' : 'VIDEO_RESOLUTION_1080P',
          seed: randomSeed(),
          metadata: { sceneId: `up_${Date.now()}` },
          videoInput: { mediaId: opts.mediaId },
          videoModelKey: is4k
            ? 'veo_3_1_upsampler_4k'
            : 'veo_3_1_upsampler_1080p',
          clientContext: { ...clientContext },
        },
      ],
    },
    captchaAction: 'VIDEO_GENERATION',
  };
}

export function buildVideoT2VBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  videoModel?: string;
  durationSec?: number;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const model = resolveFlowVideoModelKey('t2v', {
    videoModel: opts.videoModel,
    aspectRatio: opts.aspectRatio,
  });
  // Flow Veo: only 4 / 6 / 8 seconds
  const durationSec = clampFlowVideoDuration(opts.durationSec, model);

  const clientContext = buildClientContext(opts.projectId, '');
  // Duration is model-native (typically 8s). Do NOT send videoLengthSeconds —
  // aisandbox rejects: Unknown name "videoLengthSeconds".
  void durationSec;
  const req: Record<string, unknown> = {
    aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
    seed: randomSeed(),
    textInput: { prompt: opts.prompt },
    videoModelKey: model,
    metadata: { sceneId: `scene_${Date.now()}` },
  };

  return {
    url: `${FLOW_BASE}/v1/video:batchAsyncGenerateVideoText?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [req],
    },
    captchaAction: 'VIDEO_GENERATION',
  };
}

export function buildVideoI2VBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  videoModel?: string;
  startMediaId: string;
  endMediaId?: string;
  durationSec?: number;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const hasEnd = Boolean(opts.endMediaId);
  const model = resolveFlowVideoModelKey('i2v', {
    videoModel: opts.videoModel,
    aspectRatio: opts.aspectRatio,
    hasEndFrame: hasEnd,
  });
  const durationSec = clampFlowVideoDuration(opts.durationSec, model);
  void durationSec; // model-native length; field rejected by API

  const clientContext = buildClientContext(opts.projectId, '');
  const req: Record<string, unknown> = {
    aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
    seed: randomSeed(),
    textInput: { prompt: opts.prompt },
    videoModelKey: model,
    startImage: { mediaId: opts.startMediaId },
    metadata: { sceneId: `scene_${Date.now()}` },
  };
  if (hasEnd) {
    req.endImage = { mediaId: opts.endMediaId };
  }

  const endpoint = hasEnd
    ? '/v1/video:batchAsyncGenerateVideoStartAndEndImage'
    : '/v1/video:batchAsyncGenerateVideoStartImage';

  return {
    url: `${FLOW_BASE}${endpoint}?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [req],
    },
    captchaAction: 'VIDEO_GENERATION',
  };
}

/**
 * Ingredients-to-video (P0): 1–3 reference image mediaIds + text.
 * Endpoint names follow aisandbox / Flow reference-image family.
 */
export function buildVideoIngredientsBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  videoModel?: string;
  referenceMediaIds: string[];
  durationSec?: number;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const ids = opts.referenceMediaIds.filter(Boolean).slice(0, 3);
  // Prefer R2V key; if UI sent i2v/t2v → MODEL_MISMATCH (B10)
  const model = resolveFlowVideoModelKey('reference', {
    videoModel: opts.videoModel,
    aspectRatio: opts.aspectRatio,
  });
  const durationSec = clampFlowVideoDuration(opts.durationSec, model);
  void durationSec;

  const clientContext = buildClientContext(opts.projectId, '');
  const req: Record<string, unknown> = {
    aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
    seed: randomSeed(),
    textInput: { prompt: opts.prompt },
    videoModelKey: model,
    // Flow ingredients: mediaId refs only (do not send imageInputs — upload schema changed 2026)
    referenceImages: ids.map((mediaId) => ({ mediaId })),
    metadata: { sceneId: `ing_${Date.now()}` },
  };

  return {
    url: `${FLOW_BASE}/v1/video:batchAsyncGenerateVideoReferenceImages?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [req],
    },
    captchaAction: 'VIDEO_GENERATION',
  };
}

/**
 * Extend existing Flow video media (P0).
 * Falls back gracefully in queue if API rejects.
 */
export function buildVideoExtendBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  videoModel?: string;
  sourceMediaId: string;
  durationSec?: number;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const clientContext = buildClientContext(opts.projectId, '');
  const model = resolveFlowVideoModelKey('extend', {
    videoModel: opts.videoModel,
    aspectRatio: opts.aspectRatio,
  });
  const durationSec = clampFlowVideoDuration(opts.durationSec, model);
  void durationSec;
  const req: Record<string, unknown> = {
    aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
    seed: randomSeed(),
    textInput: { prompt: opts.prompt },
    videoModelKey: model,
    videoInput: { mediaId: opts.sourceMediaId },
    metadata: { sceneId: `ext_${Date.now()}` },
  };
  return {
    url: `${FLOW_BASE}/v1/video:batchAsyncGenerateVideoExtendVideo?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      clientContext,
      requests: [req],
    },
    captchaAction: 'VIDEO_GENERATION',
  };
}

/**
 * Light image edit / object guidance via reference re-gen (P1 best-effort).
 * Uses batchGenerateImages with base image + edit prompt — not pixel mask.
 */
export function buildImageEditBody(opts: {
  projectId: string;
  prompt: string;
  aspectRatio?: string;
  imageModel?: string;
  baseMediaId: string;
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const editPrompt = [
    opts.prompt.trim(),
    'Edit the provided base image only. Preserve composition and identity unless asked to change.',
  ].join(' ');
  return buildImageGenerateBody({
    projectId: opts.projectId,
    prompt: editPrompt,
    aspectRatio: opts.aspectRatio,
    imageCount: 1,
    imageModel: opts.imageModel,
    imageMediaIds: [opts.baseMediaId],
    faceLock: true,
  });
}

export function buildCheckVideoStatusBody(ops: unknown[]): {
  url: string;
  body: Record<string, unknown>;
} {
  return {
    url: `${FLOW_BASE}/v1/video:batchCheckAsyncVideoGenerationStatus?key=${FLOW_PUBLIC_API_KEY}`,
    body: { operations: ops },
  };
}

/** Poll a single media entity (image/video) by id — Flow returns fifeUrl when ready. */
export function buildGetMediaUrl(mediaId: string): string {
  const id = encodeURIComponent(String(mediaId || '').trim());
  return `${FLOW_BASE}/v1/media/${id}?key=${FLOW_PUBLIC_API_KEY}`;
}

/**
 * Upload local image → Flow media id.
 *
 * Schema from FlowAgent `omniflash.generators.i2v.upload_image` (PYZ reverse):
 *   POST /v1/flow/uploadImage
 *   body = {
 *     clientContext: { tool: 'PINHOLE', projectId },
 *     imageBytes, fileName, isHidden: false, isUserUploaded: true, mimeType
 *   }
 *   response: { media: { name: "<uuid>" } }  (id = media.name)
 *
 * NEVER send `imageInput` — API 400: Unknown name "imageInput".
 */
export function buildUploadClientContext(
  projectId: string,
): Record<string, unknown> {
  return {
    tool: 'PINHOLE',
    projectId: String(projectId || '').trim(),
  };
}

export function buildUploadImageCandidates(opts: {
  projectId: string;
  mimeType: string;
  rawImageBytes: string;
  fileName?: string;
}): { url: string; body: Record<string, unknown>; label: string }[] {
  const mime = opts.mimeType || 'image/png';
  let bytes = opts.rawImageBytes || '';
  // Strip data-URL prefix if present
  if (bytes.includes('base64,')) {
    bytes = bytes.slice(bytes.indexOf('base64,') + 7);
  }
  const fileName =
    String(opts.fileName || 'upload.png')
      .replace(/[^\w.\-()+\s]/g, '_')
      .slice(0, 120) || 'upload.png';
  const keyQ = `key=${FLOW_PUBLIC_API_KEY}`;
  const uploadCtx = buildUploadClientContext(opts.projectId);
  const fullCtx = buildClientContext(opts.projectId, '');
  const primaryUrl = `${FLOW_BASE}/v1/flow/uploadImage?${keyQ}`;

  // FlowAgent-exact body (order matches co_const field list)
  const flowAgentBody: Record<string, unknown> = {
    clientContext: uploadCtx,
    imageBytes: bytes,
    fileName,
    isHidden: false,
    isUserUploaded: true,
    mimeType: mime,
  };

  const out: { url: string; body: Record<string, unknown>; label: string }[] = [
    {
      label: 'flowAgent@flow/uploadImage',
      url: primaryUrl,
      body: { ...flowAgentBody },
    },
    {
      label: 'flowAgent+fullCtx@flow/uploadImage',
      url: primaryUrl,
      body: { ...flowAgentBody, clientContext: fullCtx },
    },
  ];

  if (opts.projectId) {
    out.push({
      label: 'flowAgent@project/flowMedia:uploadImage',
      url: `${FLOW_BASE}/v1/projects/${encodeURIComponent(opts.projectId)}/flowMedia:uploadImage?${keyQ}`,
      body: { ...flowAgentBody },
    });
  }

  // Minimal flat (still no imageInput)
  out.push({
    label: 'flat-imageBytes@flow/uploadImage',
    url: primaryUrl,
    body: {
      clientContext: uploadCtx,
      imageBytes: bytes,
    },
  });

  // Hard guard — never emit legacy field
  for (const c of out) {
    if (c.body && 'imageInput' in c.body) {
      delete c.body.imageInput;
    }
  }
  return out;
}

/**
 * Extract media id from uploadImage response.
 * Live shape: { media: { name: "<uuid>" } } — NOT top-level mediaId.
 */
export function extractUploadMediaId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;

  // Live 2026: media.name is the id used by I2V startImage.mediaId
  if (d.media && typeof d.media === 'object') {
    const media = d.media as Record<string, unknown>;
    if (typeof media.name === 'string' && media.name.length > 8) {
      return media.name;
    }
    if (typeof media.mediaId === 'string' && media.mediaId) {
      return media.mediaId;
    }
    if (media.mediaId && typeof media.mediaId === 'object') {
      const nested = (media.mediaId as { mediaId?: string }).mediaId;
      if (nested) return nested;
    }
  }

  if (typeof d.mediaId === 'string' && d.mediaId) return d.mediaId;
  if (d.mediaId && typeof d.mediaId === 'object') {
    const nested = (d.mediaId as { mediaId?: string }).mediaId;
    if (nested) return nested;
  }

  for (const k of ['uploadedMedia', 'result', 'mediaGenerationId']) {
    const v = d[k];
    if (typeof v === 'string' && v.length > 8) return v;
    if (v && typeof v === 'object') {
      const o = v as { mediaId?: string; name?: string };
      if (o.mediaId) return String(o.mediaId);
      if (o.name) return String(o.name);
    }
  }

  const raw = JSON.stringify(d);
  const m =
    raw.match(/"media"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/) ||
    raw.match(/"mediaId"\s*:\s*"([^"]+)"/) ||
    raw.match(
      /"name"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    ) ||
    raw.match(/"(CAUQ[A-Za-z0-9_-]+)"/) ||
    raw.match(/"(media_[^"]+)"/);
  return m?.[1];
}

/** Primary upload shape (FlowAgent-exact). Prefer multi-try via candidates. */
export function buildUploadImageBody(opts: {
  projectId: string;
  mimeType: string;
  rawImageBytes: string;
  fileName?: string;
}): { url: string; body: Record<string, unknown> } {
  const first = buildUploadImageCandidates(opts)[0];
  return { url: first.url, body: first.body };
}

export function buildCreditsUrl(): string {
  return `${FLOW_BASE}/v1/credits?key=${FLOW_PUBLIC_API_KEY}`;
}

export function buildBrowserHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: 'https://labs.google',
    Referer: 'https://labs.google/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
}

/** Extract generated image buffers/urls from Flow response. */
export function extractImageResults(data: unknown): {
  mediaIds: string[];
  urls: string[];
  base64List: string[];
} {
  const mediaIds: string[] = [];
  const urls: string[] = [];
  const base64List: string[] = [];

  const root = data as Record<string, unknown> | null;
  if (!root) return { mediaIds, urls, base64List };

  const media = (root.media || root.results || []) as unknown[];
  const list = Array.isArray(media) ? media : [];

  for (const item of list) {
    const m = item as Record<string, unknown>;
    const image = (m.image || m) as Record<string, unknown>;
    const gen = (image.generatedImage || image) as Record<string, unknown>;
    const mid = String(gen.mediaId || m.mediaId || '');
    if (mid) mediaIds.push(mid);
    const url = String(gen.fifeUrl || gen.imageUri || gen.url || '');
    if (url.startsWith('http')) urls.push(url);
    const b64 = String(gen.encodedImage || gen.imageBytes || '');
    if (b64 && b64.length > 64) base64List.push(b64);
  }

  // Nested variants
  if (!list.length && root.responses && Array.isArray(root.responses)) {
    for (const r of root.responses as Record<string, unknown>[]) {
      const nested = extractImageResults(r);
      mediaIds.push(...nested.mediaIds);
      urls.push(...nested.urls);
      base64List.push(...nested.base64List);
    }
  }

  return { mediaIds, urls, base64List };
}

/**
 * Extract poll handles for batchCheckAsyncVideoGenerationStatus.
 *
 * Live-verified 2026-07:
 *   OK:   { operations: [{ operation: { name: "<primaryMediaId>" } }] }
 *         → MEDIA_GENERATION_STATUS_ACTIVE / SUCCESSFUL
 *   FAIL: operation.name = workflow UUID → "Video not found"
 *   FAIL: bare { name } → Unknown name "name"
 *
 * So we ONLY emit { operation: { name: mediaGenerationId } } using
 * workflows[].metadata.primaryMediaId or media[].name — never workflow.name.
 */
export function extractVideoOperations(data: unknown): unknown[] {
  const root = data as Record<string, unknown> | null;
  if (!root) return [];

  // Already classic operations from a prior batchCheck — keep only valid shapes
  if (Array.isArray(root.operations) && root.operations.length) {
    const cleaned: unknown[] = [];
    for (const raw of root.operations) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      // Prefer nested operation.name if it is a media id (not failed workflow)
      if (o.operation && typeof o.operation === 'object') {
        const op = o.operation as Record<string, unknown>;
        const n = String(op.name || '');
        const st = String(o.status || '');
        // Drop terminal "Video not found" workflow checks
        if (
          st.includes('FAILED') &&
          String((op as { error?: { message?: string } }).error?.message || '')
            .toLowerCase()
            .includes('not found')
        ) {
          continue;
        }
        if (n.length > 8) {
          cleaned.push({ operation: { name: n } });
        }
        continue;
      }
      const mid = String(
        o.mediaGenerationId || o.mediaId || (o as { name?: string }).name || '',
      );
      if (mid.length > 8) cleaned.push({ operation: { name: mid } });
    }
    if (cleaned.length) return dedupeOps(cleaned);
  }

  if (Array.isArray(root.responses) && root.responses.length) {
    return dedupeOps(root.responses);
  }

  const mediaIds: string[] = [];
  const pushId = (v: unknown) => {
    const s = String(v || '').trim();
    if (s.length >= 8 && !mediaIds.includes(s)) mediaIds.push(s);
  };

  const workflows = Array.isArray(root.workflows) ? root.workflows : [];
  for (const raw of workflows) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    const meta = (w.metadata || {}) as Record<string, unknown>;
    // primaryMediaId ONLY — workflow.name is NOT a valid batchCheck name
    pushId(meta.primaryMediaId);
    pushId(meta.mediaId);
    pushId(w.primaryMediaId);
  }

  const mediaList = Array.isArray(root.media) ? root.media : [];
  for (const raw of mediaList) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    pushId(m.name);
    pushId(m.mediaId);
    if (m.video && typeof m.video === 'object') {
      const v = m.video as Record<string, unknown>;
      pushId(v.mediaId);
      if (v.generatedVideo && typeof v.generatedVideo === 'object') {
        pushId((v.generatedVideo as Record<string, unknown>).mediaId);
      }
    }
  }

  if (root.operation && typeof root.operation === 'object') {
    pushId((root.operation as { name?: string }).name);
  }

  return mediaIds.map((name) => ({ operation: { name } }));
}

function dedupeOps(ops: unknown[]): unknown[] {
  const seen = new Set<string>();
  return ops.filter((o) => {
    const k = JSON.stringify(o);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Collect media UUIDs from workflows/media for GET /v1/media/{id} fallback. */
export function extractPendingMediaIds(data: unknown): string[] {
  const ids: string[] = [];
  const root = data as Record<string, unknown> | null;
  if (!root) return ids;

  const push = (v: unknown) => {
    const s = String(v || '').trim();
    if (s.length >= 8 && !ids.includes(s)) ids.push(s);
  };

  const workflows = Array.isArray(root.workflows) ? root.workflows : [];
  for (const raw of workflows) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    const meta = (w.metadata || {}) as Record<string, unknown>;
    push(meta.primaryMediaId);
    push(meta.mediaId);
    push(w.primaryMediaId);
  }

  const mediaList = Array.isArray(root.media) ? root.media : [];
  for (const raw of mediaList) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    push(m.name);
    push(m.mediaId);
    if (m.video && typeof m.video === 'object') {
      push((m.video as Record<string, unknown>).mediaId);
    }
  }

  return ids;
}

function isLikelyVideoUrl(u: string): boolean {
  if (!u.startsWith('http')) return false;
  const s = u.toLowerCase();
  return (
    s.includes('video') ||
    s.includes('storage.googleapis.com') ||
    s.includes('videofx') ||
    s.includes('ai-sandbox') ||
    s.includes('.mp4') ||
    s.includes('fife') ||
    s.includes('googleusercontent')
  );
}

export function extractVideoMedia(data: unknown): {
  mediaIds: string[];
  urls: string[];
  /** Base64 MP4 payloads (GET /v1/media often returns video.encodedVideo) */
  base64List: string[];
  done: boolean;
  error?: string;
} {
  const mediaIds: string[] = [];
  const urls: string[] = [];
  const base64List: string[] = [];
  let done = false;
  let error: string | undefined;

  const pushB64 = (raw: unknown) => {
    const s = String(raw || '').trim();
    // MP4 base64 is large; ftyp marker often starts with AAAAGGZ0eXBpc29t… (iso)
    if (s.length > 500 && !base64List.includes(s)) {
      base64List.push(s);
      done = true;
    }
  };

  const walk = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return;
    const o = node as Record<string, unknown>;
    const status = String(o.status || '');
    // Nested mediaGenerationStatus (GET /v1/media)
    const nestedStatus = String(
      (o.mediaStatus as { mediaGenerationStatus?: string } | undefined)
        ?.mediaGenerationStatus ||
        (
          o.mediaMetadata as {
            mediaStatus?: { mediaGenerationStatus?: string };
          } | undefined
        )?.mediaStatus?.mediaGenerationStatus ||
        '',
    );
    if (
      o.done === true ||
      status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL' ||
      status === 'MEDIA_GENERATION_STATUS_COMPLETE' ||
      status === 'SUCCESSFUL' ||
      status === 'COMPLETED' ||
      nestedStatus === 'MEDIA_GENERATION_STATUS_SUCCESSFUL' ||
      nestedStatus === 'MEDIA_GENERATION_STATUS_COMPLETE'
    ) {
      done = true;
    }
    if (
      status.includes('FAILED') ||
      status.includes('ERROR') ||
      status === 'MEDIA_GENERATION_STATUS_FAILED' ||
      nestedStatus.includes('FAILED')
    ) {
      error =
        (typeof o.error === 'string' && o.error) ||
        (typeof o.error === 'object' && o.error
          ? ((o.error as { message?: string }).message ||
              JSON.stringify(o.error))
          : undefined) ||
        `Video status ${status || nestedStatus}`;
    }
    if (typeof o.error === 'object' && o.error) {
      const e = o.error as { message?: string };
      error = e.message || JSON.stringify(o.error);
    }
    if (typeof o.error === 'string' && o.error) error = o.error;

    // Live GET /v1/media: { name, video: { encodedVideo: "<b64>" } }
    if (typeof o.encodedVideo === 'string') pushB64(o.encodedVideo);
    if (o.video && typeof o.video === 'object') {
      const v = o.video as Record<string, unknown>;
      if (typeof v.encodedVideo === 'string') pushB64(v.encodedVideo);
      if (v.generatedVideo && typeof v.generatedVideo === 'object') {
        const gv = v.generatedVideo as Record<string, unknown>;
        if (typeof gv.encodedVideo === 'string') pushB64(gv.encodedVideo);
      }
    }

    const vid =
      (o.video as Record<string, unknown>) ||
      (o.generatedVideo as Record<string, unknown>) ||
      (o.media as Record<string, unknown>) ||
      o;

    const mid = String(
      (vid as { mediaId?: string }).mediaId ||
        o.mediaId ||
        o.primaryMediaId ||
        (typeof o.name === 'string' &&
        /^[0-9a-f-]{20,}$/i.test(o.name)
          ? o.name
          : '') ||
        '',
    );
    if (mid && mid.length > 8) mediaIds.push(mid);

    for (const key of [
      'fifeUrl',
      'videoUri',
      'url',
      'downloadUrl',
      'uri',
      'signedUri',
      'servingBaseUri',
      'videoUrl',
    ]) {
      const u = String((vid as Record<string, unknown>)[key] || o[key] || '');
      if (isLikelyVideoUrl(u)) {
        urls.push(u);
        done = true;
      }
    }

    // Direct string values that look like media URLs
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && isLikelyVideoUrl(v)) {
        urls.push(v);
        done = true;
      } else if (v && typeof v === 'object') {
        walk(v, depth + 1);
      }
    }
  };

  if (Array.isArray(data)) {
    for (const item of data) walk(item);
  } else {
    walk(data);
  }

  // Seed mediaIds from workflow envelope even when video not ready
  for (const id of extractPendingMediaIds(data)) {
    if (!mediaIds.includes(id)) mediaIds.push(id);
  }

  return {
    mediaIds: [...new Set(mediaIds)],
    urls: [...new Set(urls)],
    base64List: [...new Set(base64List)],
    done: done || urls.length > 0 || base64List.length > 0,
    error,
  };
}
