import { NextResponse } from 'next/server';
import {
  GENERATE_REQUEST_OWNERS,
  generateBodySchema,
  parseOrThrow,
} from '@/contracts';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';
import { handleVisualDna } from './handlers/visualDna';
import { handleIdeas } from './handlers/ideas';
import { handleImagePrompt } from './handlers/imagePrompt';
import { handleOutline } from './handlers/outline';
import { handleChapter } from './handlers/chapter';
import { handleScene } from './handlers/scene';
import { handleCharacter } from './handlers/character';
import { handleFoundation } from './handlers/foundation';
import type { GenerateHandlerContext } from './handlers/types';
import { runWithModelClientConfig } from './modelClients';

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
      provider,
      payload,
    } = body;

    slog({
      level: 'info',
      msg: 'generate_start',
      correlationId,
      route: '/api/generate',
      provider: provider || 'legacy-auto',
      model: model || 'default',
    });

    let keysToUse: string[] = [];
    if (Array.isArray(clientApiKeys) && clientApiKeys.length > 0) {
      keysToUse = clientApiKeys.filter(Boolean);
    } else if (clientApiKey) {
      keysToUse = [clientApiKey];
    } else {
      const providerEnvKey =
        provider === 'openai'
          ? process.env.OPENAI_API_KEY
          : provider === 'grok'
            ? process.env.XAI_API_KEY
            : provider === 'claude'
              ? process.env.ANTHROPIC_API_KEY
              : provider === 'custom'
                ? undefined
                : process.env.GEMINI_API_KEY;
      if (providerEnvKey?.trim()) keysToUse = [providerEnvKey.trim()];
    }

    if (keysToUse.length === 0) {
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

    const payloadObj =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    const ctx: GenerateHandlerContext = {
      payload: payloadObj,
      keysToUse,
      model,
      provider,
      customApiBaseUrl: body.customApiBaseUrl,
      customApiModel: body.customApiModel,
      customApiProtocol: body.customApiProtocol,
      req,
      rawBody: body,
    };

    const res = await runWithModelClientConfig(
      {
        model,
        provider,
        customApiBaseUrl: body.customApiBaseUrl,
        customApiModel: body.customApiModel,
        customApiProtocol: body.customApiProtocol,
      },
      () => handler(ctx, requestType),
    );
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
      provider: provider || 'legacy-auto',
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
