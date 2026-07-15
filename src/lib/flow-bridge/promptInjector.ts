/**
 * FlowAgent Data Pre-processing — Prompt Injector (Face-lock).
 * Exact system prompt from FlowAgent technical deep-dive.
 */
import fs from 'fs';
import path from 'path';

/** Static English identity lock — appended when reference media is used. */
export const FACE_LOCK_SYSTEM_PROMPT =
  'Using the uploaded image as the ONLY identity reference, preserve the exact facial identity, structure, skin tone, and body proportions with maximum fidelity. Do not replace, beautify, stylize, age, gender-swap, or alter the likeness. Keep the subject instantly recognizable. Only change the requested scene, lighting, background, mood, or outfit while keeping the identity locked.';

/**
 * Inject face-lock into user prompt when reference image / mediaId is present.
 * User prompt (VI/EN) is preserved; system English is concatenated.
 */
export function injectFaceLockPrompt(
  userPrompt: string,
  opts?: { hasReference?: boolean; mediaId?: string },
): string {
  const base = String(userPrompt || '').trim();
  if (!opts?.hasReference && !opts?.mediaId) return base;

  const parts = [base];
  if (opts.mediaId) {
    parts.push(`[REF_MEDIA_ID:${opts.mediaId}]`);
  }
  parts.push(FACE_LOCK_SYSTEM_PROMPT);
  return parts.filter(Boolean).join('\n\n');
}

/** Encode local file to base64 (binary → JSON-safe). */
export function fileToBase64(absPath: string): {
  base64: string;
  mimeType: string;
  byteLength: number;
} {
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeType =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.mp4'
          ? 'video/mp4'
          : 'image/png';
  return {
    base64: buf.toString('base64'),
    mimeType,
    byteLength: buf.length,
  };
}
