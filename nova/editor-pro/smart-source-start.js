'use strict';

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function roundTo(n, step) {
  const s = Number(step) || 0;
  if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return n;
  return Math.round(n / s) * s;
}

function overlapSeconds(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(Number(aStart) || 0, Number(bStart) || 0);
  const e = Math.min(Number(aEnd) || 0, Number(bEnd) || 0);
  return Math.max(0, e - s);
}

function normalizeRanges(ranges) {
  const list = Array.isArray(ranges) ? ranges : [];
  return list
    .map((range) => {
      const start = Number(range && range.start);
      const end = Number(range && range.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { start, end };
    })
    .filter(Boolean);
}

function computeMaxOverlapRatio({ start, clipDur, ranges }) {
  if (!(clipDur > 0)) return 1;
  const end = start + clipDur;
  let worstRatio = 0;
  for (const range of ranges) {
    if (!range) continue;
    const ov = overlapSeconds(start, end, range.start, range.end);
    const ratio = ov / clipDur;
    if (ratio > worstRatio) worstRatio = ratio;
    if (worstRatio >= 1) break;
  }
  return worstRatio;
}

/**
 * Pick a "smart" sourceStart for a clip (in seconds) given the full media duration.
 *
 * Goals:
 * - Stay within bounds: 0 <= start <= mediaDuration - clipDuration
 * - Prefer not to reuse the same segment when the same file is repeated
 * - Avoid extreme intros/outros when there's room (pads)
 */
function pickSmartSourceStart({
  mediaDurationSeconds,
  clipDurationSeconds,
  usedRangesSeconds,
  blockedRangesSeconds,
  padStartSeconds = 1.5,
  padEndSeconds = 1.5,
  maxTries = 14,
  maxOverlapRatio = 0.25,
  maxBlockedOverlapRatio = 0.1,
  roundStepSeconds = 0.1,
} = {}) {
  const mediaDur = Number(mediaDurationSeconds) || 0;
  const clipDur = Math.max(0, Number(clipDurationSeconds) || 0);
  if (!(mediaDur > 0) || !(clipDur > 0)) return 0;

  const rawMaxStart = Math.max(0, mediaDur - clipDur);
  if (rawMaxStart <= 0.05) return 0;

  let minStart = 0;
  let maxStart = rawMaxStart;
  if (rawMaxStart > (padStartSeconds + padEndSeconds + 0.5)) {
    minStart = clamp(padStartSeconds, 0, rawMaxStart);
    maxStart = clamp(rawMaxStart - padEndSeconds, minStart, rawMaxStart);
  }

  const used = normalizeRanges(usedRangesSeconds);
  const blocked = normalizeRanges(blockedRangesSeconds);
  const usageCount = used.length;

  // Golden-ratio stepping produces nicely distributed samples even with sequential calls.
  const phi = 0.618033988749895;
  const baseT = (usageCount * phi) % 1;
  const span = Math.max(0.0001, maxStart - minStart);
  const baseStart = minStart + baseT * span;

  const candidates = [];
  candidates.push(baseStart);
  candidates.push(minStart);
  candidates.push(maxStart);
  // A few deterministic-ish jitters around base (helps avoid collisions with rounding)
  candidates.push(baseStart + 0.37 * span);
  candidates.push(baseStart - 0.23 * span);
  for (const range of blocked) {
    if (!range) continue;
    candidates.push(range.end);
    candidates.push(range.start - clipDur);
    candidates.push(range.end - clipDur);
  }
  // Random candidates for fallback
  for (let i = 0; i < 6; i++) {
    candidates.push(minStart + Math.random() * span);
  }

  // Normalize & dedupe-ish (after clamp/round)
  const normCandidates = [];
  const seen = new Set();
  for (const c of candidates) {
    const v = roundTo(clamp(c, minStart, maxStart), roundStepSeconds);
    const key = v.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    normCandidates.push(v);
  }

  const scoreUsedOverlap = (start) => computeMaxOverlapRatio({ start, clipDur, ranges: used });
  const scoreBlockedOverlap = (start) => computeMaxOverlapRatio({ start, clipDur, ranges: blocked });

  let best = normCandidates[0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestBlockedScore = Number.POSITIVE_INFINITY;

  const tries = Math.min(maxTries, normCandidates.length);
  for (let i = 0; i < tries; i++) {
    const start = normCandidates[i];
    const blockedRatio = scoreBlockedOverlap(start);
    const usedRatio = scoreUsedOverlap(start);
    if (
      blockedRatio < bestBlockedScore ||
      (blockedRatio === bestBlockedScore && usedRatio < bestScore)
    ) {
      bestBlockedScore = blockedRatio;
      bestScore = usedRatio;
      best = start;
    }
    if (blockedRatio <= maxBlockedOverlapRatio && usedRatio <= maxOverlapRatio) {
      return start;
    }
  }

  // If everything overlaps, return the least-bad candidate, preferring low blocked overlap.
  return clamp(best, 0, rawMaxStart);
}

module.exports = {
  pickSmartSourceStart,
  overlapSeconds,
  computeMaxOverlapRatio,
};




