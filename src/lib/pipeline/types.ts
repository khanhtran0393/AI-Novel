/**
 * Shared types for pipeline packages P0–P2.
 * Quality Gate · Memory · Media Preflight · Stage jobs · Long-form arc.
 */

export type GateSeverity = 'error' | 'warning' | 'info';

export type GateFinding = {
  severity: GateSeverity;
  code: string;
  message: string;
  evidence?: string;
};

/** P0 — chapter quality after write / before media */
export type ChapterQualityReport = {
  chapter: number;
  ok: boolean;
  mediaReady: boolean;
  wordCount: number;
  sceneCount: number;
  hardErrors: number;
  warnings: number;
  findings: GateFinding[];
  checkedAt: string;
  /** accept | rewrite | polish | ungated */
  editorVerdict?: string;
};

export type ForeshadowEntry = {
  id: string;
  chapter: number;
  text: string;
  status: 'open' | 'paid' | 'dropped';
  createdAt: string;
};

export type MemoryPackSnapshot = {
  chapter: number;
  scrollSummary: string;
  shortTerm: string[];
  foreshadowOpen: ForeshadowEntry[];
  characterBible: string;
  promptBlock: string;
  updatedAt: string;
};

/** P1 — media stage */
export type MediaStage = 'prompt' | 'image' | 'video' | 'tts';

export type MediaPreflightIssue = {
  level: 'block' | 'warn' | 'info';
  code: string;
  message: string;
};

export type MediaPreflightResult = {
  ok: boolean;
  stage: MediaStage;
  chapter: number;
  sceneIndex?: number;
  issues: MediaPreflightIssue[];
  summary: string;
};

/** P2 — long-form arc */
export type LongformConfig = {
  /** Auto-on when totalChapters >= chaptersPerArc * 2, or force true */
  layered: boolean;
  chaptersPerArc: number;
  arcsPerVolume: number;
  /** After this many commits without arc summary → router asks editor */
  forceArcSummaryEvery: number;
};

export type ArcBoundaryState = {
  isArcEnd: boolean;
  isVolumeEnd: boolean;
  volume: number;
  arc: number;
  needsExpansion: boolean;
  needsNewVolume: boolean;
  nextArc: number;
  nextVolume: number;
  chaptersInArc: number;
  completedInProject: number;
};

export const DEFAULT_LONGFORM: LongformConfig = {
  layered: false,
  chaptersPerArc: 10,
  arcsPerVolume: 5,
  forceArcSummaryEvery: 10,
};
