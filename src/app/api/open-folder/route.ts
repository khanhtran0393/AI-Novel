import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

function resolveOpenTarget(folderPath: string): string {
  const raw = (folderPath || '').trim();
  const cwd = process.cwd();

  // Aliases used by Header / UI
  if (
    !raw ||
    raw === '.' ||
    raw === 'project' ||
    raw === 'cwd' ||
    raw === 'root' ||
    raw.toLowerCase() === 'project-root'
  ) {
    return path.resolve(cwd);
  }

  // Absolute or relative path
  return path.resolve(/* turbopackIgnore: true */ raw);
}

async function openWithExplorer(resolvedPath: string): Promise<void> {
  // Một lệnh duy nhất theo OS — không cmd start dự phòng
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [resolvedPath], {
      detached: true,
      stdio: 'ignore'
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
    };
    const folderPath = body.folderPath ?? body.path ?? 'project';

    let resolvedPath = resolveOpenTarget(folderPath);

    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        console.log(`[Open Folder] Created: ${resolvedPath}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          {
            error: `Thư mục không tồn tại và không tạo được: ${resolvedPath}. ${msg}. Không fallback cwd.`,
          },
          { status: 400 },
        );
      }
    }
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: `Thư mục không tồn tại: ${resolvedPath}. Không fallback cwd.` },
        { status: 400 },
      );
    }

    try {
      await openWithExplorer(resolvedPath);
    } catch (openError: unknown) {
      return NextResponse.json(
        {
          error: openError instanceof Error ? openError.message : String(openError),
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
