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
 * Unified timestamp format: "start-end s" (e.g. "0-8.5s").
 * Legacy duration-start "08-16" still parsed for span checks.
 */
export function parseTimestampStart(ts?: string): number {
  const s = String(ts || '').trim();
  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]) || 0;
    const b = Number(range[2]) || 0;
    // start-end when end >= start; else legacy duration-start → start is second number
    if (b >= a) return a;
    return b;
  }
  const single = s.match(/^(\d+(?:\.\d+)?)\s*s?/i);
  if (single) return Number(single[1]) || 0;
  return 0;
}

/** Shot length in seconds from timestamp; 0 if unparsable. */
export function parseTimestampDuration(ts?: string): number {
  const s = String(ts || '').trim();
  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!range) return 0;
  const a = Number(range[1]);
  const b = Number(range[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (b >= a) return Math.round((b - a) * 10) / 10;
  // legacy: first number is duration
  return a > 0 ? a : 0;
}

/**
 * Redistribute prompts evenly across totalDurationSec (real TTS length).
 * Keeps sentence/prompt/emotion; only rewrites timestamp fields (start-end).
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
    if (m) {
      const a = Number(m[1]) || 0;
      const b = Number(m[2]) || 0;
      // start-end → end is max; legacy duration-start → duration+start
      maxEnd = Math.max(maxEnd, b >= a ? b : a + b);
    } else {
      maxEnd = Math.max(maxEnd, parseTimestampStart(s));
    }
  }
  if (maxEnd <= 0) return true;
  const drift = Math.abs(maxEnd - ttsDurationSec) / Math.max(ttsDurationSec, 1);
  return drift > driftRatio;
}
