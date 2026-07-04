import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const PYTHON_EXE = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
const SCRIPTS_DIR = 'D:\\SuperAudioTools\\video-dub-scripts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { audioPath, language } = body;

    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "audioPath" parameter' }, { status: 400 });
    }

    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioPath}` }, { status: 400 });
    }

    const resolvedLanguage = language || 'vi';

    const args: string[] = [
      path.join(SCRIPTS_DIR, 'diarize_audio.py'),
      '--input', audioPath,
      '--language', resolvedLanguage,
    ];

    console.log('[transcribe] Executing:', PYTHON_EXE, args.join(' '));

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, args, {
      timeout: 600000,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (stderr) {
      const logLines = stderr.split('\n').filter((l) => l.startsWith('LOG:'));
      if (logLines.length > 0) {
        console.log('[transcribe] Progress:', logLines.join('\n'));
      }
    }

    const jsonLines = stdout.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    const resultText = jsonLines.length > 0 ? jsonLines[jsonLines.length - 1] : stdout.trim();

    const result = JSON.parse(resultText);
    console.log('[transcribe] Success:', JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; code?: string };
    console.error('[transcribe] Error:', err.message);
    if (err.stderr) console.error('[transcribe] Stderr:', err.stderr);
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 }
    );
  }
}
