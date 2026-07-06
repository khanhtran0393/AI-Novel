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
    const { platform, type, input, count, outputDir } = body;

    if (!platform || typeof platform !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "platform" parameter' }, { status: 400 });
    }
    if (!type || !['search', 'creator', 'detail'].includes(type)) {
      return NextResponse.json({ error: 'Missing or invalid "type" parameter. Must be "search", "creator", or "detail"' }, { status: 400 });
    }
    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "input" parameter' }, { status: 400 });
    }

    const resolvedOutputDir = outputDir || path.join(process.cwd(), 'public', 'downloads');
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const args: string[] = [
      path.join(SCRIPTS_DIR, 'tai_ytdlp.py'),
      '--platform', platform,
      '--type', type,
      '--input', input,
      '--output', resolvedOutputDir,
    ];

    if (count && Number.isInteger(count) && count > 0) {
      args.push('--count', String(count));
    }

    console.log('[download-video] Executing:', PYTHON_EXE, args.join(' '));

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, args, {
      timeout: 600000,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (stderr) {
      const logLines = stderr.split('\n').filter((l) => l.startsWith('LOG:'));
      if (logLines.length > 0) {
        console.log('[download-video] Progress:', logLines.join('\n'));
      }
    }

    const jsonLines = stdout.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    const resultText = jsonLines.length > 0 ? jsonLines[jsonLines.length - 1] : stdout.trim();

    const result = JSON.parse(resultText);
    console.log('[download-video] Success:', JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; code?: string };
    console.error('[download-video] Error:', err.message);
    if (err.stderr) console.error('[download-video] Stderr:', err.stderr);
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 }
    );
  }
}
