import type { TTSProvider } from '../ttsTypes';
import { generateGeminiTtsPcmChunk } from '../engines/gemini';
import { createWavHeader, splitTtsText } from '../audioUtils';
import { GEMINI_TTS_MODEL } from '@/lib/geminiModels';
import {
  assertPoolHasCapacity,
  filterAvailableKeys,
  markKeyAttempt,
  markKeyLimited,
  markKeySuccess,
  orderKeysRoundRobin,
} from '@/lib/apiKeyRotate';

function collectGeminiKeys(optsKeys: string[]): string[] {
  const fromOpts = (optsKeys || []).map(String).filter((key) => key.trim());
  const fromEnv = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_7,
    process.env.GEMINI_KEY_8,
    process.env.GEMINI_KEY_9,
    process.env.GEMINI_API_KEY,
  ].filter((key): key is string => Boolean(key?.trim()));
  return Array.from(
    new Set([...fromOpts, ...fromEnv].map((key) => key.trim()).filter(Boolean)),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gemini TTS, exact model and same-provider key rotation; never falls back. */
export const provider_gemini_tts: TTSProvider = {
  name: 'Gemini TTS',
  supportsNativeSpeed: false,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const voice = String(opts.voice || '').trim();
    if (!voice) {
      throw new Error('Gemini TTS: chưa chọn voice prebuilt.');
    }

    const allKeys = collectGeminiKeys(
      Array.isArray(opts.apiKeys) ? opts.apiKeys.map(String) : [],
    );
    if (!allKeys.length) {
      throw new Error(
        'Gemini TTS: chưa có API key; thêm key trong Settings (không fallback Edge).',
      );
    }

    const chunks = splitTtsText(text, 900);
    const pcmBuffers: Buffer[] = [];
    const configuredChunkGap = Number(
      process.env.GEMINI_TTS_CHUNK_GAP_MS || 1500,
    );
    const chunkGapMs = Number.isFinite(configuredChunkGap)
      ? Math.max(0, configuredChunkGap)
      : 1500;
    const configuredTransientRetries = Number(
      process.env.GEMINI_TTS_TRANSIENT_RETRIES || 2,
    );
    const transientRetries = Number.isFinite(configuredTransientRetries)
      ? Math.min(3, Math.max(0, Math.floor(configuredTransientRetries)))
      : 2;
    let lastError = '';

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      assertPoolHasCapacity(allKeys);
      let keys = filterAvailableKeys(allKeys);
      if (!keys.length) keys = orderKeysRoundRobin(allKeys);
      let chunkComplete = false;

      for (const key of keys) {
        for (
          let attempt = 0;
          attempt <= transientRetries;
          attempt += 1
        ) {
          if (!markKeyAttempt(key)) break;
          try {
            pcmBuffers.push(
              await generateGeminiTtsPcmChunk(
                chunks[chunkIndex],
                key,
                voice,
              ),
            );
            markKeySuccess(key);
            chunkComplete = true;
            break;
          } catch (error) {
            lastError = (
              error instanceof Error ? error.message : String(error || '')
            ).replaceAll(key, '[REDACTED]');
            const explicitStatus =
              error &&
              typeof error === 'object' &&
              typeof (error as { providerStatus?: unknown }).providerStatus ===
                'number'
                ? (error as { providerStatus: number }).providerStatus
                : undefined;
            const status =
              explicitStatus ??
              (/API key not valid|invalid.*key/iu.test(lastError)
                ? 401
                : /quota|rate|429/iu.test(lastError)
                  ? 429
                  : undefined);
            const kind = markKeyLimited(key, lastError, status);
            console.warn(
              `[TTS Gemini] chunk=${chunkIndex + 1}/${chunks.length} attempt=${attempt + 1}/${transientRetries + 1} model=${GEMINI_TTS_MODEL} kind=${kind}: ${lastError.slice(0, 160)}`,
            );

            if (
              kind === 'billing' ||
              kind === 'permission' ||
              kind === 'api_disabled' ||
              kind === 'model' ||
              kind === 'payload'
            ) {
              throw new Error(
                `Gemini TTS ${GEMINI_TTS_MODEL} lỗi ${kind}: ${lastError.slice(0, 240)} (không fallback).`,
              );
            }
            if (
              /voice|prebuilt|VoiceConfig|not found/iu.test(lastError) &&
              !/quota|429|leaked|key|API key/iu.test(lastError)
            ) {
              throw new Error(
                `Gemini TTS voice "${voice}" lỗi: ${lastError.slice(0, 220)} (không fallback).`,
              );
            }

            const transient =
              kind === 'network' ||
              (kind === 'other' &&
                typeof status === 'number' &&
                status >= 500);
            if (!transient || attempt >= transientRetries) break;
            await sleep(Math.min(8000, 1000 * 2 ** attempt));
          }
        }
        if (chunkComplete) break;
      }

      if (!chunkComplete) {
        assertPoolHasCapacity(allKeys);
        throw new Error(
          `Gemini TTS chunk ${chunkIndex + 1}/${chunks.length} thất bại: ${lastError.slice(0, 220) || 'unknown'} (không fallback Edge).`,
        );
      }
      if (chunkIndex + 1 < chunks.length && chunkGapMs > 0) {
        await sleep(chunkGapMs);
      }
    }

    const combinedPcm = Buffer.concat(pcmBuffers);
    return {
      buffer: Buffer.concat([
        createWavHeader(combinedPcm.length),
        combinedPcm,
      ]),
      method: `Gemini TTS (${GEMINI_TTS_MODEL}, ${voice}, ${chunks.length} request${chunks.length === 1 ? '' : 's'})`,
      nativeSpeedApplied: false,
      nativePitchApplied: false,
    };
  },
};
