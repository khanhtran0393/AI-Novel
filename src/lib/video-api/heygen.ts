/**
 * HeyGen Video Agent v3 — prompt → MP4.
 * Auth: X-Api-Key · Base: https://api.heygen.com
 * Docs: developers.heygen.com quick-start
 */

import type { ExternalVideoGenerateInput, ExternalVideoGenerateResult } from './types';

function heygenRoot(baseUrl?: string): string {
  const b = String(baseUrl || 'https://api.heygen.com').trim().replace(/\/+$/, '');
  return b || 'https://api.heygen.com';
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    throw new Error(`HeyGen download failed HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length < 256) {
    throw new Error('HeyGen download returned empty/too-small file');
  }
  return buf;
}

/**
 * Create + poll HeyGen Video Agent until MP4 bytes available.
 */
export async function generateHeygenVideo(
  input: ExternalVideoGenerateInput,
): Promise<ExternalVideoGenerateResult> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) throw new Error('[HeyGen] Thiếu API key (X-Api-Key).');
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('[HeyGen] Thiếu prompt video.');

  const root = heygenRoot(input.baseUrl);
  const timeoutMs = Math.max(60_000, Number(input.timeoutMs) || 600_000);
  const t0 = Date.now();

  // Enrich prompt with duration/aspect when user set them (agent is prompt-driven)
  const durationHint =
    Number(input.durationSec) > 0
      ? ` Target length about ${Math.round(input.durationSec)} seconds.`
      : '';
  const aspectHint = input.aspectRatio
    ? ` Aspect ratio ${input.aspectRatio}.`
    : '';
  const imageHint = input.publicImageUrl
    ? ` Use this reference still as visual continuity: ${input.publicImageUrl}`
    : '';
  const fullPrompt = `${prompt}${durationHint}${aspectHint}${imageHint}`.trim();

  const createRes = await fetch(`${root}/v3/video-agents`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: fullPrompt }),
    signal: AbortSignal.timeout(60_000),
  });

  const createText = await createRes.text();
  let createJson: Record<string, unknown> = {};
  try {
    createJson = JSON.parse(createText) as Record<string, unknown>;
  } catch {
    /* raw */
  }
  if (!createRes.ok) {
    throw new Error(
      `[HeyGen] Create video-agent HTTP ${createRes.status}: ${createText.slice(0, 400)}`,
    );
  }

  const data = (createJson.data || createJson) as Record<string, unknown>;
  const sessionId = String(data.session_id || data.sessionId || '').trim();
  let videoId = String(data.video_id || data.videoId || '').trim();
  if (!sessionId && !videoId) {
    throw new Error(
      `[HeyGen] Create response thiếu session_id/video_id: ${createText.slice(0, 400)}`,
    );
  }

  // 1) Poll session until video_id
  while (!videoId && Date.now() - t0 < timeoutMs) {
    const sessRes = await fetch(`${root}/v3/video-agents/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const sessText = await sessRes.text();
    let sessJson: Record<string, unknown> = {};
    try {
      sessJson = JSON.parse(sessText) as Record<string, unknown>;
    } catch {
      /* */
    }
    if (!sessRes.ok) {
      throw new Error(
        `[HeyGen] Poll session HTTP ${sessRes.status}: ${sessText.slice(0, 300)}`,
      );
    }
    const sdata = (sessJson.data || sessJson) as Record<string, unknown>;
    videoId = String(sdata.video_id || sdata.videoId || '').trim();
    const st = String(sdata.status || '').toLowerCase();
    if (st === 'failed' || st === 'error') {
      throw new Error(
        `[HeyGen] Session failed: ${String(sdata.failure_message || sdata.error || st)}`,
      );
    }
    if (!videoId) await sleep(5000);
  }
  if (!videoId) {
    throw new Error('[HeyGen] Timeout chờ video_id từ video-agent session.');
  }

  // 2) Poll video until completed + video_url
  let videoUrl = '';
  while (Date.now() - t0 < timeoutMs) {
    const vRes = await fetch(`${root}/v3/videos/${encodeURIComponent(videoId)}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const vText = await vRes.text();
    let vJson: Record<string, unknown> = {};
    try {
      vJson = JSON.parse(vText) as Record<string, unknown>;
    } catch {
      /* */
    }
    if (!vRes.ok) {
      throw new Error(
        `[HeyGen] Poll video HTTP ${vRes.status}: ${vText.slice(0, 300)}`,
      );
    }
    const vdata = (vJson.data || vJson) as Record<string, unknown>;
    const st = String(vdata.status || '').toLowerCase();
    if (st === 'failed' || st === 'error') {
      throw new Error(
        `[HeyGen] Video failed: ${String(
          vdata.failure_message || vdata.failure_code || vdata.error || st,
        )}`,
      );
    }
    videoUrl = String(
      vdata.video_url || vdata.videoUrl || vdata.url || '',
    ).trim();
    if ((st === 'completed' || st === 'done' || st === 'success') && videoUrl) {
      break;
    }
    if (videoUrl && (st === 'completed' || !st)) break;
    await sleep(10_000);
  }
  if (!videoUrl) {
    throw new Error('[HeyGen] Timeout chờ video_url (completed).');
  }

  const bytes = await downloadBytes(videoUrl);
  return {
    bytes,
    method: 'HeyGen video-agent v3',
    jobId: videoId,
    videoUrl,
  };
}
