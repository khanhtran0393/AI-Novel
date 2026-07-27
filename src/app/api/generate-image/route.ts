import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  generateImageBodySchema,
  localImageFilename,
  parseOrThrow,
  sanitizeAssetFilename,
} from '@/contracts';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import {
  correlationIdFromRequest,
  slog,
} from '@/lib/requestContext';
import { createImageSavers } from './imageSave';
import { generateWithOpenAI } from './providers/openai';
import { generateWithGrok } from './providers/grok';
import { generateWithGemini } from './providers/gemini';
import { generateWithFlow } from './providers/flow';
import type { ImageProviderCtx } from './imageTypes';
import { resolveImageReferenceTransportPath } from '@/lib/mediaReference';

export const runtime = 'nodejs';

function resolveReferenceFile(raw?: string): string | null {
  const value = resolveImageReferenceTransportPath(raw);
  if (!value) return null;

  const candidates = path.isAbsolute(value)
    ? [value]
    : [
        path.join(/* turbopackIgnore: true */ process.cwd(), value),
        path.join(process.cwd(), 'public', value.replace(/^[\\/]/u, '')),
        path.join(process.cwd(), 'public', 'images', path.basename(value)),
      ];
  const resolved = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  return resolved ? path.resolve(resolved) : null;
}

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const raw = await req.json();
    const body = parseOrThrow(generateImageBodySchema, raw, 'Generate-Image');
    const prompt = body.prompt || '';

    const chapterNum = body.chapterNum;
    const sceneIndex = body.sceneIndex;
    const promptIndex = body.promptIndex;
    const drivePath = body.drivePath || '';
    const ten_tac_pham = body.ten_tac_pham || '';
    const cookie = body.cookie || '';
    const characterPrompt = body.characterPrompt || '';
    // Prefer body.model; accept imageModel alias (Media Config / older clients)
    const model = String(
      body.model ||
        (body as { imageModel?: string }).imageModel ||
        '',
    ).trim();
    const imageProvider = body.imageProvider;
    if (!model) {
      throw new AppError(
        '[Image API] Missing image model. The app does not choose a model implicitly.',
        { code: 'VALIDATION', status: 400 },
      );
    }

    slog({
      level: 'info',
      msg: 'image_start',
      correlationId,
      route: '/api/generate-image',
      chapter: chapterNum,
      scene: sceneIndex,
      provider: imageProvider,
    });

    // Free: gen_image 3/day · Trial: 5/day (server vault by HWID)
    const { assertAndConsumeFreeQuota } = await import(
      '@/lib/commercial/freeQuota'
    );
    await assertAndConsumeFreeQuota(req, 'gen_image', body);

    const imageApiKey = body.imageApiKey || '';
    const imageAspectRatio = body.imageAspectRatio || '16:9';
    const imageCount = Math.max(1, Math.min(4, Number(body.imageCount) || 1));

    // Face / concept sheet binary identity lock (optional)
    const referenceImagePathRaw = String(body.referenceImagePath || '').trim();
    const requestedIngredients = Array.isArray(body.ingredientPaths)
      ? body.ingredientPaths.map(String).filter(Boolean).slice(0, 3)
      : [];
    const resolvedIngredientPaths: string[] = [];
    for (const candidate of [
      referenceImagePathRaw,
      ...requestedIngredients,
    ]) {
      const resolved = resolveReferenceFile(candidate);
      if (
        resolved &&
        !resolvedIngredientPaths.includes(resolved) &&
        resolvedIngredientPaths.length < 3
      ) {
        resolvedIngredientPaths.push(resolved);
      } else if (candidate && !resolved) {
        throw new AppError(
          `[Image API] Reference image does not exist on disk: ${candidate}`,
          { code: 'VALIDATION', status: 400 },
        );
      }
    }
    let referenceImageB64 = '';
    let referenceMime = 'image/png';
    const primaryReferencePath = resolvedIngredientPaths[0] || '';
    if (primaryReferencePath) {
      try {
        if (
          fs.existsSync(primaryReferencePath) &&
          fs.statSync(primaryReferencePath).isFile()
        ) {
          const buf = fs.readFileSync(primaryReferencePath);
          if (buf.length <= 0) {
            throw new AppError(
              `[Image API] Reference image is empty: ${primaryReferencePath}`,
              { code: 'VALIDATION', status: 400 },
            );
          }
          if (imageProvider !== 'flow' && buf.length >= 4_500_000) {
            throw new AppError(
              `[Image API] Reference image is too large for ${imageProvider} (${buf.length} bytes, limit 4499999). Compress the real reference file first.`,
              { code: 'VALIDATION', status: 400 },
            );
          }
          if (imageProvider !== 'flow') {
            referenceImageB64 = buf.toString('base64');
            const ext = path.extname(primaryReferencePath).toLowerCase();
            referenceMime =
              ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'image/png';
            console.log(
              `[generate-image] Face-ref loaded ${path.basename(primaryReferencePath)} (${Math.round(buf.length / 1024)}KB) refs=${resolvedIngredientPaths.length}`,
            );
          } else {
            console.log(
              `[generate-image] Flow ref ready ${path.basename(primaryReferencePath)} (${Math.round(buf.length / 1024)}KB) refs=${resolvedIngredientPaths.length}`,
            );
          }
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          `[Image API] Failed to read the requested reference image: ${primaryReferencePath}`,
          { code: 'VALIDATION', status: 400, cause: e },
        );
      }
    }

    // Character sheets: client may pass assetFilename (char_sheet_Name.png) so NV
    // do not overwrite shared chapter_0_scene_999_prompt_999.png
    const filename =
      sanitizeAssetFilename(
        (body as { assetFilename?: string }).assetFilename,
      ) || localImageFilename(chapterNum, sceneIndex, promptIndex);
    const publicImageDir = path.join(process.cwd(), 'public', 'images');
    console.log(
      `[generate-image] Start real generation for c${chapterNum}-${promptIndex + 1} | Provider: ${imageProvider} | Model: ${model}`,
    );
    if (!fs.existsSync(publicImageDir)) {
      fs.mkdirSync(publicImageDir, { recursive: true });
    }
    const localSavePath = path.join(publicImageDir, filename);

    const reqApiKey = body.apiKey || '';
    const reqApiKeys = body.apiKeys || [];
    let keysToTry: string[] = [];
    if (reqApiKey) keysToTry.push(reqApiKey);
    if (Array.isArray(reqApiKeys)) {
      reqApiKeys.forEach((k: string) => {
        if (k && !keysToTry.includes(k)) keysToTry.push(k);
      });
    }

    try {
      const localApiKeyPath = path.join(process.cwd(), 'apikey.txt');
      if (fs.existsSync(localApiKeyPath)) {
        const fileContent = fs.readFileSync(localApiKeyPath, 'utf8');
        for (const line of fileContent.split('\n')) {
          const key = line.trim();
          if (key && key.startsWith('AIzaSy') && !keysToTry.includes(key)) {
            keysToTry.push(key);
          }
        }
      }
    } catch (err) {
      console.log('[generate-image] Cannot read apikey.txt:', err);
    }

    // Soft RR + RPM/RPD balance (same pool as /api/generate — B10 same provider only)
    try {
      const { orderKeysRoundRobin } = await import('@/lib/apiKeyRotate');
      keysToTry = orderKeysRoundRobin(keysToTry);
    } catch {
      /* keep sequential if rotate module unavailable */
    }

    const { saveImage, saveImageBuffers } = createImageSavers({
      chapterNum,
      sceneIndex,
      promptIndex,
      drivePath,
      ten_tac_pham,
      filename,
      localSavePath,
      publicImageDir,
      imageCount,
    });

    const providerKeysToTry: string[] = [];
    if (imageApiKey) providerKeysToTry.push(imageApiKey);
    if (Array.isArray(body.apiKeys)) {
      body.apiKeys.forEach((k: string) => {
        if (k && !providerKeysToTry.includes(k)) providerKeysToTry.push(k);
      });
    }

    const faceLockNote = referenceImageB64
      ? ' FACE REFERENCE IMAGE PROVIDED — match face, hairline, scars, age exactly; do not redesign identity.'
      : '';
    const providerPrompt = characterPrompt
      ? `${prompt}. Subject reference details: ${characterPrompt}.${faceLockNote} Keep every named character visually separated by role, position, wardrobe, and action.`
      : `${prompt}${faceLockNote}`;

    const ctx: ImageProviderCtx = {
      body,
      providerPrompt,
      providerKeysToTry,
      keysToTry,
      imageAspectRatio,
      imageCount,
      referenceImageB64,
      referenceMime,
      ingredientPaths: resolvedIngredientPaths,
      saveImage,
      saveImageBuffers,
      model,
      cookie,
      prompt,
      characterPrompt,
      chapterNum,
      sceneIndex,
      promptIndex,
      drivePath,
      ten_tac_pham,
      filename,
      localSavePath,
      publicImageDir,
    };

    const attachCid = async (res: Response): Promise<Response> => {
      const headers = new Headers(res.headers);
      headers.set('x-correlation-id', correlationId);
      slog({
        level: res.ok ? 'info' : 'warn',
        msg: res.ok ? 'image_ok' : 'image_provider_error',
        correlationId,
        route: '/api/generate-image',
        chapter: chapterNum,
        scene: sceneIndex,
        provider: imageProvider,
        durationMs: Date.now() - started,
      });
      return new NextResponse(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    };

    if (imageProvider === 'flow') return attachCid(await generateWithFlow(ctx));
    if (imageProvider === 'openai') return attachCid(await generateWithOpenAI(ctx));
    if (imageProvider === 'grok') return attachCid(await generateWithGrok(ctx));
    if (imageProvider === 'gemini' || imageProvider === 'whisk' || imageProvider === 'banana') {
      return attachCid(await generateWithGemini(ctx));
    }

    return NextResponse.json(
      { error: 'Loại image provider không hợp lệ.', correlationId },
      { status: 400, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (err: unknown) {
    slog({
      level: 'error',
      msg: 'image_fail',
      correlationId,
      route: '/api/generate-image',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof AppError ? err.code : 'UNKNOWN',
    });
    return NextResponse.json(toErrorJson(err, correlationId), {
      status: httpStatusFromError(err),
      headers: { 'x-correlation-id': correlationId },
    });
  }
}
