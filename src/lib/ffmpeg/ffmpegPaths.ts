/**
 * Shared FFmpeg binary discovery for encode / NVENC.
 * Primary: bin/ffmpeg.exe (app). Compat: python_core/ffmpeg (older NVENC API).
 */
import fs from 'fs';
import path from 'path';
import { resolveFfmpegPath } from '@/lib/capassistant/core';

/** Unique existing paths + optional PATH name "ffmpeg". */
export function listFfmpegCandidates(preferred?: string): string[] {
  const cwd = process.cwd();
  const primary = resolveFfmpegPath();
  const roots = Array.from(
    new Set(
      [cwd, path.dirname(primary), path.dirname(path.dirname(primary))].filter(
        Boolean,
      ),
    ),
  );

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (p: string) => {
    const raw = String(p || '').trim();
    if (!raw) return;
    const key = raw === 'ffmpeg' ? 'ffmpeg' : path.normalize(raw).toLowerCase();
    if (seen.has(key)) return;
    if (raw !== 'ffmpeg' && !fs.existsSync(raw)) return;
    seen.add(key);
    out.push(raw === 'ffmpeg' ? 'ffmpeg' : path.normalize(raw));
  };

  if (preferred?.trim()) push(preferred.trim());
  push(primary);

  for (const root of roots) {
    push(path.join(root, 'bin', 'ffmpeg.exe'));
    push(path.join(root, 'python_core', 'ffmpeg', 'ffmpeg.exe'));
    push(path.join(root, 'python_core', 'ffmpeg', 'bin', 'ffmpeg.exe'));
  }

  push('ffmpeg');
  return out;
}

export function getPrimaryFfmpegPath(): string {
  return resolveFfmpegPath();
}

export function isSameFfmpegPath(a: string, b: string): boolean {
  if (a === 'ffmpeg' || b === 'ffmpeg') return a === b;
  try {
    return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
  } catch {
    return a === b;
  }
}
