/**
 * Progressive Incremental Video Downloader for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Downloads and streams finished scene MP4 files from Google storage URLs directly to local disk
 * (`veo_output/` or `data/`) as soon as each individual scene completes during polling,
 * updating job state and allowing immediate preview without waiting for the entire batch to finish.
 */

import fs from 'node:fs';
import path from 'node:path';
import { tlsFetch } from './tlsClient';
import { durableQueue } from './durableQueue';

export interface IncrementalDownloadParams {
  jobId: string;
  sceneId: string;
  videoUrl?: string;
  base64Data?: string;
  profileId: string;
  outputDir?: string;
}

export interface IncrementalDownloadResult {
  ok: boolean;
  localPath?: string;
  error?: string;
}

export async function saveSceneVideoIncrementally(params: IncrementalDownloadParams): Promise<IncrementalDownloadResult> {
  const { jobId, sceneId, videoUrl, base64Data, profileId } = params;
  const targetDir = params.outputDir || path.resolve(process.cwd(), 'veo_output');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const fileName = `${sceneId.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
  const filePath = path.join(targetDir, fileName);

  // If already downloaded, return immediately
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
    durableQueue.updateJobStatus(jobId, { status: 'COMPLETED', progress: 100, localPath: filePath });
    return { ok: true, localPath: filePath };
  }

  console.log(`[ProgressiveDownloader] Incremental download started for sceneId=${sceneId} -> ${filePath}`);

  try {
    if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`[ProgressiveDownloader] Base64 video saved cleanly (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
      durableQueue.updateJobStatus(jobId, { status: 'COMPLETED', progress: 100, localPath: filePath });
      return { ok: true, localPath: filePath };
    }

    if (videoUrl) {
      const res = await tlsFetch({
        profileId,
        url: videoUrl,
        method: 'GET',
        timeoutMs: 120000,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} when downloading video from ${videoUrl.slice(0, 80)}`);
      }

      // Write binary response to local disk
      const buffer = Buffer.from(res.body, 'binary');
      fs.writeFileSync(filePath, buffer);
      console.log(`[ProgressiveDownloader] Streamed MP4 saved cleanly (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

      durableQueue.updateJobStatus(jobId, { status: 'COMPLETED', progress: 100, localPath: filePath });
      return { ok: true, localPath: filePath };
    }

    throw new Error('No videoUrl or base64Data provided for incremental download');
  } catch (e: any) {
    const errorMsg = e?.message || String(e);
    console.warn(`[ProgressiveDownloader] Incremental download failed for sceneId=${sceneId}: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
}
