import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

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
  'xu_ly_video.py'
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tool, args = [], timeoutMs = 600000 } = body;

    if (!ALLOWED_TOOLS.includes(tool)) {
      return NextResponse.json({ error: 'Công cụ không hợp lệ hoặc không được phép.' }, { status: 400 });
    }

    const scriptsDir = 'D:\\SuperAudioTools\\video-dub-scripts';
    const scriptPath = path.join(scriptsDir, tool);
    const pythonExe = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';

    if (!fs.existsSync(pythonExe)) {
      return NextResponse.json({ error: `Không tìm thấy Python tại ${pythonExe}` }, { status: 404 });
    }
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: `Không tìm thấy script ${scriptPath}` }, { status: 404 });
    }

    return new Promise<NextResponse>((resolve) => {
      execFile(pythonExe, [scriptPath, ...args], { 
        cwd: scriptsDir, 
        timeout: timeoutMs, 
        maxBuffer: 1024 * 1024 * 10 // 10MB
      }, (error, stdout, stderr) => {
        if (error) {
          // Vẫn trả về 200 để frontend xử lý error text
          resolve(NextResponse.json({ success: false, error: error.message, stderr, stdout }));
          return;
        }
        resolve(NextResponse.json({ success: true, stdout, stderr }));
      });
    });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
