import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  try {
    const { videoPath, outPath, model = 'small', language = 'auto' } = await req.json();

    if (!videoPath || typeof videoPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "videoPath" parameter' }, { status: 400 });
    }

    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: `Video file not found: ${videoPath}` }, { status: 400 });
    }

    const outputPath = typeof outPath === 'string' && outPath.trim()
      ? outPath.trim()
      : videoPath.replace(/\.[^.\\/]+$/, '.srt');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const pythonCore = path.join(process.cwd(), 'python_core');
    const scriptPath = path.join(pythonCore, 'api_nav_subtitle.py');

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: `Subtitle script not found: ${scriptPath}` }, { status: 500 });
    }

    const PYTHON_EXE = fs.existsSync('D:\\SuperAudioTools\\omnivoice-python\\python.exe')
      ? 'D:\\SuperAudioTools\\omnivoice-python\\python.exe'
      : 'python';

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, [scriptPath, videoPath, outputPath, String(model), String(language)], {
      cwd: pythonCore,
      env: { ...process.env, PYTHONPATH: pythonCore, TORCH_COMPILE_DISABLE: '1' },
      timeout: 600000,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });

    const jsonLines = stdout.split(/\r?\n/).filter(line => line.trim().startsWith('{'));
    const parsed = jsonLines.length > 0 ? JSON.parse(jsonLines[jsonLines.length - 1]) : null;
    if (parsed && parsed.success === false) {
      return NextResponse.json(parsed, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stdout,
      stderr,
      outPath: outputPath,
      result: parsed,
    });
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return NextResponse.json(
      { success: false, error: err.message, stderr: err.stderr || null },
      { status: 500 },
    );
  }
}
