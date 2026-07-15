/**
 * Resolve AI Novel media URLs / store values to absolute filesystem paths
 * so FableCut / watch / ffmpeg can open real files.
 */
import fs from 'fs';
import path from 'path';
import { chapterAssetPrefix } from '@/contracts';

/** Strip cache-bust and decode URI components. */
export function stripMediaQuery(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  // /api/serve-image?file=x.png?t=123  or path?t=
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) {
    // Keep first query for serve-image (file=), drop trailing cache bust after second ?
    // Prefer parse URL-like
    try {
      if (s.startsWith('/')) {
        const u = new URL(s, 'http://local');
        const file = u.searchParams.get('file') || u.searchParams.get('path');
        if (file) return decodeURIComponent(file.split('?')[0]);
        // bare ?t= on path
        return decodeURIComponent(u.pathname);
      }
    } catch {
      /* fallthrough */
    }
    s = s.slice(0, qIdx);
  }
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Map store value → absolute path under project cwd.
 * Handles:
 *  - D:\abs\file.png
 *  - /api/serve-image?file=chapter_1_scene_0_prompt_0.png
 *  - /api/serve-local-video?path=D%3A%5C...
 *  - /audio/foo.mp3 → public/audio/foo.mp3
 *  - /images/foo.png → public/images/foo.png
 *  - public-relative paths
 */
export function resolveMediaToDisk(
  raw: string | undefined | null,
  cwd = process.cwd(),
): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;

  // Absolute Windows / POSIX
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    const abs = s.split('?')[0];
    return fs.existsSync(abs) ? abs : null;
  }
  if (s.startsWith('/') && !s.startsWith('/api') && !s.startsWith('/audio') && !s.startsWith('/images') && !s.startsWith('/public')) {
    // might be unix abs
    if (fs.existsSync(s.split('?')[0])) return s.split('?')[0];
  }

  // serve-image — store often appends `?t=cache` AFTER full query:
  // `/api/serve-image?file=foo.png?t=123` (second ? breaks URLSearchParams)
  if (s.includes('serve-image') || /[?&]file=/.test(s)) {
    const fileMatch = s.match(/[?&]file=([^&]+)/i);
    if (fileMatch) {
      let fileVal = fileMatch[1];
      // strip nested cache bust: foo.png?t=123
      fileVal = fileVal.split('?')[0];
      try {
        fileVal = decodeURIComponent(fileVal);
      } catch {
        /* keep */
      }
      const base = path.basename(fileVal);
      const disk = path.join(cwd, 'public', 'images', base);
      if (fs.existsSync(disk)) return disk;
    }
    try {
      // Normalize double-? before URL parse
      const normalized = s.replace(/\?t=\d+$/i, '').replace(/(\.png|\.jpe?g|\.webp)\?t=\d+/i, '$1');
      const u = new URL(
        normalized.startsWith('http')
          ? normalized
          : `http://local${normalized.startsWith('/') ? '' : '/'}${normalized}`,
      );
      const file = u.searchParams.get('file');
      if (file) {
        const base = path.basename(decodeURIComponent(file.split('?')[0]));
        const disk = path.join(cwd, 'public', 'images', base);
        if (fs.existsSync(disk)) return disk;
      }
      const p = u.searchParams.get('path');
      if (p) {
        const abs = path.resolve(decodeURIComponent(p.split('?')[0]));
        if (fs.existsSync(abs)) return abs;
      }
    } catch {
      /* fallthrough */
    }
  }

  // serve-local-video?path=
  if (s.includes('serve-local-video') || s.includes('path=')) {
    try {
      const u = new URL(s.startsWith('http') ? s : `http://local${s.startsWith('/') ? '' : '/'}${s}`);
      const p = u.searchParams.get('path');
      if (p) {
        const abs = path.resolve(decodeURIComponent(p.split('?')[0]));
        if (fs.existsSync(abs)) return abs;
      }
    } catch {
      /* fallthrough */
    }
  }

  // /audio/xxx or audio/xxx
  const audioMatch = s.match(/(?:^|\/)audio\/([^?]+)/i);
  if (audioMatch) {
    const disk = path.join(cwd, 'public', 'audio', path.basename(decodeURIComponent(audioMatch[1])));
    if (fs.existsSync(disk)) return disk;
    // nested public/audio/previews
    const nested = path.join(cwd, 'public', 'audio', decodeURIComponent(audioMatch[1]).replace(/^\/+/, ''));
    if (fs.existsSync(nested)) return nested;
  }

  // /images/xxx
  const imgMatch = s.match(/(?:^|\/)images\/([^?]+)/i);
  if (imgMatch) {
    const disk = path.join(cwd, 'public', 'images', path.basename(decodeURIComponent(imgMatch[1])));
    if (fs.existsSync(disk)) return disk;
  }

  // bare filename
  const base = path.basename(stripMediaQuery(s));
  if (base && /\.(png|jpe?g|webp|gif|mp3|wav|mp4|webm|mov)$/i.test(base)) {
    for (const rel of [
      path.join('public', 'images', base),
      path.join('public', 'audio', base),
      path.join('public', 'audio', 'previews', base),
      path.join('public', 'video', base),
      path.join('public', 'renders', base),
    ]) {
      const disk = path.join(cwd, rel);
      if (fs.existsSync(disk)) return disk;
    }
  }

  // relative to cwd
  const rel = stripMediaQuery(s).replace(/^\//, '');
  const candidate = path.join(cwd, rel);
  if (fs.existsSync(candidate)) return candidate;

  return null;
}

export function collectChapterImageDiskPaths(
  chapterNum: number,
  generatedImages: Record<string, string> | undefined,
  cwd = process.cwd(),
): Array<{ key: string; url: string; disk: string }> {
  if (!generatedImages) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  const out: Array<{ key: string; url: string; disk: string }> = [];
  for (const [key, url] of Object.entries(generatedImages)) {
    if (!key.startsWith(prefix)) continue;
    if (!url || !String(url).trim()) continue;
    // skip video keys
    if (key.endsWith('_video')) continue;
    const disk = resolveMediaToDisk(url, cwd);
    if (disk) out.push({ key, url, disk });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}

export function collectChapterAudioDiskPaths(
  chapterNum: number,
  generatedAudioPaths: Record<string, { path: string; duration: number }> | undefined,
  cwd = process.cwd(),
): Array<{ key: string; url: string; disk: string; duration: number }> {
  if (!generatedAudioPaths) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  const out: Array<{ key: string; url: string; disk: string; duration: number }> = [];
  for (const [key, v] of Object.entries(generatedAudioPaths)) {
    if (!key.startsWith(prefix) && key !== String(chapterNum)) continue;
    if (!v?.path) continue;
    const disk = resolveMediaToDisk(v.path, cwd);
    if (disk) out.push({ key, url: v.path, disk, duration: v.duration || 0 });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}

export function collectChapterVideoDiskPaths(
  chapterNum: number,
  generatedVideos: Record<string, string> | undefined,
  cwd = process.cwd(),
): Array<{ key: string; url: string; disk: string }> {
  if (!generatedVideos) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  const out: Array<{ key: string; url: string; disk: string }> = [];
  for (const [key, url] of Object.entries(generatedVideos)) {
    if (!key.startsWith(prefix)) continue;
    if (!url) continue;
    const disk = resolveMediaToDisk(url, cwd);
    if (disk) out.push({ key, url, disk });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}
