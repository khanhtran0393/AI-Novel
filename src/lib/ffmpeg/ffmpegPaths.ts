/**
 * Shared FFmpeg binary discovery for encode / NVENC.
 * Primary: bin/ffmpeg.exe (app). Compat: python_core/ffmpeg (older NVENC API).
 */
import fs from 'fs';
import path from 'path';
import { resolveFfmpegPath } from '@/lib/capassistant/core';

function electronResourcesPath(): string {
  const maybe = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  return typeof maybe === 'string' ? maybe : '';
}

function dirnameSafe(value?: string): string {
  try {
    return value ? path.dirname(value) : '';
  } catch {
    return '';
  }
}

function candidateRoots(cwd = process.cwd()): string[] {
  const primary = resolveFfmpegPath();
  const resources = electronResourcesPath();
  const exeDir = dirnameSafe(process.execPath);
  return Array.from(
    new Set(
      [
        process.env.AINOVEL_FFMPEG_ROOT,
        process.env.AI_NOVEL_ROOT,
        process.env.INIT_CWD,
        cwd,
        process.cwd(),
        resources,
        resources ? path.join(resources, 'app.asar.unpacked') : '',
        exeDir,
        exeDir ? path.join(exeDir, 'resources') : '',
        primary !== 'ffmpeg' ? path.dirname(primary) : '',
        primary !== 'ffmpeg' ? path.dirname(path.dirname(primary)) : '',
      ].filter(Boolean) as string[],
    ),
  );
}

function listToolCandidates(
  tool: 'ffmpeg' | 'ffprobe',
  preferred?: string,
  cwd = process.cwd(),
): string[] {
  const isWin = process.platform === 'win32';
  const exe = isWin ? `${tool}.exe` : tool;
  const primary = resolveFfmpegPath();
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (p: string) => {
    const raw = String(p || '').trim();
    if (!raw) return;
    const isPathName = raw === tool;
    const key = isPathName ? tool : path.normalize(raw).toLowerCase();
    if (seen.has(key)) return;
    if (!isPathName && !fs.existsSync(raw)) return;
    seen.add(key);
    out.push(isPathName ? tool : path.normalize(raw));
  };

  if (preferred?.trim()) push(preferred.trim());
  if (tool === 'ffmpeg') push(primary);
  if (tool === 'ffprobe') {
    push(process.env.AINOVEL_FFPROBE_PATH || process.env.FFPROBE_PATH || '');
  } else {
    push(process.env.AINOVEL_FFMPEG_PATH || process.env.FFMPEG_PATH || '');
  }

  for (const root of candidateRoots(cwd)) {
    push(path.join(root, 'bin', exe));
    push(path.join(root, 'bin', tool, exe));
    push(path.join(root, 'python_core', 'ffmpeg', exe));
    push(path.join(root, 'python_core', 'ffmpeg', 'bin', exe));
  }

  push(tool);
  return out;
}

/** Unique existing paths + optional PATH name "ffmpeg". */
export function listFfmpegCandidates(
  preferred?: string,
  cwd = process.cwd(),
): string[] {
  return listToolCandidates('ffmpeg', preferred, cwd);
}

/** Unique existing paths + optional PATH name "ffprobe". */
export function listFfprobeCandidates(
  preferred?: string,
  cwd = process.cwd(),
): string[] {
  return listToolCandidates('ffprobe', preferred, cwd);
}

export function getPrimaryFfmpegPath(cwd = process.cwd()): string {
  return listFfmpegCandidates(undefined, cwd)[0] || 'ffmpeg';
}

export function getPrimaryFfprobePath(cwd = process.cwd()): string {
  return listFfprobeCandidates(undefined, cwd)[0] || 'ffprobe';
}

export function isSameFfmpegPath(a: string, b: string): boolean {
  if (a === 'ffmpeg' || b === 'ffmpeg') return a === b;
  try {
    return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
  } catch {
    return a === b;
  }
}
