/**
 * CapCut export packer — packs chapter media for the in-app multi-track editor.
 * Runtime path remains tools/xinchao-cut (vendored engine folder); product name is CapCut.
 */
import fs from 'fs';
import path from 'path';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
  isFullChapterAudioKey,
  selectChapterTimelineAudioPaths,
} from '@/lib/integrations/mediaPaths';
import { getIntegrationPaths } from '@/lib/integrations/paths';
import {
  assetKeyBelongsToChapter,
  chapterAssetPrefix,
  parseSceneAssetKey,
} from '@/contracts';
import { probeDurationSec } from '@/lib/audioStudio';
import {
  buildChapterTimelineReservation,
  type ChapterTimelineReservation,
} from '@/lib/integrations/timelineReservation';
import type { TimedPrompt } from '@/lib/timestampSync';

export const XINCHAO_DEFAULT_DEV_PORT = 5173;

export interface XinChaoPackInput {
  chapterNum: number;
  ten_tac_pham?: string;
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  generatedPrompts?: Record<string, TimedPrompt[]>;
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
  timelineReservation?: ChapterTimelineReservation;
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
 * Build a media pack under exports/integrations/capcut for the CapCut editor.
 * Runtime imports this pack through --ainovel-pack.
 */
export function buildXinChaoPack(input: XinChaoPackInput): XinChaoPackResult {
  const cwd = input.cwd || process.cwd();
  const paths = getIntegrationPaths(cwd);
  // Product name CapCut (not xinchao_cut). Keep legacy folder as secondary write target only if needed.
  const packBase = path.join(paths.workRoot, 'capcut');
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
  const rawAudios = collectChapterAudioDiskPaths(
    ch,
    input.generatedAudioPaths || {},
  );
  const audios = selectChapterTimelineAudioPaths(
    ch,
    rawAudios,
    (diskPath) => probeDurationSec(diskPath, cwd),
  );
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
    .filter(([key, value]) => {
      if (!key.startsWith(chapterPrefix) && key !== String(ch) && !assetKeyBelongsToChapter(key, ch)) return false;
      const vObj = value as unknown as { path?: string } | string;
      const pathVal = typeof vObj === 'string' ? vObj.trim() : String(vObj?.path || '').trim();
      return Boolean(pathVal);
    })
    .map(([key]) => key);
  const unresolved = [
    ...requestedImageKeys.filter((key) => !images.some((entry) => entry.key === key)),
    ...requestedVideoKeys.filter((key) => !videos.some((entry) => entry.key === key)),
    ...requestedAudioKeys.filter(
      (key) => !rawAudios.some((entry) => entry.key === key),
    ),
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
        'Không có media trên đĩa cho chương này. Gen ảnh/video/TTS trước khi xuất CapCut.',
    };
  }

  const audioFiles = files
    .filter((f) => f.kind === 'audio')
    .map((f) => ({ ...f }));

