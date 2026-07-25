/**
 * Reconcile store media maps against real files on disk.
 * Ghost paths (store says audio/image exists, file missing) break export / I2V / preview.
 */
import fs from 'fs';
import path from 'path';
import {
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
} from '@/contracts';
import { resolveMediaToDisk } from '@/lib/integrations/mediaPaths';

export type MediaReconcileInput = {
  generatedAudioPaths?: Record<string, { path?: string; duration?: number } | undefined>;
  generatedImages?: Record<string, string | undefined>;
  generatedVideos?: Record<string, string | undefined>;
  generatedImageVariants?: Record<string, string[] | undefined>;
  generatedAssetDna?: Record<string, unknown>;
  /**
   * Fill missing store entries from AI Novel's canonical on-disk output
   * folders for this chapter. This never accepts an arbitrary GUI path.
   */
  discoverChapterNum?: number;
  /** When present, ignore stale files for scenes outside the live project. */
  discoverSceneIndices?: number[];
  cwd?: string;
  /** Min file size (bytes). Default 44 (tiny header junk). */
  minBytes?: number;
};

export type MediaReconcileResult = {
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
  generatedImages: Record<string, string>;
  generatedVideos: Record<string, string>;
  generatedImageVariants: Record<string, string[]>;
  generatedAssetDna: Record<string, unknown>;
  removedAudioKeys: string[];
  removedImageKeys: string[];
  removedVideoKeys: string[];
  removedVariantKeys: string[];
  removedDnaKeys: string[];
  addedAudioKeys: string[];
  addedImageKeys: string[];
  addedVideoKeys: string[];
  normalizedAudioKeys: string[];
  normalizedImageKeys: string[];
  normalizedVideoKeys: string[];
  changed: boolean;
};

type DiscoveredChapterMedia = {
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
  generatedImages: Record<string, string>;
  generatedVideos: Record<string, string>;
};

const IMAGE_MIN_BYTES = 10_000;
const AUDIO_MIN_BYTES = 10_000;
const VIDEO_MIN_BYTES = 100_000;

function directFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function realFile(file: string, minimumBytes: number): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size >= minimumBytes;
  } catch {
    return false;
  }
}

function rendererAudioPath(original: string, disk: string, cwd: string): string {
  if (original.startsWith('/audio/')) return original;
  const publicAudio = path.resolve(cwd, 'public', 'audio');
  const resolved = path.resolve(disk);
  if (resolved.startsWith(`${publicAudio}${path.sep}`)) {
    return `/audio/${encodeURIComponent(path.basename(resolved))}`;
  }
  return original;
}

function rendererImagePath(original: string, disk: string): string {
  if (original.startsWith('/api/serve-image')) return original;
  return `/api/serve-image?path=${encodeURIComponent(disk)}`;
}

function rendererVideoPath(original: string, disk: string): string {
  if (original.startsWith('/api/serve-local-video')) return original;
  return `/api/serve-local-video?path=${encodeURIComponent(disk)}`;
}

/**
 * Discover media produced by AI Novel itself. Only fixed internal output
 * folders and official filename contracts are accepted, so stale export packs,
 * fixtures, samples, or user-supplied external repo paths cannot enter here.
 */
