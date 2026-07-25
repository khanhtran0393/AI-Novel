/**
 * FlowAgent Data Pre-processing — Prompt Injector (Face-lock).
 * Exact system prompt from FlowAgent technical deep-dive.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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

/** Compress before uploadImage — large PNG (2MB+) times out extension SW. */
const FLOW_UPLOAD_MAX_BYTES = 450_000; // ~0.45MB raw → force JPEG for most stills
const FLOW_UPLOAD_MAX_EDGE = 1024;

function resolveFfmpegExe(): string | null {
  const roots = [
    process.env.AI_NOVEL_ROOT,
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    for (const rel of ['bin/ffmpeg.exe', 'python_core/ffmpeg/ffmpeg.exe', 'bin/ffmpeg']) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Shrink large stills before Flow uploadImage (base64 over extension WS).
 * 1.6MB PNG often times out; JPEG ~60–200KB succeeds.
 */
export function prepareFlowUploadImage(absPath: string): {
  path: string;
  base64: string;
  mimeType: string;
  byteLength: number;
  compressed: boolean;
} {
  const original = String(absPath || '').trim();
  if (!original || !fs.existsSync(original)) {
    throw new Error(`Flow upload: file không tồn tại: ${original}`);
  }
  const raw = fileToBase64(original);
  if (raw.mimeType.startsWith('video/')) {
    return { path: original, ...raw, compressed: false };
  }
  if (raw.byteLength <= FLOW_UPLOAD_MAX_BYTES) {
    return { path: original, ...raw, compressed: false };
  }

  const ffmpeg = resolveFfmpegExe();
  if (!ffmpeg) {
    console.warn(
      `[FlowUpload] File ${raw.byteLength}B > ${FLOW_UPLOAD_MAX_BYTES} but no ffmpeg — upload raw (may timeout)`,
    );
    return { path: original, ...raw, compressed: false };
  }

  const scratch = path.join(
    process.env.AI_NOVEL_USER_DATA
      ? path.join(String(process.env.AI_NOVEL_USER_DATA), 'scratch', 'flow-upload')
      : path.join(process.cwd(), 'scratch', 'flow-upload'),
  );
  fs.mkdirSync(scratch, { recursive: true });
  const outJpg = path.join(
    scratch,
    `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.jpg`,
  );

  try {
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-i',
        original,
        '-vf',
        `scale='min(${FLOW_UPLOAD_MAX_EDGE},iw)':-2`,
        '-frames:v',
        '1',
        '-q:v',
        '6',
        outJpg,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 },
    );
    if (!fs.existsSync(outJpg) || fs.statSync(outJpg).size < 500) {
      throw new Error('ffmpeg produced empty output');
    }
    const compressed = fileToBase64(outJpg);
    console.log(
      `[FlowUpload] compressed ${raw.byteLength}B → ${compressed.byteLength}B (${path.basename(original)})`,
    );
    return {
      path: outJpg,
      ...compressed,
      compressed: true,
    };
  } catch (e) {
    console.warn(
      '[FlowUpload] compress failed, using original:',
      e instanceof Error ? e.message : e,
    );
    try {
      if (fs.existsSync(outJpg)) fs.unlinkSync(outJpg);
    } catch {
      /* ignore */
    }
    return { path: original, ...raw, compressed: false };
  }
}
