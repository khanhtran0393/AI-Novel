import { NextResponse } from 'next/server';
import {
  assertPoolHasCapacity,
  filterAvailableKeys,
  markKeyAttempt,
  markKeyLimited,
  markKeySuccess,
} from '@/lib/apiKeyRotate';
import {
  GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_REQUIRES_BILLING,
  GEMINI_INTERACTIONS_ENDPOINT,
} from '@/lib/geminiModels';
import type { ImageProviderCtx } from '../imageTypes';
import { runWhiskAutomation } from './whisk';

type InteractionImageResponse = {
  output_image?: {
    data?: string;
    mime_type?: string;
  };
};

function providerMessage(raw: string, status: number): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message || parsed.message || raw || `HTTP ${status}`;
  } catch {
    return raw || `HTTP ${status}`;
  }
}

/**
 * Owner: Google Gemini native image generation; Whisk stays browser/cookie-only.
 * IRON B10: exact selected provider/model, same-provider key rotation only.
 */
export async function generateWithGemini(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  const {
    providerPrompt,
    providerKeysToTry,
    keysToTry,
    imageAspectRatio,
    imageCount,
    referenceImageB64,
    referenceMime,
    saveImageBuffers,
    model,
    cookie,
    prompt,
    characterPrompt,
  } = ctx;

  if (model === 'whisk') {
    if (!cookie?.trim()) {
      return NextResponse.json(
        {
          error:
            '[Google Whisk] Thiếu Cookie Google Studio. Không fallback sang Gemini API.',
        },
        { status: 400 },
      );
    }
    return runWhiskAutomation(ctx);
  }

  const uniqueKeys = Array.from(
    new Set(
      [...providerKeysToTry, ...keysToTry]
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  );
  if (!uniqueKeys.length) {
    return NextResponse.json(
      {
        error:
          '[Gemini Image] Thiếu Gemini API key. Không fallback sang Whisk hay provider khác.',
      },
      { status: 400 },
    );
  }

  try {
    assertPoolHasCapacity(uniqueKeys);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        code: 'QUOTA',
      },
      { status: 429 },
    );
  }

  const endpoint = GEMINI_INTERACTIONS_ENDPOINT;
  const selectedModel =
    String(model || '').trim().endsWith('-image')
      ? String(model).trim()
      : GEMINI_IMAGE_MODEL;
  const geminiPrompt = referenceImageB64
    ? `${providerPrompt} Preserve the exact identity from the attached reference image.`
    : characterPrompt
      ? `${prompt}, subject: ${characterPrompt}`
      : prompt;
  const input: Array<Record<string, string>> = [
    { type: 'text', text: geminiPrompt },
  ];
  if (referenceImageB64) {
    input.push({
      type: 'image',
      mime_type: referenceMime || 'image/png',
      data: referenceImageB64,
    });
  }

  let lastError = 'Provider không trả về ảnh.';
  const imageBuffers: Buffer[] = [];
  for (let outputIndex = 0; outputIndex < imageCount; outputIndex += 1) {
    let generated = false;
    for (const currentKey of filterAvailableKeys(uniqueKeys)) {
      if (!markKeyAttempt(currentKey)) continue;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': currentKey,
          },
          body: JSON.stringify({
            model: selectedModel,
            input,
            response_format: {
              type: 'image',
              mime_type: 'image/jpeg',
              aspect_ratio: imageAspectRatio,
              image_size: '1K',
            },
          }),
          signal: controller.signal,
        });
        const raw = await response.text();
        if (!response.ok) {
          lastError = providerMessage(raw, response.status).replaceAll(
            currentKey,
            '[REDACTED]',
          );
          const kind = markKeyLimited(currentKey, lastError, response.status);
          if (
            kind === 'billing' ||
            kind === 'permission' ||
            kind === 'api_disabled' ||
            kind === 'model' ||
            kind === 'payload'
          ) {
            const billingHint = GEMINI_IMAGE_REQUIRES_BILLING
              ? ` ${selectedModel} không có Free Tier image-output ổn định; hãy bật Billing/quota cho project Google Cloud hoặc dùng Flow/Whisk session.`
              : '';
            return NextResponse.json(
              {
                error: `[Gemini Image/${selectedModel}] ${lastError}.${billingHint}`,
                code: kind === 'billing' ? 'BILLING_REQUIRED' : 'PROVIDER',
              },
              { status: kind === 'payload' ? 400 : response.status },
            );
          }
          continue;
        }

        const data = JSON.parse(raw) as InteractionImageResponse;
        const base64 = data.output_image?.data;
        if (!base64) {
          lastError =
            'Interactions API trả về thành công nhưng thiếu output_image.data.';
          return NextResponse.json(
            {
              error: `[Gemini Image/${selectedModel}] ${lastError}`,
            },
            { status: 502 },
          );
        }
        markKeySuccess(currentKey);
        imageBuffers.push(Buffer.from(base64, 'base64'));
        generated = true;
        break;
      } catch (error) {
        lastError = (
          error instanceof Error ? error.message : String(error)
        ).replaceAll(currentKey, '[REDACTED]');
        markKeyLimited(currentKey, lastError);
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (!generated) break;
  }

  if (imageBuffers.length === imageCount) {
    return saveImageBuffers(
      imageBuffers,
      `Google Gemini Image (${selectedModel})`,
    );
  }

  return NextResponse.json(
    {
      error: `[Gemini Image/${selectedModel}] ${lastError}`,
    },
    { status: 502 },
  );
}
