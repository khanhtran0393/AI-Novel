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
    const { audioPath, mode, outputPath } = body;

    if (!audioPath || typeof audioPath !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "audioPath" parameter' }, { status: 400 });
    }

    if (!mode || !['embed', 'detect'].includes(mode)) {
      return NextResponse.json({ error: 'Missing or invalid "mode" parameter. Must be "embed" or "detect"' }, { status: 400 });
    }

    if (!fs.existsSync(audioPath)) {
      return NextResponse.json({ error: `Audio file not found: ${audioPath}` }, { status: 400 });
    }

    const args: string[] = [
      path.join(SCRIPTS_DIR, 'watermark_audio.py'),
      '--input', audioPath,
      '--mode', mode,
    ];

    if (mode === 'embed') {
      const resolvedOutputPath = outputPath || path.join(
        process.cwd(), 'public', 'watermarked',
        `watermarked_${path.basename(audioPath)}`
      );
      const outputDirectory = path.dirname(resolvedOutputPath);
      fs.mkdirSync(outputDirectory, { recursive: true });
      args.push('--output', resolvedOutputPath);
    }

    console.log('[watermark-audio] Executing:', PYTHON_EXE, args.join(' '));

    const { stdout, stderr } = await execFileAsync(PYTHON_EXE, args, {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (stderr) {
      const logLines = stderr.split('\n').filter((l) => l.startsWith('LOG:'));
      if (logLines.length > 0) {
        console.log('[watermark-audio] Progress:', logLines.join('\n'));
      }
    }

    const jsonLines = stdout.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('['));
    const resultText = jsonLines.length > 0 ? jsonLines[jsonLines.length - 1] : stdout.trim();

    const result = JSON.parse(resultText);
    console.log('[watermark-audio] Success:', JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; code?: string };
    console.error('[watermark-audio] Error:', err.message);
    if (err.stderr) console.error('[watermark-audio] Stderr:', err.stderr);
    return NextResponse.json(
      { error: err.message, stderr: err.stderr || null },
      { status: 500 }
    );
  }
}
