/**
 * Durable TTS preview cache.
 *
 * Zero-Shot voices already have sample WAVs / ref_pcm vectors ("voice identity").
 * Re-running full ONNX on every "Nghe thử" is wasteful when the preview sentence
 * and prosody match a file already on disk. Persist rendered audio keyed by
 * voice + text + prosody + seeds; invalidate when sample file changes.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { inspectTtsAudioBuffer, inspectTtsAudioFile } from './audioQuality';
import {
  getRuntimeDataRoot,
  getRuntimePublicRoot,
} from '@/lib/runtimePaths';

/** Bump when synthesis conditioning or the signal-quality contract changes. */
const PREVIEW_CACHE_VERSION = 'v3-peak-headroom-nfe20';

export type PreviewCacheKeyInput = {
  platform: string;
  voice: string;
  speed: number;
  pitch: number;
  text: string;
  speakerSeed?: number;
  styleSeed?: number;
  nfeStep?: number;
  variantKey?: string;
  /** Absolute path to sample WAV (vina) — mtime invalidates cache */
  samplePath?: string;
};

export type PreviewCacheHit = {
  filePath: string;
  publicUrl: string;
  filename: string;
  ageMs: number;
  method: string;
  /** Real duration from quality probe (not hardcoded 5s) */
  durationSec?: number;
};

function previewRoot(cwd = process.cwd()): string {
  // Prefer userData in packaged builds; resources may be read-only.
  return path.join(getRuntimeDataRoot(cwd), 'data', 'tts-preview-cache');
}

function publicPreviewDir(cwd = process.cwd()): string {
  return path.join(getRuntimePublicRoot(cwd), 'audio', 'previews');
}

/** Normalize prosody so 1 vs 1.0 / 0.9700001 don't thrash the cache key. */
export function normalizePreviewProsody(speed?: number, pitch?: number): {
  speed: number;
  pitch: number;
} {
  const s = Number(speed);
  const p = Number(pitch);
  return {
    speed: Number.isFinite(s) && s > 0 ? Math.round(s * 100) / 100 : 1,
    pitch: Number.isFinite(p) ? Math.round(p * 10) / 10 : 0,
  };
}

function sampleFingerprint(samplePath?: string): string {
  if (!samplePath || !fs.existsSync(samplePath)) return 'nosample';
  try {
    const st = fs.statSync(samplePath);
    // size + day-level mtime — avoid MISS on trivial touch; re-upload changes size
    const day = Math.floor(st.mtimeMs / 86_400_000);
    return `${st.size}-d${day}`;
  } catch {
    return 'nosample';
  }
}

export function normalizePreviewCacheInput(
  input: PreviewCacheKeyInput,
): PreviewCacheKeyInput {
  const { speed, pitch } = normalizePreviewProsody(input.speed, input.pitch);
  const platform = String(input.platform || '').toLowerCase();
  const isVina = platform === 'vina_voice';
  return {
    ...input,
    platform,
    voice: String(input.voice || 'default').trim(),
    speed,
    pitch,
    text: String(input.text || '').normalize('NFC').trim().slice(0, 500),
    // Stable defaults so undefined vs 2336 don't force re-synth
    speakerSeed: isVina
      ? Number.isFinite(Number(input.speakerSeed))
        ? Number(input.speakerSeed)
        : 2336
      : input.speakerSeed,
    styleSeed: isVina
      ? Number.isFinite(Number(input.styleSeed))
        ? Number(input.styleSeed)
        : 4125
      : input.styleSeed,
  };
}

export function buildPreviewCacheId(input: PreviewCacheKeyInput): string {
  const n = normalizePreviewCacheInput(input);
  const payload = [
    ...(n.platform === 'vina_voice' ? [PREVIEW_CACHE_VERSION] : []),
    n.platform,
    n.voice,
    String(n.speed),
    String(n.pitch),
    n.text,
    String(n.speakerSeed ?? ''),
    String(n.styleSeed ?? ''),
    String(n.nfeStep ?? ''),
    String(n.variantKey ?? ''),
    sampleFingerprint(n.samplePath),
  ].join('|');
  return crypto.createHash('sha1').update(payload, 'utf8').digest('hex').slice(0, 20);
}

function safeFileToken(s: string, max = 48): string {
  return String(s || 'x')
    .normalize('NFC')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, max);
}

/** Legacy public filenames from older builds (before durable hash). */
export function legacyPreviewFilename(
  platform: string,
  voice: string,
  speed: number,
  pitch: number,
  ext: 'wav' | 'mp3',
): string {
  const { speed: s, pitch: p } = normalizePreviewProsody(speed, pitch);
  const safeP = safeFileToken(platform, 24);
  const safeV = safeFileToken(voice, 40);
  return `preview_${safeP}_${safeV}_s${s}_p${p}.${ext}`;
}

export function previewCachePaths(
  input: PreviewCacheKeyInput,
  ext: 'wav' | 'mp3',
  cwd = process.cwd(),
): { id: string; filename: string; durablePath: string; publicPath: string; publicUrl: string } {
  const n = normalizePreviewCacheInput(input);
  const id = buildPreviewCacheId(n);
  const safePlat = safeFileToken(n.platform || 'tts', 24);
  const filename = `pv_${safePlat}_${id}.${ext}`;
  const durableDir = previewRoot(cwd);
  const pubDir = publicPreviewDir(cwd);
  return {
    id,
    filename,
    durablePath: path.join(durableDir, filename),
    publicPath: path.join(pubDir, filename),
    publicUrl: `/audio/previews/${filename}`,
  };
}

