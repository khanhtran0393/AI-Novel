import { FLOW_BASE, FLOW_DEFAULTS, FLOW_PUBLIC_API_KEY } from './config';
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
  const model = opts.imageModel || FLOW_DEFAULTS.imageModel;
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
  const portrait = isPortraitRatio(opts.aspectRatio);
  const model =
    opts.videoModel ||
    (portrait
      ? FLOW_DEFAULTS.videoModelT2vPortrait
      : FLOW_DEFAULTS.videoModelT2vLandscape);

  const clientContext = buildClientContext(opts.projectId, '');
  const req: Record<string, unknown> = {
    aspectRatio: mapVideoAspectRatio(opts.aspectRatio),
    seed: randomSeed(),
    textInput: { prompt: opts.prompt },
    videoModelKey: model,
    metadata: { sceneId: `scene_${Date.now()}` },
  };
  if (opts.durationSec && [4, 6, 8, 10].includes(opts.durationSec)) {
    // Duration is encoded in some model keys; keep field if API accepts
    req.videoLengthSeconds = opts.durationSec;
  }

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
}): { url: string; body: Record<string, unknown>; captchaAction: string } {
  const portrait = isPortraitRatio(opts.aspectRatio);
  const hasEnd = Boolean(opts.endMediaId);
  const model =
    opts.videoModel ||
    (portrait
      ? FLOW_DEFAULTS.videoModelI2vPortrait
      : FLOW_DEFAULTS.videoModelI2vLandscape);

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

export function buildCheckVideoStatusBody(ops: unknown[]): {
  url: string;
  body: Record<string, unknown>;
} {
  return {
    url: `${FLOW_BASE}/v1/video:batchCheckAsyncVideoGenerationStatus?key=${FLOW_PUBLIC_API_KEY}`,
    body: { operations: ops },
  };
}

export function buildUploadImageBody(opts: {
  projectId: string;
  mimeType: string;
  rawImageBytes: string;
}): { url: string; body: Record<string, unknown> } {
  return {
    url: `${FLOW_BASE}/v1:uploadImage?key=${FLOW_PUBLIC_API_KEY}`,
    body: {
      imageInput: {
        rawImageBytes: opts.rawImageBytes,
        mimeType: opts.mimeType || 'image/png',
      },
      clientContext: buildClientContext(opts.projectId, ''),
    },
  };
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

export function extractVideoOperations(data: unknown): unknown[] {
  const root = data as Record<string, unknown> | null;
  if (!root) return [];
  if (Array.isArray(root.operations)) return root.operations;
  if (Array.isArray(root.responses)) return root.responses;
  if (root.name || root.operation) return [root];
  return [];
}

export function extractVideoMedia(data: unknown): {
  mediaIds: string[];
  urls: string[];
  done: boolean;
  error?: string;
} {
  const mediaIds: string[] = [];
  const urls: string[] = [];
  let done = false;
  let error: string | undefined;

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.done === true || o.status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
      done = true;
    }
    if (typeof o.error === 'object' && o.error) {
      const e = o.error as { message?: string };
      error = e.message || JSON.stringify(o.error);
    }
    if (typeof o.error === 'string') error = o.error;

    const vid =
      (o.video as Record<string, unknown>) ||
      (o.generatedVideo as Record<string, unknown>) ||
      o;
    const mid = String(
      (vid as { mediaId?: string }).mediaId ||
        (o.mediaId as string) ||
        '',
    );
    if (mid && mid.length > 8) mediaIds.push(mid);

    for (const key of ['fifeUrl', 'videoUri', 'url', 'downloadUrl', 'uri']) {
      const u = String((vid as Record<string, unknown>)[key] || o[key] || '');
      if (u.startsWith('http') && (u.includes('video') || u.includes('storage'))) {
        urls.push(u);
        done = true;
      }
    }

    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') walk(v);
    }
  };

  if (Array.isArray(data)) {
    for (const item of data) walk(item);
  } else {
    walk(data);
  }

  return { mediaIds: [...new Set(mediaIds)], urls: [...new Set(urls)], done, error };
}
