/**
 * Resolve AI Novel media URLs / store values to absolute filesystem paths
 * so FableCut / watch / ffmpeg can open real files.
 */
import fs from 'fs';
import path from 'path';
import { assetKeyBelongsToChapter, chapterAssetPrefix } from '@/contracts';

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
  const s = raw.trim();
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
      path.join('public', 'audio', 'multi', base),
      path.join('public', 'audio', 'scenes', base),
      path.join('public', 'audio', 'clones', base),
      path.join('public', 'audio', 'previews', base),
      path.join('public', 'video', base),
      path.join('public', 'renders', base),
      path.join('.ainovel-app', 'audio', base),
      path.join('.ainovel-app', base),
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
    if (!key.startsWith(prefix) && key !== String(chapterNum) && !assetKeyBelongsToChapter(key, chapterNum)) continue;
    if (!url || !String(url).trim()) continue;
    if (key.endsWith('_video')) continue;
    const disk = resolveMediaToDisk(url, cwd);
    if (disk) out.push({ key, url, disk });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}

export function collectChapterAudioDiskPaths(
  chapterNum: number,
  generatedAudioPaths: Record<string, { path: string; duration: number } | string> | undefined,
  cwd = process.cwd(),
): Array<{ key: string; url: string; disk: string; duration: number }> {
  if (!generatedAudioPaths) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  const rawList: Array<{ key: string; url: string; disk: string; duration: number }> = [];

  for (const [key, rawV] of Object.entries(generatedAudioPaths)) {
    if (!key.startsWith(prefix) && key !== String(chapterNum) && !assetKeyBelongsToChapter(key, chapterNum)) continue;
    const url = typeof rawV === 'string' ? rawV.trim() : String(rawV?.path || '').trim();
    const duration = typeof rawV === 'object' && rawV ? Number(rawV.duration) || 0 : 0;
    if (!url) continue;
    const disk = resolveMediaToDisk(url, cwd);
    if (disk) rawList.push({ key, url, disk, duration });
  }
  rawList.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return rawList;
}

export type ChapterAudioDiskPath = ReturnType<
  typeof collectChapterAudioDiskPaths
>[number];

export function isFullChapterAudioKey(key: string): boolean {
  return /(?:^|_)full(?:_|$)/i.test(String(key || '').trim());
}

function sceneIndexFromAudioKey(key: string, chapterNum: number): number | null {
  const clean = String(key || '').replace(/_video$/, '').trim();
  const conventional = clean.match(
    new RegExp(`^${chapterNum}[_-](\\d+)(?:[_-]|$)`, 'i'),
  );
  if (conventional) return Number(conventional[1]);
  const named = clean.match(/(?:scene[_-]?|s)(\d+)(?:[_-]|$)/i);
  return named ? Number(named[1]) : null;
}

/**
 * Pick one authoritative narration representation for a CapCut timeline.
 *
 * TTS can persist both a chapter aggregate (`1_full`) and its scene files
 * (`1_0`, `1_1`, ...). They are the same narration, so putting both on the
 * timeline doubles its length. Prefer scene files only when their probed
 * duration covers the full file; otherwise keep the full file rather than
 * exporting a truncated chapter.
 */
export function selectChapterTimelineAudioPaths(
  chapterNum: number,
  entries: readonly ChapterAudioDiskPath[],
  probeDuration?: (diskPath: string) => number,
): ChapterAudioDiskPath[] {
  const measured = entries.map((entry) => {
    const probed = probeDuration?.(entry.disk) || 0;
    return {
      ...entry,
      duration: probed > 0.1 ? probed : entry.duration,
    };
  });
  const full = measured.filter((entry) => isFullChapterAudioKey(entry.key));
  const segments = measured.filter(
    (entry) => !isFullChapterAudioKey(entry.key),
  );
  if (full.length === 0 || segments.length === 0) return measured;

  const contentSegments = segments.filter((entry) => {
    const scene = sceneIndexFromAudioKey(entry.key, chapterNum);
    return scene != null && scene !== 990;
  });
  const fullDuration = Math.max(...full.map((entry) => entry.duration || 0));
  const segmentDuration = segments.reduce(
    (total, entry) => total + Math.max(0, entry.duration || 0),
    0,
  );
  const coverage =
    fullDuration > 0.1 ? segmentDuration / fullDuration : Number.NaN;
  const segmentsCoverFull =
    contentSegments.length > 0 &&
    Number.isFinite(coverage) &&
    coverage >= 0.95 &&
    coverage <= 1.05;

  return segmentsCoverFull ? segments : full;
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
    if (!key.startsWith(prefix) && key !== String(chapterNum) && !assetKeyBelongsToChapter(key, chapterNum)) continue;
    if (!url) continue;
    const disk = resolveMediaToDisk(url, cwd);
    if (disk) out.push({ key, url, disk });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}
