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
    // Prefer project root; then common media/output dirs
    const candidates = [
      cwd,
      path.join(cwd, 'public', 'generated'),
      path.join(cwd, 'output'),
      path.join(cwd, 'public'),
      path.join(cwd, '.ainovel-app'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.resolve(c);
    }
    return path.resolve(cwd);
  }

  // Absolute or relative path
  return path.resolve(raw);
}

async function openWithExplorer(resolvedPath: string): Promise<void> {
  // Windows: explorer.exe; also try shell.open via cmd start as fallback
  if (process.platform === 'win32') {
    try {
      const child = spawn('explorer.exe', [resolvedPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return;
    } catch {
      /* fall through */
    }
    // Fallback: cmd start
    await execFileAsync('cmd.exe', ['/c', 'start', '', resolvedPath], {
      windowsHide: true,
    });
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

    // Auto-create if missing (absolute user path)
    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        console.log(`[Open Folder] Created: ${resolvedPath}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Open Folder] Cannot create: ${msg}`);
      }
    }

    // If still missing, fall back to cwd
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = path.resolve(process.cwd());
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
