/**
 * Audio post-process module — pitch / speed / treble / formant / loudnorm.
 * Extracted so engine, clone, and SRT pipelines share one implementation.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { VinaVoiceSettings } from './types';
import { emotionPitchBias } from './profiles';

export function findFfmpeg(cwd = process.cwd()): string {
  const local = path.join(cwd, 'bin', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

export function ffmpegAvailable(cwd = process.cwd()): boolean {
  try {
    execFileSync(findFfmpeg(cwd), ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function convertToWavMono(
  src: string,
  dst: string,
  cwd = process.cwd(),
): void {
  const ff = findFfmpeg(cwd);
  execFileSync(
    ff,
    ['-y', '-i', src, '-ac', '1', '-ar', '44100', '-sample_fmt', 's16', dst],
    { stdio: 'pipe' },
  );
}

export function buildProsodyFilter(settings: VinaVoiceSettings): string {
  const pitch = emotionPitchBias(settings);
  const speed = Math.max(0.5, Math.min(2.0, settings.speed || 1));
  const filters: string[] = [];
  // SR-safe pitch: aresample → asetrate → aresample (works for 24k / 22k / 44.1k).
  if (Math.abs(pitch) > 0.01) {
    const rateFactor = Math.pow(2, pitch / 12);
    const newSampleRate = Math.max(
      8000,
      Math.min(192000, Math.round(44100 * rateFactor)),
    );
    let tempo = (1 / rateFactor) * speed;
    filters.push('aresample=44100');
    filters.push(`asetrate=${newSampleRate}`);
    filters.push('aresample=44100');
    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (Math.abs(tempo - 1.0) > 0.001) {
      filters.push(`atempo=${Math.max(0.5, Math.min(2.0, tempo)).toFixed(4)}`);
    }
  } else if (Math.abs(speed - 1) > 0.01) {
    let tempo = speed;
    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (Math.abs(tempo - 1.0) > 0.001) {
      filters.push(`atempo=${Math.max(0.5, Math.min(2.0, tempo)).toFixed(4)}`);
    }
  }
  if (settings.treble_boost && Math.abs(settings.treble_boost) > 0.01) {
    filters.push(`treble=g=${settings.treble_boost}`);
  }
  if (settings.formant && Math.abs(settings.formant - 1) > 0.01) {
    const g = ((settings.formant - 1) * 6).toFixed(2);
    filters.push(`equalizer=f=1200:t=q:w=1:g=${g}`);
  }
  // Always leave ~1 dB headroom before loudnorm (raw ONNX often peaks at 0.0 dBFS → rè).
  filters.push('alimiter=limit=0.89:level=disabled:attack=5:release=50');
  filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return filters.join(',');
}

export function postProcessWav(
  inPath: string,
  outPath: string,
  settings: VinaVoiceSettings,
  cwd = process.cwd(),
): void {
  const ff = findFfmpeg(cwd);
  const af = buildProsodyFilter(settings);
  execFileSync(
    ff,
    ['-y', '-i', inPath, '-af', af, '-ac', '1', '-ar', '44100', outPath],
    { stdio: 'pipe' },
  );
}

export function writeSilenceWav(
  ms: number,
  outPath: string,
  cwd = process.cwd(),
): void {
  const ff = findFfmpeg(cwd);
  const sec = Math.max(0.02, ms / 1000);
  execFileSync(
    ff,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      String(sec),
      outPath,
    ],
    { stdio: 'pipe' },
  );
}

export function concatWavParts(
  parts: { wav: string; pauseMs: number }[],
  outPath: string,
  cwd = process.cwd(),
): void {
  const ff = findFfmpeg(cwd);
  if (parts.length === 1) {
    fs.copyFileSync(parts[0].wav, outPath);
    return;
  }
  const scratch = path.dirname(outPath);
  const files: string[] = [];
  parts.forEach((p, i) => {
    files.push(p.wav);
    if (i < parts.length - 1 && p.pauseMs > 30) {
      const sil = path.join(scratch, `sil_${i}_${Date.now()}.wav`);
      writeSilenceWav(p.pauseMs, sil, cwd);
      files.push(sil);
    }
  });
  const listFile = path.join(scratch, `concat_${Date.now()}.txt`);
  fs.writeFileSync(
    listFile,
    files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'),
    'utf8',
  );
  try {
    execFileSync(
      ff,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath],
      { stdio: 'pipe' },
    );
  } catch {
    execFileSync(
      ff,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-ac',
        '1',
        '-ar',
        '44100',
        outPath,
      ],
      { stdio: 'pipe' },
    );
  } finally {
    try {
      fs.unlinkSync(listFile);
    } catch {
      /* ignore */
    }
  }
}
