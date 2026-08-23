/**
 * FFmpeg: ghép video gốc + TTS voiceover (audio-only mux).
 * → file sản phẩm riêng, KHÔNG ghi đè video nguồn.
 *
 * Subtitles are NO LONGER burned via FFmpeg — they are exported as
 * editable CapCut text tracks instead (see srtToCaptions.ts).
 *
 * Probes video input for audio streams before building filter graph
 * to prevent crashes when video has no audio.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath } from '@/lib/capassistant/core';

export type MuxFinalOptions = {
  videoPath: string;
  /** Full TTS mix (timeline-aligned) */
  ttsAudioPath: string;
  outPath: string;
  /** true = tắt tiếng gốc, chỉ TTS (default: true) */
  muteOriginal?: boolean;
  /** Optional background music file path */
  bgmPath?: string;
  /** Volume % cho BGM (0..100, mặc định 25%) */
  musicVolume?: number;
  /** Volume % cho TTS (0..100, mặc định 100%) */
  ttsVolume?: number;
  /** Volume % cho Video gốc (0..100, mặc định 0 nếu muteOriginal=true, 100 nếu false) */
  originalVolume?: number;
  /** Tự động giảm âm lượng BGM khi TTS phát (Auto-ducking) */
  autoDucking?: boolean;
};

/**
 * Probe video file with ffprobe to check if it contains an audio stream.
 * Returns true if at least one audio stream exists, false otherwise.
 */
function videoHasAudioStream(videoPath: string, ffmpegPath: string): boolean {
  const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  try {
    const res = spawnSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      videoPath,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    return (res.stdout || '').trim().toLowerCase().includes('audio');
  } catch {
    return false;
  }
}

/**
 * Mux video + voiceover + optional BGM with volume balance and auto-ducking.
 * Audio-only — no subtitle burning (subtitles go to CapCut text tracks).
 *
 * Safely probes the input video for audio streams before building
 * the FFmpeg filter graph — prevents crashes when video has no audio.
 */
export function muxVideoWithTts(opts: MuxFinalOptions): { outPath: string } {
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

  const bgmPath = opts.bgmPath && fs.existsSync(opts.bgmPath) ? path.resolve(opts.bgmPath) : null;
  const ttsVol = Math.max(0, Math.min(200, opts.ttsVolume ?? 100)) / 100;
  const musicVol = Math.max(0, Math.min(200, opts.musicVolume ?? 25)) / 100;

  // Probe video for audio stream — force origVol=0 if no audio
  const inputHasAudio = videoHasAudioStream(videoPath, ffmpeg);
  const origVol = (muteOriginal || !inputHasAudio)
    ? 0
    : Math.max(0, Math.min(200, opts.originalVolume ?? 100)) / 100;

  if (!inputHasAudio && !muteOriginal && (opts.originalVolume ?? 0) > 0) {
    console.warn(
      '[muxVideoWithTts] Video gốc KHÔNG có audio stream — tự động bỏ qua originalVolume, chỉ dùng TTS.',
    );
  }

  const autoDucking = opts.autoDucking !== false && Boolean(bgmPath);

  // ===== Build FFmpeg args =====
  const args: string[] = ['-y', '-i', videoPath, '-i', ttsAudioPath];
  if (bgmPath) {
    args.push('-i', bgmPath);
  }

  const filterComplexParts: string[] = [];

  // Audio processing (Volume balance & Auto Ducking)
  // IMPORTANT: FFmpeg filter outputs can only be consumed ONCE.
  // When auto-ducking, [tts_a] feeds both sidechaincompress AND amix,
  // so we must use asplit to create [tts_sc] (for sidechain) + [tts_mix] (for amix).
  if (bgmPath) {
    if (origVol > 0) {
      // 3-way mix: original video audio + TTS + BGM
      filterComplexParts.push(`[0:a]volume=${origVol}[orig_a]`);
      filterComplexParts.push(`[1:a]volume=${ttsVol}[tts_a]`);
      filterComplexParts.push(`[2:a]volume=${musicVol}[bgm_raw]`);
      if (autoDucking) {
        filterComplexParts.push(`[tts_a]asplit=2[tts_sc][tts_mix]`);
        filterComplexParts.push(`[bgm_raw][tts_sc]sidechaincompress=threshold=0.12:ratio=4:attack=10:release=300[bgm_ducked]`);
        filterComplexParts.push(`[orig_a][tts_mix][bgm_ducked]amix=inputs=3:duration=first:dropout_transition=2[aout]`);
      } else {
        filterComplexParts.push(`[orig_a][tts_a][bgm_raw]amix=inputs=3:duration=first:dropout_transition=2[aout]`);
      }
    } else {
      // 2-way mix: TTS + BGM only (no original audio)
      filterComplexParts.push(`[1:a]volume=${ttsVol}[tts_a]`);
      filterComplexParts.push(`[2:a]volume=${musicVol}[bgm_raw]`);
      if (autoDucking) {
        filterComplexParts.push(`[tts_a]asplit=2[tts_sc][tts_mix]`);
        filterComplexParts.push(`[bgm_raw][tts_sc]sidechaincompress=threshold=0.12:ratio=4:attack=10:release=300[bgm_ducked]`);
        filterComplexParts.push(`[tts_mix][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
      } else {
        filterComplexParts.push(`[tts_a][bgm_raw]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
      }
    }
  } else if (ttsVol !== 1 || origVol > 0) {
    if (origVol > 0) {
      // 2-way mix: original + TTS
      filterComplexParts.push(`[0:a]volume=${origVol}[orig_a]`);
      filterComplexParts.push(`[1:a]volume=${ttsVol}[tts_a]`);
      filterComplexParts.push(`[orig_a][tts_a]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
    } else {
      // TTS only with volume adjustment
      filterComplexParts.push(`[1:a]volume=${ttsVol}[aout]`);
    }
  }

  if (filterComplexParts.length > 0) {
    args.push('-filter_complex', filterComplexParts.join(';'));
    // No subtitle burn → always copy video stream
    args.push('-map', '0:v:0');
    if (filterComplexParts.some(p => p.includes('[aout]'))) {
      args.push('-map', '[aout]');
    } else {
      args.push('-map', '1:a:0');
    }
    args.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
    );
  } else {
    // Basic: stream copy video, replace audio with TTS
    args.push(
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
    );
  }

  args.push(outPath);

  console.log('[muxVideoWithTts] FFmpeg args:', JSON.stringify(args, null, 2));

  const res = spawnSync(ffmpeg, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3_600_000,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.status !== 0 || !fs.existsSync(outPath)) {
    const stderr = (res.stderr || '').trim();
    const stdout = (res.stdout || '').trim();
    console.error('[muxVideoWithTts] FFmpeg FAIL — status:', res.status);
    console.error('[muxVideoWithTts] stderr (last 1500):', stderr.slice(-1500));
    if (stdout) console.error('[muxVideoWithTts] stdout:', stdout.slice(-500));

    const errorLines = stderr.split('\n').filter(l => l.trim());
    const lastMeaningfulLine = errorLines.slice(-3).join(' | ');

    throw new Error(
      `FFmpeg ghép video thất bại:\n${lastMeaningfulLine || stderr.slice(-300)}`,
    );
  }

  const outSize = fs.statSync(outPath).size;
  console.log(`[muxVideoWithTts] ✅ Thành công: ${outPath} (${(outSize / 1024 / 1024).toFixed(1)} MB)`);

  return { outPath };
}
