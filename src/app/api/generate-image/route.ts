import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  generateImageBodySchema,
  localImageFilename,
  parseOrThrow,
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

export const runtime = 'nodejs';

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
    const model = body.model || 'imagen3';
    const imageProvider = body.imageProvider;

    slog({
      level: 'info',
      msg: 'image_start',
      correlationId,
      route: '/api/generate-image',
      chapter: chapterNum,
      scene: sceneIndex,
      provider: imageProvider,
    });

    const imageApiKey = body.imageApiKey || '';
    const imageAspectRatio = body.imageAspectRatio || '16:9';
    const imageCount = Math.max(1, Math.min(4, Number(body.imageCount) || 1));

    // Face / concept sheet binary identity lock (optional)
    const referenceImagePathRaw = String(body.referenceImagePath || '')
      .trim()
      .split('?')[0];
    let referenceImageB64 = '';
    let referenceMime = 'image/png';
    if (referenceImagePathRaw) {
      try {
        let abs = referenceImagePathRaw;
        if (!path.isAbsolute(abs)) {
          const candidates = [
            path.join(/* turbopackIgnore: true */ process.cwd(), abs),
            path.join(process.cwd(), 'public', abs),
            path.join(process.cwd(), 'public', 'images', path.basename(abs)),
          ];
          abs = candidates.find((c) => fs.existsSync(c)) || abs;
        }
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const buf = fs.readFileSync(abs);
          if (buf.length > 0 && buf.length < 4_500_000) {
            referenceImageB64 = buf.toString('base64');
            const ext = path.extname(abs).toLowerCase();
            referenceMime =
              ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'image/png';
            console.log(
              `[generate-image] Face-ref loaded ${path.basename(abs)} (${Math.round(buf.length / 1024)}KB)`,
            );
          }
        } else {
          console.warn(
            `[generate-image] Face-ref path missing: ${referenceImagePathRaw}`,
          );
        }
      } catch (e) {
        console.warn('[generate-image] Face-ref read failed', e);
      }
    }

    const filename = localImageFilename(chapterNum, sceneIndex, promptIndex);
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
    if (imageProvider === 'gemini') return attachCid(await generateWithGemini(ctx));

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
