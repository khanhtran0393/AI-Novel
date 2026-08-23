import { NextRequest, NextResponse } from 'next/server';
import {
  checkAllKeysHealth,
  checkGeminiModelMatrix,
} from '@/lib/keyHealthTracker';
import { AI_MASTER_PROVIDERS, type AiMasterProvider } from '@/contracts';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      keys?: string[];
      provider?: string;
      model?: string;
      customApiBaseUrl?: string;
      includeModelMatrix?: boolean;
    };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (
      !body.provider ||
      !AI_MASTER_PROVIDERS.includes(body.provider as AiMasterProvider)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Key health cần provider rõ ràng; không đoán provider từ key.',
        },
        { status: 400 },
      );
    }

    const statuses = await checkAllKeysHealth(keys, {
      provider: body.provider as AiMasterProvider,
      model: body.model,
      customApiBaseUrl: body.customApiBaseUrl,
    });
    const modelMatrix =
      body.provider === 'gemini' && body.includeModelMatrix
        ? await checkGeminiModelMatrix(keys)
        : undefined;

    return NextResponse.json({
      success: true,
      keys: statuses,
      ...(modelMatrix ? { modelMatrix } : {}),
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Key health check failed.',
      },
      { status: 500 },
    );
  }
}
