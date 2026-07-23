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
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'bin', 'ffmpeg.exe'),
    path.join(cwd, 'bin', 'ffmpeg', 'ffmpeg.exe'),
    path.join(cwd, 'python_core', 'ffmpeg', 'ffmpeg.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

function findFfprobe(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'bin', 'ffprobe.exe'),
    path.join(cwd, 'bin', 'ffmpeg', 'ffprobe.exe'),
    path.join(cwd, 'python_core', 'ffmpeg', 'ffprobe.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffprobe';
}

export function probeDuration(file: string): number {
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

    // 2) trim silence + gentle EQ + loudnorm
    // Keep more low-end than before (highpass 50, not 80) so male/deep F0 is not
    // thinned; keep more air (lowpass 12k) for timbre. Avoid aggressive band-cut
    // that makes clones sound thin/different from the raw sample.
    const af = [
      'highpass=f=50',
      'lowpass=f=12000',
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
    // IRON B10: không plain-convert che lỗi optimize — báo thẳng
    const msg = e instanceof Error ? e.message : String(e);
    steps.push('optimize_failed');
    return {
      ok: false,
      outPath: dst,
      steps,
      error: `Tối ưu mẫu thất bại (không fallback plain convert): ${msg}. Kiểm tra ffmpeg / file mẫu.`,
    };
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

/**
 * Heuristic: ref_text must match the *kept* sample duration.
 * Vietnamese narration ≈ 8–14 chars/s (with spaces). Far outside → Model A
 * mis-aligns mel vs transcript → pitch/timbre drift (the usual "tần số lệch" complaint).
 */
export function assessRefTextAlignment(
  refText: string,
  durationSec: number,
): { ok: boolean; charsPerSec: number; warning?: string; error?: string } {
  const text = (refText || '').normalize('NFC').trim();
  const dur = Number(durationSec) || 0;
  if (!text) {
    return {
      ok: false,
      charsPerSec: 0,
      error:
        'Thiếu transcript mẫu (ref_text). Phải gõ đúng lời đang nói trong đoạn WAV đã giữ.',
    };
  }
  if (dur < 0.8) {
    return {
      ok: false,
      charsPerSec: 0,
      error: 'Mẫu quá ngắn (<0.8s). Cần đoạn nói rõ 3–12 giây.',
    };
  }
  const chars = text.replace(/\s+/g, ' ').length;
  const cps = chars / dur;
  // Too much text for short audio (common after cap_12s with full-chapter transcript)
  if (cps > 18) {
    return {
      ok: false,
      charsPerSec: cps,
      error:
        `Transcript quá dài so với file mẫu (≈${cps.toFixed(1)} ký tự/giây, mẫu ${dur.toFixed(1)}s). ` +
        `Model align sai → giọng/tần số lệch gốc. ` +
        `Chỉ gõ đúng câu đang nói trong đoạn đã cắt (thường ≤12s), không dán cả đoạn dài.`,
    };
  }
  if (cps < 2.5 && chars > 12) {
    return {
      ok: false,
      charsPerSec: cps,
      error:
        `Transcript quá ngắn so với độ dài mẫu (≈${cps.toFixed(1)} ký tự/giây). ` +
        `Hãy gõ đủ lời trong file — thiếu chữ cũng làm lệch pitch/timbre.`,
    };
  }
  if (cps > 14 || cps < 4) {
    return {
      ok: true,
      charsPerSec: cps,
      warning:
        `Transcript/mẫu hơi lệch nhịp (≈${cps.toFixed(1)} ký tự/giây). ` +
        `Nếu clone vẫn lệch tần số, rút gọn sample + gõ đúng lời đoạn đó.`,
    };
  }
  return { ok: true, charsPerSec: cps };
}
