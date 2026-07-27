import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

function sanitizeFolderName(name: string): string {
  return (
    (name || '')
      .normalize('NFC')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'Kenh_Chinh'
  );
}

function resolveOpenTarget(folderPath: string): string {
  const raw = (folderPath || '').trim();
  const cwd = process.cwd();

  // Output / Channels directory alias (user picks channel folder)
  if (
    !raw ||
    raw === 'output' ||
    raw === 'output/channels' ||
    raw === 'channels' ||
    raw === 'project' ||
    raw === '.'
  ) {
    const channelsDir = path.resolve(cwd, 'output', 'channels');
    if (!fs.existsSync(channelsDir)) {
      fs.mkdirSync(channelsDir, { recursive: true });
    }
    return channelsDir;
  }

  // Absolute or relative path
  return path.resolve(/* turbopackIgnore: true */ raw);
}

async function openWithExplorer(resolvedPath: string): Promise<void> {
  // Một lệnh duy nhất theo OS — không cmd start dự phòng
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [resolvedPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [resolvedPath]);
    return;
  }
  await execFileAsync('xdg-open', [resolvedPath]);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      folderPath?: string;
      path?: string;
      channelId?: string;
      channelName?: string;
      resourceType?:
        | 'all'
        | 'images'
        | 'video'
        | 'audio'
        | 'scripts'
        | 'thumbnails'
        | 'ship_pack';
    };

    const cwd = process.cwd();
    let resolvedPath = '';

    // Channel specific output folder with resource subfolders
    if (body.channelName || body.channelId || body.resourceType) {
      const channelFolder = sanitizeFolderName(
        body.channelName || body.channelId || 'Kênh Chính',
      );
      const channelRootDir = path.resolve(
        cwd,
        'output',
        'channels',
        channelFolder,
      );

      // Subfolders by resource type inside the channel folder
      const subfolders = [
        'images',
        'video',
        'audio',
        'scripts',
        'thumbnails',
        'ship_pack',
      ];

      // Auto-create channel root folder & all resource subfolders
      fs.mkdirSync(channelRootDir, { recursive: true });
      for (const sub of subfolders) {
        const subPath = path.join(channelRootDir, sub);
        if (!fs.existsSync(subPath)) {
          fs.mkdirSync(subPath, { recursive: true });
        }
      }

      if (
        body.resourceType &&
        body.resourceType !== 'all' &&
        subfolders.includes(body.resourceType)
      ) {
        resolvedPath = path.join(channelRootDir, body.resourceType);
      } else {
        resolvedPath = channelRootDir;
      }
    } else {
      const folderPath = body.folderPath ?? body.path ?? 'project';
      resolvedPath = resolveOpenTarget(folderPath);
    }

    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        console.log(`[Open Folder] Created: ${resolvedPath}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          {
            error: `Thư mục không tồn tại và không tạo được: ${resolvedPath}. ${msg}.`,
          },
          { status: 400 },
        );
      }
    }

    try {
      await openWithExplorer(resolvedPath);
    } catch (openError: unknown) {
      return NextResponse.json(
        {
          error:
            openError instanceof Error
              ? openError.message
              : String(openError),
          path: resolvedPath,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, opened: resolvedPath });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Lỗi khi mở thư mục.',
      },
      { status: 500 },
    );
  }
}
