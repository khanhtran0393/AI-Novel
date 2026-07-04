import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);
const PYTHON_EXE = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
const SCRIPTS_DIR = 'D:\\SuperAudioTools\\video-dub-scripts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, platform } = body;

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "keyword" parameter' }, { status: 400 });
    }

    if (platform && platform !== 'youtube') {
      return NextResponse.json({ error: 'Only "youtube" platform is supported currently' }, { status: 400 });
    }

    const args: string[] = [
      path.join(SCRIPTS_DIR, 'yt_goi_y.py'),
      '--keyword', keyword,
    ];

    console.log('[suggest-channels] Executing:', PYTHON_EXE, args.join(' '));

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, args, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      const logLines = stderr.split('\n').filter((l) => l.startsWith('LOG:'));
      if (logLines.length > 0) {
        console.log('[suggest-channels] Progress:', logLines.join('\n'));
      }
    }

    const jsonLines = stdout.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    const resultText = jsonLines.length > 0 ? jsonLines[jsonLines.length - 1] : stdout.trim();

    const result = JSON.parse(resultText);
    console.log('[suggest-channels] Success:', JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; code?: string };
    console.error('[suggest-channels] Error:', err.message);
    if (err.stderr) console.error('[suggest-channels] Stderr:', err.stderr);
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 }
    );
  }
}
