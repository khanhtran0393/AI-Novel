import { NextResponse } from 'next/server';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const PROJECT_ROOT = process.cwd();
const LOCAL_FFMPEG = path.join(PROJECT_ROOT, 'bin', 'ffmpeg.exe');
const LOCAL_FFPROBE = path.join(PROJECT_ROOT, 'bin', 'ffprobe.exe');
const FFMPEG_PATH = fs.existsSync(LOCAL_FFMPEG) ? LOCAL_FFMPEG : 'ffmpeg';
const FFPROBE_PATH = fs.existsSync(LOCAL_FFPROBE) ? LOCAL_FFPROBE : 'ffprobe';

function probeDuration(videoPath: string) {
  const res = spawnSync(
    FFPROBE_PATH,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', videoPath],
    { encoding: 'utf8', windowsHide: true },
  );
  const duration = parseFloat(res.stdout || '');
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const videoPath = String(body.videoPath || '');
    const outputDir = String(body.outputPath || path.join(PROJECT_ROOT, 'output', 'thumbnails'));
    const count = Math.max(1, Math.min(12, Number(body.count) || 4));

    if (!videoPath || !fs.existsSync(videoPath)) {
      return NextResponse.json({ success: false, error: `Video file not found: ${videoPath}` }, { status: 400 });
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const duration = probeDuration(videoPath);
    const stamp = Date.now();
    const outputs: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < count; i++) {
      const ratio = (i + 1) / (count + 1);
      const second = duration > 0 ? Math.max(0.1, duration * ratio) : Math.max(0.1, i + 1);
      const outputPath = path.join(outputDir, `thumbnail_${stamp}_${i + 1}.jpg`);
      const res = spawnSync(
        FFMPEG_PATH,
        ['-y', '-ss', second.toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath],
        { encoding: 'utf8', windowsHide: true },
      );
      if (res.status === 0 && fs.existsSync(outputPath)) {
        outputs.push(outputPath);
      } else {
        errors.push(res.stderr || `FFmpeg exited with code ${res.status}`);
      }
    }

    return NextResponse.json({
      success: outputs.length > 0,
      videoPath,
      outputDir,
      thumbnails: outputs,
      errors,
    }, { status: outputs.length > 0 ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
