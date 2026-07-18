/**
 * FFmpeg pad + concat for TTS Batch SRT.
 * sequential: join speech parts only
 * timeline: silence pad to cue startMs + time-stretch if speech > cue window
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { SrtCue, TtsBatchAlignMode } from './types';

export function resolveFfmpegCmd(): string {
  const local = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  if (fs.existsSync(local)) return `"${local}"`;
  return 'ffmpeg';
}

export function resolveFfprobeCmd(): string {
  const local = path.join(process.cwd(), 'bin', 'ffprobe.exe');
  if (fs.existsSync(local)) return `"${local}"`;
  return 'ffprobe';
}

export function probeDurationSec(filePath: string): number {
  try {
    const ffprobe = resolveFfprobeCmd();
    const out = execSync(
      `${ffprobe} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const n = parseFloat(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeSilence(outPath: string, durationSec: number): void {
  const d = Math.max(0.02, durationSec);
  const ffmpeg = resolveFfmpegCmd();
  execSync(
    `${ffmpeg} -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${d.toFixed(3)} -c:a libmp3lame -q:a 2 "${outPath}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
}

function normalizeToMp3(inPath: string, outPath: string): void {
  const ffmpeg = resolveFfmpegCmd();
  execSync(
    `${ffmpeg} -y -i "${inPath}" -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${outPath}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
}

/** Build atempo chain (each stage 0.5–2.0) for speed factor. */
export function buildAtempoFilter(speed: number): string {
  let s = speed;
  if (!Number.isFinite(s) || s <= 0) s = 1;
  // Clamp extreme
  s = Math.min(4, Math.max(0.25, s));
  const parts: string[] = [];
  while (s > 2.0001) {
    parts.push('atempo=2.0');
    s /= 2;
  }
  while (s < 0.5001 && s > 0) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 0.001) {
    parts.push(`atempo=${s.toFixed(4)}`);
  }
  return parts.length ? parts.join(',') : '';
}

/**
 * Fit speech into targetSec (speed up if longer). Returns path used.
 */
export function fitSpeechToCueWindow(
  inMp3: string,
  outMp3: string,
  targetSec: number,
): { path: string; durationSec: number; stretched: boolean } {
  const actual = probeDurationSec(inMp3);
  if (actual <= 0) {
    throw new Error('fitSpeech: duration = 0');
  }
  const window = Math.max(0.08, targetSec);
  // Only stretch when speech overruns cue by >8%
  if (actual <= window * 1.08) {
    return { path: inMp3, durationSec: actual, stretched: false };
  }
  const speed = actual / window;
  const filter = buildAtempoFilter(speed);
  if (!filter) {
    return { path: inMp3, durationSec: actual, stretched: false };
  }
  const ffmpeg = resolveFfmpegCmd();
  execSync(
    `${ffmpeg} -y -i "${inMp3}" -filter:a "${filter}" -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${outMp3}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
  if (!fs.existsSync(outMp3)) {
    throw new Error('fitSpeech: atempo failed');
  }
  const d = probeDurationSec(outMp3) || window;
  return { path: outMp3, durationSec: d, stretched: true };
}

/**
 * Build final MP3 from per-cue speech files.
 * speechPaths[i] must align with cues[i].
 */
export function concatCuesToMp3(opts: {
  cues: SrtCue[];
  speechPaths: string[];
  alignMode: TtsBatchAlignMode;
  padToCueEnd?: boolean;
  /** When true (default on timeline): stretch speech if longer than cue window */
  fitToCue?: boolean;
  workDir: string;
  outPath: string;
}): { duration: number; pieceCount: number; stretchCount: number } {
  const {
    cues,
    speechPaths,
    alignMode,
    padToCueEnd,
    fitToCue = true,
    workDir,
    outPath,
  } = opts;
  if (cues.length !== speechPaths.length) {
    throw new Error(
      `concat: cues (${cues.length}) ≠ speech (${speechPaths.length})`,
    );
  }
  ensureDir(workDir);
  const tag = `concat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const pieces: string[] = [];
  let cursorMs = 0;
  let stretchCount = 0;

  try {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const speechAbs = speechPaths[i];
      if (!speechAbs || !fs.existsSync(speechAbs)) {
        throw new Error(`Thiếu audio cue #${cue.index}`);
      }

      const normSpeech = path.join(workDir, `${tag}_s_${i}.mp3`);
      normalizeToMp3(speechAbs, normSpeech);
      let speechPath = normSpeech;
      let speechSec = probeDurationSec(normSpeech);
      if (speechSec <= 0) {
        throw new Error(`Cue #${cue.index}: duration audio = 0`);
      }

      const cueWindowSec = Math.max(0.08, (cue.endMs - cue.startMs) / 1000);
      if (alignMode === 'timeline' && fitToCue !== false) {
        const fitOut = path.join(workDir, `${tag}_fit_${i}.mp3`);
        const fitted = fitSpeechToCueWindow(normSpeech, fitOut, cueWindowSec);
        speechPath = fitted.path;
        speechSec = fitted.durationSec;
        if (fitted.stretched) stretchCount += 1;
      }

      if (alignMode === 'timeline') {
        const gapMs = cue.startMs - cursorMs;
        if (gapMs > 25) {
          const sil = path.join(workDir, `${tag}_sil_${i}.mp3`);
          makeSilence(sil, gapMs / 1000);
          pieces.push(sil);
          cursorMs += gapMs;
        } else if (gapMs < -50) {
          console.warn(
            `[tts-batch-srt] cue #${cue.index} start ${cue.startMs}ms < cursor ${cursorMs}ms (overlap)`,
          );
        }
      }

      pieces.push(speechPath);
      cursorMs =
        alignMode === 'timeline'
          ? cue.startMs + Math.round(speechSec * 1000)
          : cursorMs + Math.round(speechSec * 1000);

      if (alignMode === 'timeline' && padToCueEnd) {
        const trailMs = cue.endMs - cursorMs;
        if (trailMs > 40) {
          const sil = path.join(workDir, `${tag}_trail_${i}.mp3`);
          makeSilence(sil, trailMs / 1000);
          pieces.push(sil);
          cursorMs = cue.endMs;
        }
      }
    }

    if (!pieces.length) throw new Error('Không có mảnh audio để nối.');

    const listPath = path.join(workDir, `${tag}_list.txt`);
    const listBody = pieces
      .map((p) => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(listPath, listBody, 'utf8');

    const ffmpeg = resolveFfmpegCmd();
    execSync(
      `${ffmpeg} -y -f concat -safe 0 -i "${listPath}" -c:a libmp3lame -q:a 2 "${outPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if (!fs.existsSync(outPath)) {
      throw new Error('FFmpeg concat không tạo file đầu ra.');
    }
    const duration = probeDurationSec(outPath);
    if (duration <= 0) {
      throw new Error('File ghép không có duration hợp lệ.');
    }
    return { duration, pieceCount: pieces.length, stretchCount };
  } finally {
    try {
      for (const f of fs.readdirSync(workDir)) {
        if (f.startsWith(tag)) {
          try {
            fs.unlinkSync(path.join(workDir, f));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export async function applyLoudnormMp3(inputPath: string, outPath: string): Promise<void> {
  const ffmpeg = resolveFfmpegCmd();
  execSync(
    `${ffmpeg} -y -i "${inputPath}" -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${outPath}"`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
  if (!fs.existsSync(outPath)) {
    throw new Error('loudnorm không tạo file.');
  }
}
