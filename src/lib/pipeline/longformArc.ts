/**
 * P2 — Long-form arc (port CLI layered volume/arc semantics, pure + flags).
 * Does not invent outline content (B10) — only routing facts.
 */

import type { ArcBoundaryState, LongformConfig } from './types';
import { DEFAULT_LONGFORM } from './types';
import {
  getArcFlags,
  getLongformConfig,
  openArcEndWindow,
  setLongformConfig,
} from './pipelineStore';

export function resolveLongformConfig(
  totalChapters: number,
  override?: Partial<LongformConfig>,
): LongformConfig {
  const stored = getLongformConfig();
  const base = { ...DEFAULT_LONGFORM, ...stored, ...override };
  const chaptersPerArc = Math.max(2, Math.min(50, base.chaptersPerArc || 10));
  const arcsPerVolume = Math.max(1, Math.min(20, base.arcsPerVolume || 5));

  let layered = base.layered;
  if (override?.layered !== undefined) {
    layered = override.layered;
  } else if (!stored.layered && totalChapters >= chaptersPerArc * 2) {
    layered = true;
  }

  const cfg: LongformConfig = {
    layered,
    chaptersPerArc,
    arcsPerVolume,
    forceArcSummaryEvery: Math.max(2, base.forceArcSummaryEvery || chaptersPerArc),
  };
  // Persist only when changed meaningfully
  if (
    stored.layered !== cfg.layered ||
    stored.chaptersPerArc !== cfg.chaptersPerArc ||
    stored.arcsPerVolume !== cfg.arcsPerVolume
  ) {
    setLongformConfig(cfg);
  }
  return cfg;
}

/**
 * Compute arc/volume boundary from completed chapter count (1-based ids list).
 */
export function computeArcBoundary(
  completedChapters: number[],
  totalChapters: number,
  cfg?: LongformConfig,
): ArcBoundaryState {
  const config = cfg || resolveLongformConfig(totalChapters);
  const completed = [...completedChapters].filter((n) => n > 0).sort((a, b) => a - b);
  const n = completed.length;
  const cpa = config.chaptersPerArc;
  const apv = config.arcsPerVolume;

  const volume = n === 0 ? 1 : Math.floor((n - 1) / (cpa * apv)) + 1;
  const indexInVolume = n === 0 ? 0 : (n - 1) % (cpa * apv);
  const arc = n === 0 ? 1 : Math.floor(indexInVolume / cpa) + 1;
  const chaptersInArc = n === 0 ? 0 : (indexInVolume % cpa) + 1;

  const isArcEnd = n > 0 && n % cpa === 0;
  const isVolumeEnd = n > 0 && n % (cpa * apv) === 0;
  const bookComplete = totalChapters > 0 && n >= totalChapters;

  const needsExpansion =
    isArcEnd && !isVolumeEnd && !bookComplete && n < totalChapters;
  const needsNewVolume = isVolumeEnd && !bookComplete && n < totalChapters;

  return {
    isArcEnd,
    isVolumeEnd,
    volume,
    arc,
    needsExpansion,
    needsNewVolume,
    nextArc: isVolumeEnd ? 1 : arc + 1,
    nextVolume: isVolumeEnd ? volume + 1 : volume,
    chaptersInArc,
    completedInProject: n,
  };
}

/**
 * Build extras for Flow Router RouteState.
 * At arc end: if summaries not yet recorded for this completed count, open editor window.
 */
export function buildLayeredRouteExtras(
  completedChapters: number[],
  totalChapters: number,
  cfg?: LongformConfig,
): {
  layered: boolean;
  arcBoundary: ArcBoundaryState | null;
  hasArcReview: boolean;
  hasArcSummary: boolean;
  hasVolumeSummary: boolean;
} {
  const config = resolveLongformConfig(totalChapters, cfg);
  if (!config.layered) {
    return {
      layered: false,
      arcBoundary: null,
      hasArcReview: true,
      hasArcSummary: true,
      hasVolumeSummary: true,
    };
  }

  const boundary = computeArcBoundary(completedChapters, totalChapters, config);
  if (!boundary.isArcEnd) {
    return {
      layered: true,
      arcBoundary: boundary,
      hasArcReview: true,
      hasArcSummary: true,
      hasVolumeSummary: true,
    };
  }

  const flags = getArcFlags();
  // New arc-end checkpoint not yet summarized → open window once
  if (flags.lastArcSummaryAtChapter < boundary.completedInProject) {
    if (flags.hasArcReview && flags.hasArcSummary && flags.lastArcSummaryAtChapter > 0) {
      // previous arc was closed; reopen for this boundary
      openArcEndWindow();
    } else if (flags.lastArcSummaryAtChapter === 0 && flags.hasArcSummary) {
      // initial flags are "true" — force open on first arc end
      openArcEndWindow();
    }
  }

  const live = getArcFlags();
  const summarizedThisEnd = live.lastArcSummaryAtChapter >= boundary.completedInProject;

  return {
    layered: true,
    arcBoundary: boundary,
    hasArcReview: summarizedThisEnd ? true : live.hasArcReview,
    hasArcSummary: summarizedThisEnd ? true : live.hasArcSummary,
    hasVolumeSummary: boundary.isVolumeEnd
      ? live.lastVolumeSummaryAtChapter >= boundary.completedInProject
        ? true
        : live.hasVolumeSummary
      : true,
  };
}

export function formatArcLabel(b: ArcBoundaryState): string {
  return `Tập ${b.volume} · Cung ${b.arc} (${b.chaptersInArc} ch trong cung) · done=${b.completedInProject}`;
}