  let timelineReservation: ChapterTimelineReservation;
  try {
    const copiedPathByKey = new Map(files.map((file) => [file.key, file.rel]));
    timelineReservation = buildChapterTimelineReservation({
      chapterNum: ch,
      projectName: input.ten_tac_pham || 'AI-Novel',
      prompts: input.generatedPrompts || {},
      audio: rawAudios.map((audio) => ({
        key: audio.key,
        path: copiedPathByKey.get(audio.key),
        durationSec:
          probeDurationSec(audio.disk, cwd) || Number(audio.duration) || 0,
      })),
      images: files
        .filter((file) => file.kind === 'image')
        .map((file) => ({ key: file.key, path: file.rel })),
      videos: files
        .filter((file) => file.kind === 'video')
        .map((file) => ({ key: file.key, path: file.rel })),
    });
  } catch (error) {
    return {
      success: false,
      packRoot,
      mediaDir,
      manifestPath: '',
      openEditorHint: '',
      media: { images: 0, videos: 0, audios: 0, files: 0 },
      timelineClips: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const reservedTimeline: Array<Record<string, unknown>> =
    timelineReservation.slots
      .filter(
        (slot): slot is typeof slot & {
          mediaKey: string;
          mediaKind: 'image' | 'video';
          mediaPath: string;
        } => Boolean(slot.mediaKey && slot.mediaKind && slot.mediaPath),
      )
      .map((slot) => ({
        key: slot.mediaKey,
        slotId: slot.slotId,
        kind: slot.mediaKind,
        path: slot.mediaPath,
        startSec: slot.startSec,
        durationSec: slot.durationSec,
      }));

  if (audioFiles.length === 1 && isFullChapterAudioKey(audioFiles[0].key)) {
    reservedTimeline.push({
      key: audioFiles[0].key,
      slotId: `chapter:${ch}:audio`,
      kind: 'audio',
      path: audioFiles[0].rel,
      startSec: 0,
      durationSec: timelineReservation.durationSec,
    });
  } else {
    let audioCursor = 0;
    const orderedAudio = [...audioFiles].sort((left, right) => {
      const leftScene = parseSceneAssetKey(left.key)?.sceneIndex ?? 0;
      const rightScene = parseSceneAssetKey(right.key)?.sceneIndex ?? 0;
      const rank = (sceneIndex: number) => (sceneIndex === 990 ? -1 : sceneIndex);
      return rank(leftScene) - rank(rightScene) || left.key.localeCompare(right.key);
    });
    for (const audio of orderedAudio) {
      const durationSec =
        Number(audio.duration) > 0
          ? Number(audio.duration)
          : probeDurationSec(audio.disk, cwd);
      if (!(durationSec > 0)) {
        return {
          success: false,
          packRoot,
          mediaDir,
          manifestPath: '',
          openEditorHint: '',
          media: { images: 0, videos: 0, audios: 0, files: 0 },
          timelineClips: 0,
          error: `Không đọc được duration audio ${audio.key}`,
        };
      }
      reservedTimeline.push({
        key: audio.key,
        slotId: `chapter:${ch}:audio:${audio.key}`,
        kind: 'audio',
        path: audio.rel,
        startSec: audioCursor,
        durationSec,
      });
      audioCursor += durationSec;
    }
  }

  const manifest = {
    version: 1,
    source: 'ai-novel',
    /** Product name CapCut; 'xinchao-cut' kept as legacy wire alias accepted by runtime. */
    editor: 'capcut',
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
    timelineReservation,
    suggestedTimeline: reservedTimeline,
    howToImport: [
      'Bấm nút CapCut trong AI Novel.',
      'Runtime CapCut nội bộ tự tạo project đúng tỷ lệ.',
      'Runtime tự nhập file thật trong media/ bằng path-backed asset.',
      'Runtime tự dựng timeline theo suggestedTimeline (startSec / durationSec).',
    ],
  };

  // Wire filename kept for native/web runtime seam; product name is CapCut.
  const manifestPath = path.join(packRoot, 'ainovel-xinchao-pack.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // README for user
  const readme = [
    `# CapCut pack — Chương ${ch}`,
    '',
    `Tác phẩm: ${input.ten_tac_pham || 'AI-Novel'}`,
    `Aspect: ${aspect} · ${width}x${height} @ ${fps}fps`,
    '',
    '## Mở project thật',
    '1. Bấm nút ✂️ CapCut trong AI Novel.',
    '2. Runtime CapCut nội bộ tự đọc manifest này.',
    '3. Media trong `media/` được nhập trực tiếp từ đĩa, không dùng dữ liệu mẫu.',
    '4. Timeline được tạo từ `suggestedTimeline` và lưu như project CapCut thật.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(packRoot, 'README.md'), readme, 'utf8');

  const editorRoot = resolveXinChaoRoot(cwd);
  const openEditorHint = fs.existsSync(path.join(editorRoot, 'package.json'))
    ? `Mở nút CapCut trong AI Novel (runtime: ${editorRoot})`
    : 'Thiếu runtime CapCut nội bộ — chạy npm run xinchao:install';

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
    timelineClips: reservedTimeline.length,
    timelineReservation,
  };
}
