import type { TTSProvider } from '../ttsTypes';
import { generateGeminiTTS } from '../engines/gemini';
import {
  assertPoolHasCapacity,
  filterAvailableKeys,
  markKeyAttempt,
  markKeyLimited,
  markKeySuccess,
  orderKeysRoundRobin,
} from '@/lib/apiKeyRotate';

function collectGeminiKeys(optsKeys: string[]): string[] {
  const fromOpts = (optsKeys || []).map(String).filter((k) => k.trim());
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
  ].filter((k): k is string => !!k && k.trim().length > 0);
  // unique preserve order
  const seen = new Set<string>();
  const all: string[] = [];
  for (const k of [...fromOpts, ...fromEnv]) {
    const t = k.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    all.push(t);
  }
  return all;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Owner: TTS platform `gemini_tts` — hard-fail khi hết key / fail (không fallback Edge). */
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
    if (allKeys.length === 0) {
      throw new Error(
        'Gemini TTS: chưa có API Key — thêm key (không fallback Edge).',
      );
    }

    // Hard gate: wait if entire key pool over RPM/RPD (no force-call, no Edge)
    assertPoolHasCapacity(allKeys);
    // Prefer live keys under budget; fall back to full RR list only if empty
    let keys = filterAvailableKeys(allKeys);
    if (keys.length === 0) keys = orderKeysRoundRobin(allKeys);

    let lastErr = '';
    for (const key of keys) {
      if (!markKeyAttempt(key)) continue;
      try {
        const buffer = await generateGeminiTTS(text, key, voice);
        markKeySuccess(key);
        // Preview: pace; batch (isChapter): minimal gap — CapAssist-style fan-out
        const isBatch = Boolean((opts as { isChapter?: boolean }).isChapter);
        await sleep(isBatch ? 15 : 80);
        return {
          buffer,
          method: `Gemini TTS (${voice})`,
          nativeSpeedApplied: false,
          nativePitchApplied: false,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        console.warn(`[TTS Gemini] key fail (${voice}): ${lastErr.slice(0, 120)}`);
        const status = /API key not valid|invalid.*key/i.test(lastErr)
          ? 401
          : /quota|rate|429/i.test(lastErr)
            ? 429
            : undefined;
        markKeyLimited(key, lastErr, status);
        // Voice-specific invalid? surface without trying more only if voice not found
        if (
          /voice|prebuilt|VoiceConfig|not found/i.test(lastErr) &&
          !/quota|429|leaked|key|API key/i.test(lastErr)
        ) {
          throw new Error(
            `Gemini TTS voice "${voice}" lỗi: ${lastErr.slice(0, 200)} (không fallback).`,
          );
        }
      }
    }

    // Re-check pool — may need wait message
    try {
      assertPoolHasCapacity(allKeys);
    } catch (waitErr) {
      throw waitErr;
    }

    throw new Error(
      `Gemini TTS voice="${voice}": tất cả API key fail — ${lastErr.slice(0, 180) || 'unknown'} (không fallback Edge).`,
    );
  },
};
