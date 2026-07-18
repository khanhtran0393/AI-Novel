/**
 * FFmpeg: ghép video gốc + TTS voiceover (+ hardsub SRT đã dịch)
 * → file sản phẩm riêng, KHÔNG ghi đè video nguồn.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath } from '@/lib/capassistant/core';

export type MuxFinalOptions = {
  videoPath: string;
  /** Full TTS mix (timeline-aligned) */
  ttsAudioPath: string;
  /** SRT đã dịch — burn-in phụ đề */
  srtPath?: string;
  outPath: string;
  /** true = tắt tiếng gốc, chỉ TTS */
  muteOriginal?: boolean;
  /** true = gắn phụ đề cứng (hardsub) vào hình */
  burnSubtitles?: boolean;
};

function escapeSubPathForFilter(p: string): string {
  // FFmpeg subtitles filter on Windows: escape \, :, '
  return p
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

/**
 * Mux video + voiceover. Uses stream copy for video when no burn-in;
 * re-encodes video when burning SRT.
 */
export function muxVideoWithTts(opts: MuxFinalOptions): { outPath: string; usedBurn: boolean } {
  const videoPath = path.resolve(opts.videoPath);
  const ttsAudioPath = path.resolve(opts.ttsAudioPath);
  const outPath = path.resolve(opts.outPath);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video không tồn tại: ${videoPath}`);
  }
  if (!fs.existsSync(ttsAudioPath)) {
    throw new Error(`Audio TTS không tồn tại: ${ttsAudioPath}`);
  }
  if (path.resolve(videoPath) === outPath) {
    throw new Error('Từ chối ghi đè video gốc — outPath phải khác videoPath.');
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const ffmpeg = resolveFfmpegPath();
  const muteOriginal = opts.muteOriginal !== false;
  const burn =
    opts.burnSubtitles !== false &&
    opts.srtPath &&
    fs.existsSync(opts.srtPath);

  const args: string[] = ['-y', '-i', videoPath, '-i', ttsAudioPath];

  if (burn && opts.srtPath) {
    const subEsc = escapeSubPathForFilter(path.resolve(opts.srtPath));
    // Burn translated subs; map TTS as audio
    args.push(
      '-filter_complex',
      `[0:v]subtitles='${subEsc}':force_style='FontSize=18,Outline=1,Shadow=0'[vout]`,
      '-map',
      '[vout]',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
    );
  } else {
    // Copy video, replace audio with TTS (no touch original file)
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
    );
  }

  // Drop original audio explicitly when mapping only TTS
  if (muteOriginal) {
    // already mapping only 1:a
  }

  args.push(outPath);

  const res = spawnSync(ffmpeg, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3_600_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.status !== 0 || !fs.existsSync(outPath)) {
    throw new Error(
      `FFmpeg ghép video thất bại: ${(res.stderr || res.stdout || '').slice(-800)}`,
    );
  }

  return { outPath, usedBurn: Boolean(burn) };
}
