import fs from 'fs';
import path from 'path';

function sanitizeFolderName(name: string): string {
  return (
    (name || '')
      .normalize('NFC')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'Kenh_Chinh'
  );
}

export type ChannelResourceType =
  | 'images'
  | 'video'
  | 'audio'
  | 'scripts'
  | 'thumbnails'
  | 'ship_pack';

/**
 * Tự động sao chép / lưu trữ mọi tài nguyên vừa sinh ra (Ảnh, Video, Audio, Thumbnail, Kịch bản)
 * vào trực tiếp thư mục loại tài nguyên của Kênh đang hoạt động.
 * Ví dụ: output/channels/<Tên_Kênh>/images/<filename>
 */
export function autoSaveToChannelFolder(opts: {
  channelName?: string;
  resourceType: ChannelResourceType;
  sourceFilePath: string;
  targetFileName?: string;
}): string | null {
  try {
    const { channelName = 'Kênh Chính', resourceType, sourceFilePath, targetFileName } = opts;
    if (!sourceFilePath || typeof sourceFilePath !== 'string') return null;

    let realSource = sourceFilePath.split('?')[0].trim();
    if (!realSource) return null;

    // Resolve serve-image or serve-video URLs to disk
    const cwd = process.cwd();
    if (realSource.startsWith('/api/serve-image')) {
      const match = realSource.match(/[?&]file=([^&]+)/i);
      if (match) {
        realSource = path.join(cwd, 'public', 'images', decodeURIComponent(match[1]));
      }
    } else if (realSource.startsWith('/audio/')) {
      realSource = path.join(cwd, 'public', realSource.slice(1));
    } else if (realSource.startsWith('/video/')) {
      realSource = path.join(cwd, 'public', realSource.slice(1));
    } else if (realSource.startsWith('/images/')) {
      realSource = path.join(cwd, 'public', realSource.slice(1));
    }

    if (!path.isAbsolute(realSource)) {
      realSource = path.resolve(cwd, realSource);
    }

    if (!fs.existsSync(realSource)) {
      return null;
    }

    const sanitizedChannel = sanitizeFolderName(channelName);
    const destDir = path.resolve(cwd, 'output', 'channels', sanitizedChannel, resourceType);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const filename = targetFileName || path.basename(realSource);
    const destPath = path.join(destDir, filename);

    if (path.resolve(realSource) !== path.resolve(destPath)) {
      const stat = fs.statSync(realSource);
      if (stat.isDirectory()) {
        fs.cpSync(realSource, destPath, { recursive: true });
      } else {
        fs.copyFileSync(realSource, destPath);
      }
      console.log(`[ChannelMirror] Auto-saved ${resourceType} -> ${destPath}`);
    }

    return destPath;
  } catch (err) {
    console.warn('[ChannelMirror] Save error (ignored):', err);
    return null;
  }
}
