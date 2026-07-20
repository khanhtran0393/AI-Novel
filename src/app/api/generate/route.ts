import { NextResponse } from 'next/server';
import {
  GENERATE_REQUEST_OWNERS,
  generateBodySchema,
  parseOrThrow,
} from '@/contracts';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';
import {
  FREE_LIMITS,
  generateRequestToFreeBucket,
} from '@/lib/commercial/freeLimitsPolicy';
import {
  applyFreeWordGoalToPayload,
  assertAndConsumeFreeQuota,
  assertFreeOutlineConstraints,
  assertFreeWriteConstraints,
} from '@/lib/commercial/freeQuota';
import { handleVisualDna } from './handlers/visualDna';
import { handleIdeas } from './handlers/ideas';
import { handleImagePrompt } from './handlers/imagePrompt';
import { handleOutline } from './handlers/outline';
import { handleChapter } from './handlers/chapter';
import { handleScene } from './handlers/scene';
import { handleCharacter } from './handlers/character';
import { handleFoundation } from './handlers/foundation';
import type { GenerateHandlerContext } from './handlers/types';

export const runtime = 'nodejs';

const HANDLERS = {
  visualDna: handleVisualDna,
  ideas: handleIdeas,
  imagePrompt: handleImagePrompt,
  outline: handleOutline,
  chapter: handleChapter,
  scene: handleScene,
  character: handleCharacter,
  foundation: handleFoundation,
} as const;

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  const started = Date.now();
  try {
    const raw = await req.json();
    const body = parseOrThrow(generateBodySchema, raw, 'Generate');

    const {
      requestType,
      apiKey: clientApiKey,
      apiKeys: clientApiKeys,
      model,
      payload,
    } = body;

    slog({
      level: 'info',
      msg: 'generate_start',
      correlationId,
      route: '/api/generate',
      provider: requestType,
      model: model || 'default',
    });

    let keysToUse: string[] = [];
    if (Array.isArray(clientApiKeys) && clientApiKeys.length > 0) {
      keysToUse = clientApiKeys.filter(Boolean);
    } else if (clientApiKey) {
      keysToUse = [clientApiKey];
    } else if (process.env.GEMINI_API_KEY) {
      keysToUse = [process.env.GEMINI_API_KEY];
    }

    if (keysToUse.length === 0 && model !== 'aistudio') {
      throw new AppError(
        'Thiếu API Key. Vui lòng nhập ít nhất một API Key ở góc trên bên phải hoặc cấu hình biến môi trường server.',
        { code: 'AUTH', status: 400 },
      );
    }

    const owner = GENERATE_REQUEST_OWNERS[requestType];
    const handler = HANDLERS[owner];
    if (!handler) {
      throw new AppError('Loại yêu cầu không hợp lệ.', {
        code: 'VALIDATION',
        status: 400,
      });
    }

    // Free tier: daily 3/bucket + write ≤600 từ + ≤2 chương (server authority)
    const freeBucket = generateRequestToFreeBucket(requestType);
    const payloadObj =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    if (freeBucket === 'write_chapter') {
      const constrained = await assertFreeWriteConstraints(req, payloadObj, body);
      if (constrained) applyFreeWordGoalToPayload(payloadObj, constrained.wordGoal);
    } else if (freeBucket === 'outline_ideas') {
      await assertFreeOutlineConstraints(req, payloadObj, body);
      // Clamp outline chapter count on payload when present
      if (payloadObj.so_chuong != null) {
        const n = Number(payloadObj.so_chuong);
        if (Number.isFinite(n) && n > FREE_LIMITS.maxChapters) {
          payloadObj.so_chuong = FREE_LIMITS.maxChapters;
        }
      }
      if (payloadObj.chapterCount != null) {
        const n = Number(payloadObj.chapterCount);
        if (Number.isFinite(n) && n > FREE_LIMITS.maxChapters) {
          payloadObj.chapterCount = FREE_LIMITS.maxChapters;
        }
      }
    }
    if (freeBucket) {
      await assertAndConsumeFreeQuota(req, freeBucket, body);
    }

    const ctx: GenerateHandlerContext = {
      payload: payloadObj,
      keysToUse,
      model,
      req,
      rawBody: body,
    };

    const res = await handler(ctx, requestType);
    if (!res) {
      throw new AppError('Loại yêu cầu không hợp lệ.', {
        code: 'VALIDATION',
        status: 400,
      });
    }
    slog({
      level: 'info',
      msg: 'generate_ok',
      correlationId,
      route: '/api/generate',
      provider: requestType,
      durationMs: Date.now() - started,
    });
    const headers = new Headers(res.headers);
    headers.set('x-correlation-id', correlationId);
    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch (err: unknown) {
    slog({
      level: 'error',
      msg: 'generate_fail',
      correlationId,
      route: '/api/generate',
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
