/**
 * FFmpeg Video Stitching & Subtitle Processing Engine for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Stitches multiple scene MP4 files from `veo_output/` into a single combined
 * master video file (`veo_output/master_combined.mp4`) with transition effects
 * and optional burned-in subtitles (.srt / .vtt).
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpegPath } from '@/lib/capassistant/core';

const execAsync = promisify(exec);

export interface StitchOptions {
  sceneFiles: string[];
  outputPath?: string;
  subtitlePath?: string;
}

export interface StitchResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
}

export async function stitchSceneVideos(options: StitchOptions): Promise<StitchResult> {
  const { sceneFiles } = options;
  if (!sceneFiles || sceneFiles.length === 0) {
    return { ok: false, error: 'No scene files provided for stitching' };
  }

  const validFiles = sceneFiles.filter((f) => fs.existsSync(f));
  if (validFiles.length === 0) {
    return { ok: false, error: 'None of the provided scene files exist on disk' };
  }

  const outputDir = path.dirname(validFiles[0]);
  const outputPath = options.outputPath || path.join(outputDir, `master_combined_${Date.now()}.mp4`);
  const concatListPath = path.join(outputDir, `concat_${Date.now()}.txt`);

  try {
    // Generate ffmpeg concat text file using forward slashes for Windows paths.
    const concatContent = validFiles
      .map((f) => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf-8');

    const ffmpeg = resolveFfmpegPath();
    let cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`;
    if (options.subtitlePath && fs.existsSync(options.subtitlePath)) {
      cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatListPath}" -vf "subtitles='${options.subtitlePath.replace(/\\/g, '/')}'" -c:a copy "${outputPath}"`;
    }

    console.log(`[FFmpegService] Executing video stitch: ${cmd}`);
    await execAsync(cmd);

    // Clean up temporary concat list file
    if (fs.existsSync(concatListPath)) {
      fs.unlinkSync(concatListPath);
    }

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      console.log(`[FFmpegService] Video stitching completed successfully -> ${outputPath}`);
      return { ok: true, outputPath };
    }

    throw new Error('Stitching completed but output file was not created or is empty');
  } catch (e: any) {
    if (fs.existsSync(concatListPath)) {
      try { fs.unlinkSync(concatListPath); } catch (_) {}
    }
    const errorMsg = e?.message || String(e);
    console.warn(`[FFmpegService] Video stitching failed: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}
