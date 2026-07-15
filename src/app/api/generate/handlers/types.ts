import type { NextResponse } from 'next/server';

/**
 * Shared context for every /api/generate handler — no UI, no Zustand.
 * payload stays loosely typed: each requestType owns its shape (validated in-handler).
 */
export type GenerateHandlerContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  keysToUse: string[];
  model?: string;
};

export type GenerateHandler = (
  ctx: GenerateHandlerContext,
  requestType: string,
) => Promise<NextResponse | null>;
