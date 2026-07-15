import type { NextResponse } from 'next/server';

export type SaveImageFn = (
  imageBuffer: Buffer,
  method: string,
  usedApiKey?: string,
) => NextResponse;

export type SaveImageBuffersFn = (
  imageBuffers: Buffer[],
  method: string,
  usedApiKey?: string,
) => NextResponse;

export type ImageSaveContext = {
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  drivePath: string;
  ten_tac_pham: string;
  filename: string;
  localSavePath: string;
  publicImageDir: string;
  imageCount: number;
};

export type ImageProviderCtx = {
  body: Record<string, unknown>;
  providerPrompt: string;
  providerKeysToTry: string[];
  keysToTry: string[];
  imageAspectRatio: string;
  imageCount: number;
  referenceImageB64: string;
  referenceMime: string;
  saveImage: SaveImageFn;
  saveImageBuffers: SaveImageBuffersFn;
  // gemini extras
  model: string;
  cookie: string;
  prompt: string;
  characterPrompt: string;
  chapterNum: number;
  sceneIndex: number;
  promptIndex: number;
  drivePath: string;
  ten_tac_pham: string;
  filename: string;
  localSavePath: string;
  publicImageDir: string;
};
