import type { NextResponse } from 'next/server';
import type { AiMasterProvider } from '@/contracts';

/**
 * Shared context for every /api/generate handler — no UI, no Zustand.
 * payload stays loosely typed: each requestType owns its shape (validated in-handler).
 */
export type GenerateHandlerContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  keysToUse: string[];
  model?: string;
  provider?: AiMasterProvider;
  customApiBaseUrl?: string;
  customApiModel?: string;
  customApiProtocol?: 'openai' | 'gemini';
  /** Original request — entitlement header for cloud IP (Seedance Phase C) */
  req?: Request;
  /** Raw parsed body (includes fields outside payload if any) */
  rawBody?: unknown;
};

export type GenerateHandler = (
  ctx: GenerateHandlerContext,
  requestType: string,
) => Promise<NextResponse | null>;
