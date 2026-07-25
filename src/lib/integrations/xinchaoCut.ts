/**
 * XinChao-Cut bridge — packs chapter media for the vendored multi-track editor
 * at tools/xinchao-cut (full repo structure, not forked into workspace).
 */
import fs from 'fs';
import path from 'path';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
} from '@/lib/integrations/mediaPaths';
import { getIntegrationPaths } from '@/lib/integrations/paths';
import { chapterAssetPrefix } from '@/contracts';

export const XINCHAO_DEFAULT_DEV_PORT = 5173;

export interface XinChaoPackInput {
  chapterNum: number;
  ten_tac_pham?: string;
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  generatedImages?: Record<string, string>;
  generatedVideos?: Record<string, string>;
  aspect: string;
  videoDuration: number;
  imageProvider: string;
  videoProvider: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Absolute app root (cwd) for tools/ + exports/ resolution */
  cwd?: string;
}

export interface XinChaoPackResult {
  success: boolean;
  packRoot: string;
  mediaDir: string;
  manifestPath: string;
  openEditorHint: string;
  media: { images: number; videos: number; audios: number; files: number };
  timelineClips: number;
  error?: string;
}

function safeName(s: string): string {
  return String(s || 'AI-Novel')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'AI-Novel';
}

function aspectSize(aspect: string): { width: number; height: number } {
  const a = aspect.trim();
  if (a === '9:16') return { width: 1080, height: 1920 };
  if (a === '1:1') return { width: 1080, height: 1080 };
  if (a === '4:5') return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}

function copyInto(src: string, destDir: string, preferredName?: string): string {
  if (!src || !fs.existsSync(src)) {
    throw new Error(`Media nguồn không tồn tại trên đĩa: ${src || '(trống)'}`);
  }
  const ext = path.extname(src) || '';
  const base =
    preferredName && preferredName.includes('.')
      ? preferredName
      : `${preferredName || path.basename(src, ext)}${ext}`;
  const dest = path.join(destDir, base.replace(/[<>:"/\\|?*]/g, '_'));
  fs.mkdirSync(destDir, { recursive: true });
  if (path.resolve(dest) !== path.resolve(src)) {
    fs.copyFileSync(src, dest);
  }
  return dest;
}

/** Resolve tools/xinchao-cut root (vendored full repo). */
export function resolveXinChaoRoot(cwd = process.cwd()): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    process.env.AI_NOVEL_ROOT
      ? path.join(process.env.AI_NOVEL_ROOT, 'tools', 'xinchao-cut')
      : '',
    resourcesPath ? path.join(resourcesPath, 'tools', 'xinchao-cut') : '',
    path.join(cwd, 'tools', 'xinchao-cut'),
  ].filter(Boolean);
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'package.json')),
  );
  return found || path.join(cwd, 'tools', 'xinchao-cut');
}

export function isXinChaoPresent(cwd = process.cwd()): boolean {
  const root = resolveXinChaoRoot(cwd);
  return (
    fs.existsSync(path.join(root, 'package.json')) &&
    fs.existsSync(path.join(root, 'src', 'app', 'App.tsx'))
  );
}

/**
 * Build a media pack under exports/integrations/xinchao-cut for the editor.
 * The bundled XinChao-Cut runtime imports this pack through --ainovel-pack.
 */
