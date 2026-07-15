/**
 * Re-sync storyboard prompt timestamps when TTS duration changes.
 */

export type TimedPrompt = {
  timestamp?: string;
  sentence?: string;
  script_prompt?: string;
  prompt?: string;
  image_prompt?: string;
  video_prompt?: string;
  emotion?: string;
  [key: string]: unknown;
};

/**
 * Parse "12-18s" or "0s" style ranges; returns start seconds if possible.
 */
export function parseTimestampStart(ts?: string): number {
  const s = String(ts || '').trim();
  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[1]) || 0;
  const single = s.match(/^(\d+(?:\.\d+)?)\s*s?/i);
  if (single) return Number(single[1]) || 0;
  return 0;
}

/**
 * Redistribute prompts evenly across totalDurationSec (real TTS length).
 * Keeps sentence/prompt/emotion; only rewrites timestamp fields.
 */
export function resyncPromptTimestamps<T extends TimedPrompt>(
  prompts: T[],
  totalDurationSec: number,
): T[] {
  const n = prompts?.length || 0;
  if (!n) return prompts || [];
  const total = Math.max(1, Number(totalDurationSec) || 1);
  const slice = total / n;

  return prompts.map((p, i) => {
    const start = Math.round(i * slice * 10) / 10;
    const end = Math.round(Math.min(total, (i + 1) * slice) * 10) / 10;
    const endClamped = Math.max(start, end);
    return {
      ...p,
      timestamp: `${start}-${endClamped}s`,
    };
  });
}

/**
 * If existing timestamps span far from new TTS duration (>15% drift), return true.
 */
export function timestampsNeedResync(
  prompts: TimedPrompt[],
  ttsDurationSec: number,
  driftRatio = 0.15,
): boolean {
  if (!prompts?.length || !ttsDurationSec) return false;
  let maxEnd = 0;
  for (const p of prompts) {
    const s = String(p.timestamp || '');
    const m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (m) maxEnd = Math.max(maxEnd, Number(m[2]) || 0);
    else maxEnd = Math.max(maxEnd, parseTimestampStart(s));
  }
  if (maxEnd <= 0) return true;
  const drift = Math.abs(maxEnd - ttsDurationSec) / Math.max(ttsDurationSec, 1);
  return drift > driftRatio;
}
