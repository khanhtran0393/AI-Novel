import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const PYTHON_EXE = fs.existsSync('D:\\SuperAudioTools\\omnivoice-python\\python.exe')
  ? 'D:\\SuperAudioTools\\omnivoice-python\\python.exe'
  : 'python';
const SCRIPTS_DIR = path.join(process.cwd(), 'python_core');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { videoPath, targetDuration, outputDir } = body;

    if (!videoPath || typeof videoPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "videoPath" parameter' }, { status: 400 });
    }

    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ error: `Video file not found: ${videoPath}` }, { status: 400 });
    }

    const resolvedTargetDuration = targetDuration && Number.isFinite(targetDuration) && targetDuration > 0
      ? targetDuration
      : 30;

    const resolvedOutputDir = outputDir || path.join(process.cwd(), 'public', 'splits');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const args: string[] = [
      path.join(SCRIPTS_DIR, 'cat_nho.py'),
      '--input', videoPath,
      '--target-duration', String(resolvedTargetDuration),
      '--output', resolvedOutputDir,
    ];

    console.log('[split-video] Executing:', PYTHON_EXE, args.join(' '));

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, args, {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (stderr) {
      const logLines = stderr.split('\n').filter((l) => l.startsWith('LOG:'));
      if (logLines.length > 0) {
        console.log('[split-video] Progress:', logLines.join('\n'));
      }
    }

    const jsonLines = stdout.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    const resultText = jsonLines.length > 0 ? jsonLines[jsonLines.length - 1] : stdout.trim();

    const result = JSON.parse(resultText);
    console.log('[split-video] Success:', JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; code?: string };
    console.error('[split-video] Error:', err.message);
    if (err.stderr) console.error('[split-video] Stderr:', err.stderr);
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 }
    );
  }
}