function hitFromFile(
  filePath: string,
  publicUrl: string,
  filename: string,
  method: string,
  maxAgeMs?: number,
  publicPathToEnsure?: string,
): PreviewCacheHit | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const st = fs.statSync(filePath);
    if (st.size < 500) return null;
    const ageMs = Date.now() - st.mtimeMs;
    if (typeof maxAgeMs === 'number' && ageMs > maxAgeMs) return null;
    const quality = inspectTtsAudioFile(filePath);
    if (!quality.ok) {
      console.warn(
        `[TTS Preview] reject corrupt cache ${filename}: ${quality.reasons.join('; ')}`,
      );
      // Purge bad cache so next Nghe thử re-synths instead of looping MISS→HIT→reject
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      return null;
    }
    const durationSec =
      Number.isFinite(quality.durationSec) && quality.durationSec > 0
        ? quality.durationSec
        : undefined;

    if (publicPathToEnsure && publicPathToEnsure !== filePath) {
      const pubDir = path.dirname(publicPathToEnsure);
      if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
      if (
        !fs.existsSync(publicPathToEnsure) ||
        fs.statSync(publicPathToEnsure).size < 500
      ) {
        fs.copyFileSync(filePath, publicPathToEnsure);
      }
      return {
        filePath: publicPathToEnsure,
        publicUrl,
        filename,
        ageMs,
        method,
        durationSec,
      };
    }
    return { filePath, publicUrl, filename, ageMs, method, durationSec };
  } catch {
    return null;
  }
}

/**
 * Look up durable + public cache. Copies durable → public if needed so the
 * browser can fetch /audio/previews/...
 */
export function tryReadPreviewCache(
  input: PreviewCacheKeyInput,
  ext: 'wav' | 'mp3',
  opts?: { maxAgeMs?: number; cwd?: string },
): PreviewCacheHit | null {
  const cwd = opts?.cwd || process.cwd();
  const maxAgeMs = opts?.maxAgeMs;
  const n = normalizePreviewCacheInput(input);
  const paths = previewCachePaths(n, ext, cwd);

  for (const filePath of [paths.publicPath, paths.durablePath]) {
    const hit = hitFromFile(
      filePath,
      paths.publicUrl,
      paths.filename,
      `Cached Preview (${n.voice}) · id=${paths.id}`,
      maxAgeMs,
      paths.publicPath,
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Prefer durable hash cache; also accept either wav/mp3 and legacy filenames
 * so "Nghe thử" never re-synths when an MP3/WAV already exists for this voice.
 */
export function tryReadPreviewCacheAny(
  input: PreviewCacheKeyInput,
  preferredExt: 'wav' | 'mp3',
  opts?: { maxAgeMs?: number; cwd?: string; allowLegacy?: boolean },
): PreviewCacheHit | null {
  const cwd = opts?.cwd || process.cwd();
  const maxAgeMs = opts?.maxAgeMs;
  const n = normalizePreviewCacheInput(input);
  const order: Array<'wav' | 'mp3'> =
    preferredExt === 'wav' ? ['wav', 'mp3'] : ['mp3', 'wav'];

  for (const ext of order) {
    const hit = tryReadPreviewCache(n, ext, { maxAgeMs, cwd });
    if (hit) return hit;
  }

  if (opts?.allowLegacy !== true) return null;

  // Legacy public/audio/previews/preview_{platform}_{voice}_s{speed}_p{pitch}.*
  const pubDir = publicPreviewDir(cwd);
  for (const ext of order) {
    const filename = legacyPreviewFilename(n.platform, n.voice, n.speed, n.pitch, ext);
    const filePath = path.join(pubDir, filename);
    const hit = hitFromFile(
      filePath,
      `/audio/previews/${filename}`,
      filename,
      `Legacy Preview (${n.voice}) · ${filename}`,
      maxAgeMs,
    );
    if (hit) return hit;
  }

  return null;
}

/** Write both durable data/ and public/audio/previews/ */
export function writePreviewCache(
  input: PreviewCacheKeyInput,
  ext: 'wav' | 'mp3',
  buffer: Buffer,
  cwd = process.cwd(),
): { filename: string; publicUrl: string; durablePath: string; publicPath: string } {
  if (!buffer || buffer.length < 500) {
    throw new Error(
      `writePreviewCache: buffer quá nhỏ (${buffer?.length || 0}B) — không ghi cache nghe thử.`,
    );
  }
  // Reject writing known-bad signals so "Nghe thử" never seals noise forever
  const quality = inspectTtsAudioBuffer(buffer, cwd);
  if (!quality.ok) {
    throw new Error(
      `writePreviewCache: audio không đạt chuẩn speech: ${quality.reasons.join('; ')}`,
    );
  }
  const n = normalizePreviewCacheInput(input);
  const paths = previewCachePaths(n, ext, cwd);
  const durableDir = path.dirname(paths.durablePath);
  const pubDir = path.dirname(paths.publicPath);
  if (!fs.existsSync(durableDir)) fs.mkdirSync(durableDir, { recursive: true });
  if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
  fs.writeFileSync(paths.durablePath, buffer);
  fs.writeFileSync(paths.publicPath, buffer);
  return {
    filename: paths.filename,
    publicUrl: paths.publicUrl,
    durablePath: paths.durablePath,
    publicPath: paths.publicPath,
  };
}
