/**
 * Tự tối ưu file mẫu clone (ffmpeg):
 * - mono 44.1k
 * - cắt im lặng đầu/cuối
 * - highpass nhẹ (bớt ù)
 * - loudnorm
 * - giới hạn độ dài (mặc định 12s — đủ XTTS / clone)
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export type SampleOptimizeResult = {
  ok: boolean;
  outPath: string;
  steps: string[];
  durationHintSec?: number;
  error?: string;
};

function findFfmpeg(): string {
  const local = path.join(process.cwd(), 'bin', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

function findFfprobe(): string {
  const local = path.join(process.cwd(), 'bin', 'ffmpeg', 'ffprobe.exe');
  if (fs.existsSync(local)) return local;
  return 'ffprobe';
}

function probeDuration(file: string): number {
  try {
    const out = execFileSync(
      findFfprobe(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const n = parseFloat(String(out).trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Optimize reference sample for clone quality.
 * @param src Path raw upload
 * @param dst Path optimized wav
 * @param maxSec Cap length (take middle/start with speech after silence trim)
 */
export function optimizeCloneSample(
  src: string,
  dst: string,
  opts?: { maxSec?: number },
): SampleOptimizeResult {
  const steps: string[] = [];
  const maxSec = opts?.maxSec ?? 12;
  const ff = findFfmpeg();
  const tmpDir = path.dirname(dst);
  const mid1 = path.join(tmpDir, `opt_mid1_${Date.now()}.wav`);
  const mid2 = path.join(tmpDir, `opt_mid2_${Date.now()}.wav`);

  try {
    // 1) mono 44.1k s16
    execFileSync(
      ff,
      ['-y', '-i', src, '-ac', '1', '-ar', '44100', '-sample_fmt', 's16', mid1],
      { stdio: 'pipe' },
    );
    steps.push('mono_44k');

    // 2) trim silence + highpass + soft lowpass + loudnorm
    // silenceremove: cut leading/trailing quiet
    const af = [
      'highpass=f=80',
      'lowpass=f=10000',
      'silenceremove=start_periods=1:start_duration=0.15:start_threshold=-40dB:detection=peak',
      'areverse',
      'silenceremove=start_periods=1:start_duration=0.15:start_threshold=-40dB:detection=peak',
      'areverse',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
    ].join(',');

    execFileSync(
      ff,
      ['-y', '-i', mid1, '-af', af, '-ac', '1', '-ar', '44100', mid2],
      { stdio: 'pipe' },
    );
    steps.push('silence_trim', 'eq', 'loudnorm');

    let dur = probeDuration(mid2);
    // 3) cap length
    if (dur > maxSec + 0.3) {
      // Prefer first maxSec after trim (usually has speech start)
      execFileSync(
        ff,
        [
          '-y',
          '-i',
          mid2,
          '-t',
          String(maxSec),
          '-ac',
          '1',
          '-ar',
          '44100',
          dst,
        ],
        { stdio: 'pipe' },
      );
      steps.push(`cap_${maxSec}s`);
      dur = Math.min(dur, maxSec);
    } else {
      fs.copyFileSync(mid2, dst);
    }

    // cleanup temps
    for (const t of [mid1, mid2]) {
      try {
        if (fs.existsSync(t)) fs.unlinkSync(t);
      } catch {
        /* ignore */
      }
    }

    if (!fs.existsSync(dst) || fs.statSync(dst).size < 1000) {
      return { ok: false, outPath: dst, steps, error: 'output quá nhỏ sau optimize' };
    }

    return { ok: true, outPath: dst, steps, durationHintSec: dur || undefined };
  } catch (e) {
    // fallback: plain convert
    try {
      execFileSync(
        ff,
        ['-y', '-i', src, '-ac', '1', '-ar', '44100', '-sample_fmt', 's16', dst],
        { stdio: 'pipe' },
      );
      steps.push('fallback_plain');
      return {
        ok: true,
        outPath: dst,
        steps,
        durationHintSec: probeDuration(dst) || undefined,
        error: e instanceof Error ? e.message : String(e),
      };
    } catch (e2) {
      return {
        ok: false,
        outPath: dst,
        steps,
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

/** Seed ổn định từ hash text — tránh random mỗi lần clone cùng mẫu */
export function stableSeedFromString(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  const str = (s || '').normalize('NFC');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0) % 9000;
  return 1000 + n;
}
