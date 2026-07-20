import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { hostBindingChildEnv } from '@/lib/nav/hostBinding';
import { resolvePythonExe } from '@/app/api/self-heal/media/mediaHelpers';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_TOOLS = [
  'tai_ytdlp.py',
  'isolate_vocals.py',
  'diarize_audio.py',
  'cat_nho.py',
  'yt_goi_y.py',
  'watermark_audio.py',
  'extract_hardsub.py',
  'xu_ly_video.py',
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const { tool, args = [], timeoutMs = 600000 } = body;

    if (!ALLOWED_TOOLS.includes(tool)) {
      return NextResponse.json(
        { error: 'Công cụ không hợp lệ hoặc không được phép.' },
        { status: 400 },
      );
    }

    const scriptsDir = path.join(process.cwd(), 'python_core');
    const scriptPath = path.join(scriptsDir, tool);
    const pythonExe = resolvePythonExe();

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: `Không tìm thấy script ${scriptPath}` },
        { status: 404 },
      );
    }

    const bindingEnv = hostBindingChildEnv({
      action: `video-dub:${tool}`,
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 600_000,
    });

    return new Promise<NextResponse>((resolve) => {
      execFile(
        pythonExe,
        [scriptPath, ...(Array.isArray(args) ? args.map(String) : [])],
        {
          cwd: scriptsDir,
          timeout: typeof timeoutMs === 'number' ? timeoutMs : 600_000,
          maxBuffer: 1024 * 1024 * 10,
          env: {
            ...process.env,
            ...bindingEnv,
            PYTHONPATH: scriptsDir,
            PYTHONIOENCODING: 'utf-8',
          },
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve(
              NextResponse.json({
                success: false,
                error: error.message,
                stderr,
                stdout,
              }),
            );
            return;
          }
          resolve(NextResponse.json({ success: true, stdout, stderr }));
        },
      );
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