export function buildXinChaoPack(input: XinChaoPackInput): XinChaoPackResult {
  const cwd = input.cwd || process.cwd();
  const paths = getIntegrationPaths(cwd);
  const packBase = path.join(paths.workRoot, 'xinchao-cut');
  fs.mkdirSync(packBase, { recursive: true });

  const ch = Number(input.chapterNum);
  if (!Number.isFinite(ch) || ch < 1) {
    return {
      success: false,
      packRoot: packBase,
      mediaDir: '',
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: 'chapterNum không hợp lệ',
    };
  }

  const aspect = String(input.aspect || '').trim();
  if (!['16:9', '9:16', '1:1', '4:5'].includes(aspect)) {
    return {
      success: false,
      packRoot: packBase,
      mediaDir: '',
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: 'aspect phải được cấu hình rõ: 16:9, 9:16, 1:1 hoặc 4:5',
    };
  }
  const configuredDuration = Number(input.videoDuration);
  if (!Number.isFinite(configuredDuration) || configuredDuration <= 0) {
    return {
      success: false,
      packRoot: packBase,
      mediaDir: '',
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: 'videoDuration phải được cấu hình rõ và lớn hơn 0',
    };
  }
  const imageProvider = String(input.imageProvider || '').trim();
  const videoProvider = String(input.videoProvider || '').trim();
  if (!imageProvider || !videoProvider) {
    return {
      success: false,
      packRoot: packBase,
      mediaDir: '',
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: 'imageProvider và videoProvider phải được cấu hình rõ',
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const packName = `${safeName(input.ten_tac_pham || 'AI-Novel')}_ch${ch}_${stamp}`;
  const packRoot = path.join(packBase, packName);
  const mediaDir = path.join(packRoot, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const images = collectChapterImageDiskPaths(ch, input.generatedImages || {});
  const videos = collectChapterVideoDiskPaths(ch, input.generatedVideos || {});
  const audios = collectChapterAudioDiskPaths(ch, input.generatedAudioPaths || {});
  const chapterPrefix = chapterAssetPrefix(ch);
  const requestedImageKeys = Object.entries(input.generatedImages || {})
    .filter(
      ([key, value]) =>
        key.startsWith(chapterPrefix) &&
        !key.endsWith('_video') &&
        Boolean(String(value || '').trim()),
    )
    .map(([key]) => key);
  const requestedVideoKeys = Object.entries(input.generatedVideos || {})
    .filter(
      ([key, value]) =>
        key.startsWith(chapterPrefix) && Boolean(String(value || '').trim()),
    )
    .map(([key]) => key);
  const requestedAudioKeys = Object.entries(input.generatedAudioPaths || {})
    .filter(
      ([key, value]) =>
        (key.startsWith(chapterPrefix) || key === String(ch)) &&
        Boolean(String(value?.path || '').trim()),
    )
    .map(([key]) => key);
  const unresolved = [
    ...requestedImageKeys.filter((key) => !images.some((entry) => entry.key === key)),
    ...requestedVideoKeys.filter((key) => !videos.some((entry) => entry.key === key)),
    ...requestedAudioKeys.filter((key) => !audios.some((entry) => entry.key === key)),
  ];
  if (unresolved.length > 0) {
    return {
      success: false,
      packRoot,
      mediaDir,
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: `Media chưa resolve được trên đĩa: ${unresolved.join(', ')}`,
    };
  }

  const size = aspectSize(aspect);
  const width = input.width || size.width;
  const height = input.height || size.height;
  const fps = input.fps || 30;
  const durationHint = Math.max(1, Math.min(30, configuredDuration));

  type FileEntry = {
    key: string;
    kind: 'image' | 'video' | 'audio';
    disk: string;
    duration?: number;
    rel: string;
  };
  const files: FileEntry[] = [];
  const copyFailures: string[] = [];

  for (const v of videos) {
    try {
      const dest = copyInto(
        v.disk,
        mediaDir,
        `v_${safeName(v.key)}${path.extname(v.disk)}`,
      );
      files.push({
        key: v.key,
        kind: 'video',
        disk: dest,
        rel: path.relative(packRoot, dest).replace(/\\/g, '/'),
      });
    } catch (error) {
      copyFailures.push(
        `${v.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const im of images) {
    try {
      const dest = copyInto(
        im.disk,
        mediaDir,
        `i_${safeName(im.key)}${path.extname(im.disk)}`,
      );
      files.push({
        key: im.key,
        kind: 'image',
        disk: dest,
        rel: path.relative(packRoot, dest).replace(/\\/g, '/'),
      });
    } catch (error) {
      copyFailures.push(
        `${im.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const a of audios) {
    try {
      const dest = copyInto(
        a.disk,
        mediaDir,
        `a_${safeName(a.key)}${path.extname(a.disk)}`,
      );
      files.push({
        key: a.key,
        kind: 'audio',
        disk: dest,
        duration: a.duration,
        rel: path.relative(packRoot, dest).replace(/\\/g, '/'),
      });
    } catch (error) {
      copyFailures.push(
        `${a.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (copyFailures.length > 0) {
    return {
      success: false,
      packRoot,
      mediaDir,
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: `Không copy đủ media: ${copyFailures.join(' | ')}`,
    };
  }

  if (files.length === 0) {
    return {
      success: false,
      packRoot,
      mediaDir,
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error:
        'Không có media trên đĩa cho chương này. Gen ảnh/video/TTS trước khi mở XinChao-Cut.',
    };
  }

  const visual = files.filter((f) => f.kind === 'video' || f.kind === 'image');
  const audioOnly = files.filter((f) => f.kind === 'audio');
  const totalAudioDur = audioOnly.reduce((s, a) => s + (a.duration || 0), 0);
  const perClip =
    visual.length > 0 && totalAudioDur > 0
      ? Math.max(2, totalAudioDur / visual.length)
      : Math.max(2, durationHint);

  const timeline: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (const v of visual) {
    timeline.push({
      key: v.key,
      kind: v.kind,
      path: v.rel,
      startSec: cursor,
      durationSec: perClip,
    });
    cursor += perClip;
  }
  let audioCursor = 0;
  for (const a of audioOnly) {
    const dur = a.duration && a.duration > 0 ? a.duration : perClip;
    timeline.push({
      key: a.key,
      kind: 'audio',
      path: a.rel,
      startSec: audioCursor,
      durationSec: dur,
    });
    audioCursor += dur;
  }

  const manifest = {
    version: 1,
    source: 'ai-novel',
    editor: 'xinchao-cut',
    name: `${safeName(input.ten_tac_pham || 'AI-Novel')} — Chương ${ch}`,
    chapterNum: ch,
    ten_tac_pham: input.ten_tac_pham || 'AI-Novel',
    aspect,
    imageProvider,
    videoProvider,
    width,
    height,
    fps,
    createdAt: new Date().toISOString(),
    mediaDir: 'media',
    files: files.map((f) => ({
      key: f.key,
      kind: f.kind,
      path: f.rel,
      durationSec: f.duration ?? null,
    })),
    suggestedTimeline: timeline,
    howToImport: [
      'Bấm nút CapCut trong AI Novel.',
      'Runtime XinChao-Cut nội bộ tự tạo project đúng tỷ lệ.',
      'Runtime tự nhập file thật trong media/ bằng path-backed asset.',
      'Runtime tự dựng timeline theo suggestedTimeline (startSec / durationSec).',
    ],
  };

  const manifestPath = path.join(packRoot, 'ainovel-xinchao-pack.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // README for user
  const readme = [
    `# XinChao-Cut pack — Chương ${ch}`,
    '',
    `Tác phẩm: ${input.ten_tac_pham || 'AI-Novel'}`,
    `Aspect: ${aspect} · ${width}x${height} @ ${fps}fps`,
    '',
    '## Mở project thật',
    '1. Bấm nút ✂️ CapCut trong AI Novel.',
    '2. Runtime XinChao-Cut nội bộ tự đọc manifest này.',
    '3. Media trong `media/` được nhập trực tiếp từ đĩa, không dùng dữ liệu mẫu.',
    '4. Timeline được tạo từ `suggestedTimeline` và lưu như project XinChao-Cut thật.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(packRoot, 'README.md'), readme, 'utf8');

  const xinchaoRoot = resolveXinChaoRoot(cwd);
  const openEditorHint = fs.existsSync(path.join(xinchaoRoot, 'package.json'))
    ? `npm run xinchao:dev  (root: ${xinchaoRoot})`
    : 'Cài tools/xinchao-cut (npm run xinchao:install)';

  return {
    success: true,
    packRoot,
    mediaDir,
    manifestPath,
    openEditorHint,
    media: {
      images: files.filter((file) => file.kind === 'image').length,
      videos: files.filter((file) => file.kind === 'video').length,
      audios: files.filter((file) => file.kind === 'audio').length,
      files: files.length,
    },
    timelineClips: timeline.length,
  };
}