export function discoverChapterMediaOnDisk(
  chapterNum: number,
  cwd = process.cwd(),
  sceneIndices?: number[],
): DiscoveredChapterMedia {
  const chapter = Number(chapterNum);
  const generatedAudioPaths: DiscoveredChapterMedia['generatedAudioPaths'] = {};
  const generatedImages: DiscoveredChapterMedia['generatedImages'] = {};
  const generatedVideos: DiscoveredChapterMedia['generatedVideos'] = {};
  if (!Number.isInteger(chapter) || chapter <= 0) {
    return { generatedAudioPaths, generatedImages, generatedVideos };
  }
  const allowedScenes = new Set(
    (sceneIndices || [])
      .map(Number)
      .filter((scene) => Number.isInteger(scene) && scene >= 0),
  );
  const sceneAllowed = (scene: number) =>
    allowedScenes.size === 0 || allowedScenes.has(scene);

  for (const file of directFiles(path.join(cwd, 'public', 'audio'))) {
    const match = new RegExp(
      `^chapter_${chapter}_scene_(\\d+)\\.(mp3|wav|m4a|aac)$`,
      'i',
    ).exec(path.basename(file));
    const scene = Number(match?.[1]);
    if (!match || !sceneAllowed(scene) || !realFile(file, AUDIO_MIN_BYTES)) {
      continue;
    }
    generatedAudioPaths[sceneAssetKey(chapter, scene)] = {
      path: `/audio/${encodeURIComponent(path.basename(file))}`,
      duration: 0,
    };
  }

  const imageDirs = [
    path.join(cwd, 'public', 'images'),
    path.join(cwd, 'image_output'),
  ];
  for (const [dirIndex, dir] of imageDirs.entries()) {
    for (const file of directFiles(dir)) {
      const name = path.basename(file);
      const canonical = new RegExp(
        `^chapter_${chapter}_scene_(\\d+)_prompt_(\\d+)\\.(png|jpe?g|webp)$`,
        'i',
      ).exec(name);
      const mirror = new RegExp(
        `^c${chapter}_s(\\d+)_p(\\d+)\\.(png|jpe?g|webp)$`,
        'i',
      ).exec(name);
      const match = canonical || mirror;
      const scene = Number(match?.[1]);
      if (!match || !sceneAllowed(scene) || !realFile(file, IMAGE_MIN_BYTES)) {
        continue;
      }
      const key = imageAssetKey(chapter, scene, Number(match[2]));
      if (dirIndex > 0 && generatedImages[key]) continue;
      if (mirror && generatedImages[key]) continue;
      generatedImages[key] =
        `/api/serve-image?path=${encodeURIComponent(file)}`;
    }
  }

  const videoDirs = [
    path.join(cwd, 'public', 'video'),
    path.join(cwd, 'veo_output'),
  ];
  for (const [dirIndex, dir] of videoDirs.entries()) {
    for (const file of directFiles(dir)) {
      const name = path.basename(file);
      const keyed = new RegExp(
        `^c${chapter}_s(\\d+)_p(\\d+)\\.(mp4|mov|webm)$`,
        'i',
      ).exec(name);
      const animatic = new RegExp(
        `^chapter_${chapter}_scene_(\\d+)_animatic\\.(mp4|mov|webm)$`,
        'i',
      ).exec(name);
      const match = keyed || animatic;
      const scene = Number(match?.[1]);
      if (!match || !sceneAllowed(scene) || !realFile(file, VIDEO_MIN_BYTES)) {
        continue;
      }
      const prompt = keyed ? Number(keyed[2]) : 0;
      const key = videoAssetKey(chapter, scene, prompt);
      if (dirIndex > 0 && generatedVideos[key]) continue;
      if (animatic && generatedVideos[key]) continue;
      generatedVideos[key] =
        `/api/serve-local-video?path=${encodeURIComponent(file)}`;
    }
  }

  return { generatedAudioPaths, generatedImages, generatedVideos };
}

function diskOk(
  raw: string | undefined | null,
  cwd: string,
  minBytes: number,
): string | null {
  const disk = resolveMediaToDisk(raw, cwd);
  if (!disk) return null;
  try {
    const st = fs.statSync(disk);
    if (!st.isFile() || st.size < minBytes) return null;
    return disk;
  } catch {
    return null;
  }
}

/**
 * Pure reconcile — drop keys whose media is missing / empty on disk.
 * Keeps store paths as originally stored when file exists (does not rewrite to abs).
 */
