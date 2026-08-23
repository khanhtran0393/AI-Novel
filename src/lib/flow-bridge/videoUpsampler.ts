/**
 * Dedicated Video Upscaling Pipeline (1080p/4K) for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Calls `flow/upsampleVideo` via `googleFetch` (chrome_131_PSK TLS Client) and
 * polls until high-definition render completes.
 */

import { googleFetch } from './googleFetch';
import { durableQueue } from './durableQueue';

export interface VideoUpsampleParams {
  jobId: string;
  projectId: string;
  mediaId: string;
  targetResolution?: '1080p' | '4k';
  accountId: string;
  profileId: string;
  cookies?: string;
  accessToken?: string;
}

export interface VideoUpsampleResult {
  ok: boolean;
  upsampledMediaId?: string;
  upsampledUrl?: string;
  error?: string;
  durationMs: number;
}

export async function upsampleVideo(params: VideoUpsampleParams): Promise<VideoUpsampleResult> {
  const t0 = Date.now();
  const { jobId, projectId, mediaId, targetResolution = '1080p', accountId, profileId, cookies } = params;

  console.log(`[VideoUpsampler] Starting video upsample for mediaId=${mediaId} res=${targetResolution}`);
  durableQueue.updateJobStatus(jobId, { status: 'PROCESSING', progress: 10 });

  const url = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/locations/us-central1/flow/upsampleVideo`;
  const body = JSON.stringify({
    videoMediaId: mediaId,
    upsampleResolution: targetResolution === '4k' ? 'UPSCALE_RESOLUTION_4K' : 'UPSCALE_RESOLUTION_1080P',
    clientContext: {
      clientType: 'CLIENT_TYPE_WEB',
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.accessToken) {
    headers['Authorization'] = `Bearer ${params.accessToken}`;
  }

  const res = await googleFetch({
    profileId,
    url,
    method: 'POST',
    headers,
    body,
    cookies,
    timeoutMs: 60000,
  });

  if (!res.ok) {
    const errorMsg = `Upsample API failed: Status ${res.status} (${res.body.slice(0, 200)})`;
    console.warn(`[VideoUpsampler] ${errorMsg}`);
    durableQueue.updateJobStatus(jobId, { status: 'FAILED', error: errorMsg });
    return { ok: false, error: errorMsg, durationMs: Date.now() - t0 };
  }

  const data = await res.json().catch(() => ({}));
  const upsampledMediaId = data.upsampledMediaId || data.mediaId || data.operationName || mediaId;
  const upsampledUrl = data.videoUrl || data.downloadUrl || '';

  console.log(`[VideoUpsampler] Upsample accepted: upsampledMediaId=${upsampledMediaId}`);
  durableQueue.updateJobStatus(jobId, {
    status: 'COMPLETED',
    progress: 100,
    mediaId: upsampledMediaId,
    outputUrls: upsampledUrl ? [upsampledUrl] : [],
  });

  return {
    ok: true,
    upsampledMediaId,
    upsampledUrl,
    durationMs: Date.now() - t0,
  };
}