export function reconcileMediaMapsAgainstDisk(
  input: MediaReconcileInput,
): MediaReconcileResult {
  const cwd = input.cwd || (typeof process !== 'undefined' ? process.cwd() : '');
  const minBytes = Number.isFinite(input.minBytes) ? Number(input.minBytes) : 44;

  const removedAudioKeys: string[] = [];
  const removedImageKeys: string[] = [];
  const removedVideoKeys: string[] = [];
  const removedVariantKeys: string[] = [];
  const removedDnaKeys: string[] = [];
  const addedAudioKeys: string[] = [];
  const addedImageKeys: string[] = [];
  const addedVideoKeys: string[] = [];
  const normalizedAudioKeys: string[] = [];
  const normalizedImageKeys: string[] = [];
  const normalizedVideoKeys: string[] = [];

  const generatedAudioPaths: Record<string, { path: string; duration: number }> = {};
  for (const [k, v] of Object.entries(input.generatedAudioPaths || {})) {
    const path = String(v?.path || '').trim();
    if (!path) {
      removedAudioKeys.push(k);
      continue;
    }
    const disk = diskOk(path, cwd, minBytes);
    if (!disk) {
      removedAudioKeys.push(k);
      continue;
    }
    const normalizedPath = rendererAudioPath(path, disk, cwd);
    if (normalizedPath !== path) normalizedAudioKeys.push(k);
    generatedAudioPaths[k] = {
      path: normalizedPath,
      duration: Number(v?.duration) > 0 ? Number(v?.duration) : 0,
    };
  }

  const generatedImages: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.generatedImages || {})) {
    const path = String(v || '').trim();
    if (!path) {
      removedImageKeys.push(k);
      continue;
    }
    const disk = diskOk(path, cwd, minBytes);
    if (!disk) {
      removedImageKeys.push(k);
      continue;
    }
    const normalizedPath = rendererImagePath(path, disk);
    if (normalizedPath !== path) normalizedImageKeys.push(k);
    generatedImages[k] = normalizedPath;
  }

  const generatedVideos: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.generatedVideos || {})) {
    const path = String(v || '').trim();
    if (!path) {
      removedVideoKeys.push(k);
      continue;
    }
    const disk = diskOk(path, cwd, Math.max(minBytes, 1000));
    if (!disk) {
      removedVideoKeys.push(k);
      continue;
    }
    const normalizedPath = rendererVideoPath(path, disk);
    if (normalizedPath !== path) normalizedVideoKeys.push(k);
    generatedVideos[k] = normalizedPath;
  }

  if (input.discoverChapterNum !== undefined) {
    const discovered = discoverChapterMediaOnDisk(
      input.discoverChapterNum,
      cwd,
      input.discoverSceneIndices,
    );
    for (const [key, value] of Object.entries(
      discovered.generatedAudioPaths,
    )) {
      if (generatedAudioPaths[key]) continue;
      generatedAudioPaths[key] = value;
      addedAudioKeys.push(key);
    }
    for (const [key, value] of Object.entries(discovered.generatedImages)) {
      if (generatedImages[key]) continue;
      generatedImages[key] = value;
      addedImageKeys.push(key);
    }
    for (const [key, value] of Object.entries(discovered.generatedVideos)) {
      if (generatedVideos[key]) continue;
      generatedVideos[key] = value;
      addedVideoKeys.push(key);
    }
  }

  const generatedImageVariants: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(input.generatedImageVariants || {})) {
    const list = (Array.isArray(arr) ? arr : [])
      .map((p) => String(p || '').trim())
      .filter((p) => p && diskOk(p, cwd, minBytes));
    if (list.length === 0) {
      if ((arr || []).length > 0) removedVariantKeys.push(k);
      continue;
    }
    generatedImageVariants[k] = list;
  }

  // Drop DNA stamps for removed media keys (and orphan DNA)
  const keepKeys = new Set<string>([
    ...Object.keys(generatedAudioPaths),
    ...Object.keys(generatedImages),
    ...Object.keys(generatedVideos),
    ...Object.keys(generatedImageVariants),
  ]);
  const generatedAssetDna: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.generatedAssetDna || {})) {
    if (keepKeys.has(k)) {
      generatedAssetDna[k] = v;
    } else {
      removedDnaKeys.push(k);
    }
  }

  const changed =
    removedAudioKeys.length +
      removedImageKeys.length +
      removedVideoKeys.length +
      removedVariantKeys.length +
      removedDnaKeys.length +
      addedAudioKeys.length +
      addedImageKeys.length +
      addedVideoKeys.length +
      normalizedAudioKeys.length +
      normalizedImageKeys.length +
      normalizedVideoKeys.length >
    0;

  return {
    generatedAudioPaths,
    generatedImages,
    generatedVideos,
    generatedImageVariants,
    generatedAssetDna,
    removedAudioKeys,
    removedImageKeys,
    removedVideoKeys,
    removedVariantKeys,
    removedDnaKeys,
    addedAudioKeys,
    addedImageKeys,
    addedVideoKeys,
    normalizedAudioKeys,
    normalizedImageKeys,
    normalizedVideoKeys,
    changed,
  };
}

export function mediaReconcileSummary(r: MediaReconcileResult): string {
  const additions = [
    r.addedAudioKeys.length ? `audio+${r.addedAudioKeys.length}` : '',
    r.addedImageKeys.length ? `image+${r.addedImageKeys.length}` : '',
    r.addedVideoKeys.length ? `video+${r.addedVideoKeys.length}` : '',
  ].filter(Boolean);
  if (additions.length > 0) {
    return `Media disk reconcile: imported ${additions.join(' · ')} from canonical app output`;
  }
  const normalized =
    r.normalizedAudioKeys.length +
    r.normalizedImageKeys.length +
    r.normalizedVideoKeys.length;
  if (normalized > 0) {
    return `Media disk reconcile: normalized ${normalized} renderer URL(s)`;
  }
  if (!r.changed) return 'Media disk reconcile: OK (no ghosts)';
  const parts = [
    r.removedAudioKeys.length
      ? `audio×${r.removedAudioKeys.length}`
      : '',
    r.removedImageKeys.length
      ? `image×${r.removedImageKeys.length}`
      : '',
    r.removedVideoKeys.length
      ? `video×${r.removedVideoKeys.length}`
      : '',
  ].filter(Boolean);
  return `Media disk reconcile: dropped ${parts.join(' · ') || 'orphans'} (file missing)`;
}
